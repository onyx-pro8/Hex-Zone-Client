import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "../hooks/useAuth";
import { subscribeRealtimeMessages, useWebSocket } from "../hooks/useWebSocket";
import {
  emitEscalatedAccessClosed,
  formatCallDuration,
  parseGuestCallSocketMessage,
  sameVisibleCall,
  sessionFromCallPayload,
  zoneIdsEqual,
  type GuestCallRole,
  type GuestCallSession,
} from "../lib/guestCall";
import {
  handleGuestCallSignal,
  startGuestCallMedia,
  primeLocalVoiceContext,
  stopGuestCallMedia,
} from "../lib/guestCallMedia";
import { getGuestAccessToken, getGuestSessionMeta } from "../lib/guestAccessToken";
import { defaultRealtimeWsBase } from "../services/socket/messageSocket";
import { uiToast } from "../lib/uiToast";

type StartAdminCallArgs = {
  guestId: string;
  zoneId: string;
  guestName?: string;
  fullscreen?: boolean;
};

type PresentLocalOutgoingArgs = {
  zoneId: string;
  guestId: string;
  guestName?: string;
  fullscreen?: boolean;
};

type GuestCallContextValue = {
  session: GuestCallSession | null;
  elapsedLabel: string;
  callBusy: boolean;
  callRequesting: boolean;
  startAdminCall: (args: StartAdminCallArgs) => boolean;
  startGuestCall: (opts?: {
    fullscreen?: boolean;
    guestId?: string;
    zoneId?: string;
    adminAvatarUrl?: string | null;
  }) => boolean;
  presentLocalOutgoingCall: (args: PresentLocalOutgoingArgs) => void;
  acceptCall: () => void;
  rejectCall: () => void;
  cancelCall: () => void;
  endCall: () => void;
  /** Guest card is on screen; the admin invite can go out now. */
  notifyCardVisible: () => void;
};

const GuestCallContext = createContext<GuestCallContextValue | null>(null);

function useElapsed(acceptedAt: string | null, active: boolean): string {
  const [label, setLabel] = useState("00:00");
  useEffect(() => {
    if (!active || !acceptedAt) {
      setLabel("00:00");
      return;
    }
    const start = Date.parse(acceptedAt);
    if (!Number.isFinite(start)) {
      setLabel("00:00");
      return;
    }
    let timer = 0;
    const tick = () => {
      const elapsedMs = Math.max(0, Date.now() - start);
      setLabel(formatCallDuration(elapsedMs / 1000));
      // Flip on the shared second boundary so both devices show the same time.
      const remainder = elapsedMs % 1000;
      const delay = remainder === 0 ? 1000 : 1000 - remainder;
      timer = window.setTimeout(tick, delay);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [acceptedAt, active]);
  return label;
}

function pendingCallId() {
  return `pending-${Date.now().toString(36)}`;
}

export function GuestCallProvider({ children }: { children: ReactNode }) {
  const { token: memberToken, user } = useAuth();
  const [guestToken, setGuestToken] = useState<string | null>(() => getGuestAccessToken());
  const [guestZoneIds, setGuestZoneIds] = useState<string[]>(() => {
    const meta = getGuestSessionMeta();
    return meta?.zone_ids?.length ? meta.zone_ids : meta?.zone_id ? [meta.zone_id] : [];
  });
  const [session, setSession] = useState<GuestCallSession | null>(null);
  const [callRequesting, setCallRequesting] = useState(false);
  const sessionRef = useRef<GuestCallSession | null>(null);
  sessionRef.current = session;

  const guestTokenRef = useRef<string | null>(guestToken);
  guestTokenRef.current = guestToken;
  const guestWsRef = useRef<WebSocket | null>(null);
  const answerTimerRef = useRef<number | null>(null);
  const [guestWsOpen, setGuestWsOpen] = useState(false);
  const lastHandledRef = useRef<{ admin: string | null; guest: string | null }>({
    admin: null,
    guest: null,
  });

  const putSession = useCallback((next: GuestCallSession) => {
    if (answerTimerRef.current) {
      window.clearTimeout(answerTimerRef.current);
      answerTimerRef.current = null;
    }
    setSession((prev) => {
      if (sameVisibleCall(prev, next)) return prev;
      const placeholder =
        !!prev &&
        (prev.callId.startsWith("pending-") ||
          prev.callId.startsWith("queue-") ||
          prev.state === "queued");
      if (
        placeholder &&
        prev &&
        (!next.guestId || !prev.guestId || next.guestId === prev.guestId)
      ) {
        return next;
      }
      return next;
    });
  }, []);

  const armedCallRef = useRef<string | null>(null);
  const clearSession = useCallback(async () => {
    sessionRef.current = null;
    armedCallRef.current = null;
    setSession(null);
    await stopGuestCallMedia();
  }, []);

  useEffect(() => {
    const sync = () => {
      const token = getGuestAccessToken();
      const meta = getGuestSessionMeta();
      const zones = meta?.zone_ids?.length
        ? meta.zone_ids
        : meta?.zone_id
          ? [meta.zone_id]
          : [];
      setGuestToken((prev) => (prev === token ? prev : token));
      setGuestZoneIds((prev) => (zoneIdsEqual(prev, zones) ? prev : zones));
    };
    sync();
    const id = window.setInterval(sync, guestToken ? 10000 : 1200);
    window.addEventListener("storage", sync);
    window.addEventListener("hexzone-guest-meta", sync);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("storage", sync);
      window.removeEventListener("hexzone-guest-meta", sync);
    };
  }, [guestToken]);

  const memberZoneIds = useMemo(
    () => (user?.zone_id ? [String(user.zone_id)] : []),
    [user?.zone_id],
  );
  const { sendMessage, status } = useWebSocket({
    token: memberToken,
    zoneIds: memberZoneIds,
  });
  const memberStatusRef = useRef(status);
  memberStatusRef.current = status;

  const sendCallAs = useCallback(
    (asRole: GuestCallRole, payload: Record<string, unknown>) => {
      if (asRole === "guest") {
        const ws = guestWsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(payload));
          return true;
        }
        return false;
      }
      return sendMessage(payload);
    },
    [sendMessage],
  );

  const beginMedia = useCallback(
    async (next: GuestCallSession) => {
      const asRole: GuestCallRole = next.isCaller
        ? next.callerRole
        : next.callerRole === "guest"
          ? "admin"
          : "guest";
      await startGuestCallMedia({
        isOfferer: next.isCaller,
        onSignal: (signal) => {
          sendCallAs(asRole, {
            type: "CALL_SIGNAL",
            data: { call_id: next.callId, signal },
          });
        },
      });
    },
    [sendCallAs],
  );

  const applyEvent = useCallback(
    async (raw: string | null, asRole: GuestCallRole) => {
      if (!raw) return;
      if (lastHandledRef.current[asRole] === raw) return;
      try {
        const envelope = JSON.parse(raw) as {
          type?: string;
          error?: { message?: string; error_code?: string };
        };
        if (String(envelope.type || "").toUpperCase() === "ERROR") {
          lastHandledRef.current[asRole] = raw;
          if (answerTimerRef.current) {
            window.clearTimeout(answerTimerRef.current);
            answerTimerRef.current = null;
          }
          setCallRequesting(false);
          const code = String(envelope.error?.error_code || "");
          if (code === "RECEIVER_OFFLINE" || code === "CALL_FAILED" || code === "CALL_ALREADY_ACTIVE") {
            uiToast.error(envelope.error?.message || "The call could not be started.", {
              title: "Call",
            });
          }
          return;
        }
      } catch {
        return;
      }
      const ev = parseGuestCallSocketMessage(raw);
      if (!ev) return;
      lastHandledRef.current[asRole] = raw;

      if (ev.type === "CALL_SIGNAL") {
        const signal = ev.data.signal;
        if (signal && typeof signal === "object") {
          await handleGuestCallSignal(
            signal as Parameters<typeof handleGuestCallSignal>[0],
            (out) => {
              const callId = String(ev.data.call_id ?? sessionRef.current?.callId ?? "");
              if (!callId || callId.startsWith("pending-") || callId.startsWith("queue-")) return;
              sendCallAs(asRole, {
                type: "CALL_SIGNAL",
                data: { call_id: callId, signal: out },
              });
            },
          );
        }
        return;
      }

      if (
        ev.type === "CALL_REJECT" ||
        ev.type === "CALL_CANCEL" ||
        ev.type === "CALL_TIMEOUT" ||
        ev.type === "CALL_END"
      ) {
        const endedId = String(ev.data.call_id ?? "").trim();
        const cur = sessionRef.current;
        const endedGuest = String(ev.data.guest_id ?? "").trim();
        if (
          cur &&
          endedId &&
          cur.callId !== endedId &&
          !cur.callId.startsWith("pending-") &&
          !cur.callId.startsWith("queue-") &&
          !(endedGuest && cur.guestId === endedGuest)
        ) {
          return;
        }
        if (ev.data.auto_close_access === true) {
          emitEscalatedAccessClosed();
        }
        await clearSession();
        return;
      }

      if (ev.type === "CALL_STARTED" || (ev.type === "CALL_INVITE" && sessionRef.current?.isCaller && sessionRef.current.callerRole === asRole)) {
        const next = sessionFromCallPayload(ev.data, { localRole: asRole });
        if (!next) return;
        next.isCaller = true;
        if (sessionRef.current?.state === "connected") next.state = "connected";
        setCallRequesting(false);
        putSession(next);
        return;
      }

      if (ev.type === "CALL_QUEUED") {
        const next = sessionFromCallPayload(ev.data, { localRole: asRole });
        if (!next) return;
        next.state = "queued";
        const alreadyQueued =
          sessionRef.current?.state === "queued" &&
          sessionRef.current.callId === next.callId;
        setCallRequesting(false);
        putSession(next);
        if (!alreadyQueued) {
          const place =
            next.queuePosition && next.queuePosition > 1
              ? ` You are number ${next.queuePosition}.`
              : "";
          uiToast.info(`You are in the queue.${place}`, { title: "Call", duration: 4200 });
        }
        return;
      }

      if (ev.type === "CALL_INVITE" || ev.type === "CALL_ACCEPT") {
        const next = sessionFromCallPayload(ev.data, { localRole: asRole });
        if (!next) return;
        if (ev.type === "CALL_ACCEPT") {
          next.state = "connected";
          if (!next.acceptedAt) {
            next.acceptedAt =
              sessionRef.current?.acceptedAt || new Date().toISOString();
          }
          setCallRequesting(false);
          putSession(next);
          await beginMedia(next);
          return;
        }
        const wasQueued =
          sessionRef.current?.state === "queued" ||
          Boolean(sessionRef.current?.callId.startsWith("queue-"));
        const alreadyLive =
          sessionRef.current?.callId === next.callId &&
          sessionRef.current?.state === "ringing";
        const fromQueue = ev.data.from_queue === true || wasQueued;
        setCallRequesting(false);
        putSession(next);
        if (fromQueue && next.state === "ringing" && !alreadyLive) {
          const message = next.isCaller
            ? next.callerRole === "admin"
              ? `Now calling ${next.guestName}.`
              : "Now calling the administrator."
            : next.callerRole === "admin"
              ? "The administrator is calling."
              : `${next.guestName} is calling.`;
          uiToast.info(message, { title: "Call", duration: 4200 });
        }
      }
    },
    [beginMedia, clearSession, putSession, sendCallAs],
  );

  const applyEventRef = useRef(applyEvent);
  applyEventRef.current = applyEvent;

  useEffect(() => {
    return subscribeRealtimeMessages((raw) => {
      void applyEventRef.current(raw, "admin");
    });
  }, []);

  useEffect(() => {
    if (!guestToken) {
      setGuestWsOpen(false);
      if (guestWsRef.current) {
        try {
          guestWsRef.current.close();
        } catch {
          /* ignore */
        }
        guestWsRef.current = null;
      }
      return;
    }

    let closed = false;
    let attempt = 0;
    let retry: number | null = null;
    const url = `${defaultRealtimeWsBase()}?token=${encodeURIComponent(guestToken)}`;
    const connect = () => {
      if (closed) return;
      const ws = new WebSocket(url);
      guestWsRef.current = ws;
      ws.onopen = () => {
        if (closed) return;
        attempt = 0;
        setGuestWsOpen(true);
        if (guestZoneIds.length) {
          ws.send(JSON.stringify({ type: "SUBSCRIBE", zoneIds: guestZoneIds }));
        }
      };
      ws.onclose = () => {
        if (guestWsRef.current === ws) guestWsRef.current = null;
        if (closed) return;
        setGuestWsOpen(false);
        const delay = Math.min(8000, 400 * 2 ** attempt);
        attempt += 1;
        retry = window.setTimeout(connect, delay);
      };
      ws.onmessage = (ev) => {
        if (closed) return;
        const raw = typeof ev.data === "string" ? ev.data : "";
        if (raw) void applyEventRef.current(raw, "guest");
      };
    };
    connect();
    return () => {
      closed = true;
      if (retry) window.clearTimeout(retry);
      setGuestWsOpen(false);
      const ws = guestWsRef.current;
      guestWsRef.current = null;
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestToken]);

  useEffect(() => {
    const ws = guestWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !guestZoneIds.length) return;
    ws.send(JSON.stringify({ type: "SUBSCRIBE", zoneIds: guestZoneIds }));
  }, [guestZoneIds]);

  const armServerAnswerWait = useCallback(() => {
    if (answerTimerRef.current) window.clearTimeout(answerTimerRef.current);
    answerTimerRef.current = window.setTimeout(() => {
      answerTimerRef.current = null;
      setCallRequesting(false);
      if (!sessionRef.current) {
        uiToast.error("The server did not answer the call.", { title: "Call" });
      }
    }, 20000);
  }, []);

  const elapsedLabel = useElapsed(
    session?.acceptedAt ?? null,
    session?.state === "connected",
  );

  const startAdminCall = useCallback(
    (args: StartAdminCallArgs) => {
      primeLocalVoiceContext();
      if (sessionRef.current) return false;
      if (callRequesting) return true;
      setCallRequesting(true);
      void (async () => {
        const started = Date.now();
        while (memberStatusRef.current !== "open" && Date.now() - started < 8000) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        const sent = sendCallAs("admin", {
          type: "CALL_INVITE",
          data: {
            guest_id: args.guestId,
            zone_id: args.zoneId,
            guest_name: args.guestName || "Guest",
            fullscreen: Boolean(args.fullscreen),
          },
        });
        if (!sent) {
          setCallRequesting(false);
          uiToast.error("Could not reach the server. Try again.", { title: "Call" });
          return;
        }
        armServerAnswerWait();
      })();
      return true;
    },
    [armServerAnswerWait, callRequesting, sendCallAs],
  );

  const presentLocalOutgoingCall = useCallback(
    (args: PresentLocalOutgoingArgs) => {
      if (sessionRef.current && !sessionRef.current.callId.startsWith("pending-")) {
        return;
      }
      const optimistic: GuestCallSession = {
        callId: sessionRef.current?.callId.startsWith("pending-")
          ? sessionRef.current.callId
          : pendingCallId(),
        zoneId: args.zoneId,
        guestId: args.guestId,
        guestName: args.guestName || "Administrator",
        adminOwnerId: 0,
        callerRole: "guest",
        fullscreen: Boolean(args.fullscreen),
        accessRejectEscalation: Boolean(args.fullscreen),
        state: "ringing",
        acceptedAt: null,
        isCaller: true,
        adminAvatarUrl: null,
        guestAvatarUrl:
          String((user as { avatar_url?: string } | null)?.avatar_url || "").trim() ||
          null,
      };
      sessionRef.current = optimistic;
      setSession(optimistic);
    },
    [user],
  );

  const startGuestCall = useCallback(
    (opts?: {
      fullscreen?: boolean;
      guestId?: string;
      zoneId?: string;
      adminAvatarUrl?: string | null;
    }) => {
      primeLocalVoiceContext();
      if (sessionRef.current && !sessionRef.current.callId.startsWith("pending-")) {
        return false;
      }
      if (callRequesting) return false;
      setCallRequesting(true);
      void (async () => {
        const started = Date.now();
        while (guestWsRef.current?.readyState !== WebSocket.OPEN && Date.now() - started < 8000) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        const avatar = String((user as { avatar_url?: string } | null)?.avatar_url || "").trim();
        const sent = sendCallAs("guest", {
          type: "CALL_INVITE",
          data: {
            fullscreen: Boolean(opts?.fullscreen),
            access_reject_escalation: Boolean(opts?.fullscreen),
            ...(avatar ? { guest_avatar_url: avatar } : {}),
          },
        });
        if (!sent) {
          setCallRequesting(false);
          uiToast.error("Could not reach the server. Try again.", { title: "Call" });
          return;
        }
        armServerAnswerWait();
      })();
      return true;
    },
    [armServerAnswerWait, callRequesting, sendCallAs, user],
  );

  const roleForSession = (cur: GuestCallSession): GuestCallRole =>
    cur.isCaller ? cur.callerRole : cur.callerRole === "guest" ? "admin" : "guest";

  const acceptCall = useCallback(() => {
    primeLocalVoiceContext();
    const cur = sessionRef.current;
    if (!cur || cur.state !== "ringing" || cur.isCaller) return;
    if (cur.callId.startsWith("pending-")) return;
    sendCallAs(roleForSession(cur), {
      type: "CALL_ACCEPT",
      data: { call_id: cur.callId },
    });
  }, [sendCallAs]);

  const notifyCardVisible = useCallback(() => {
    // The invite is sent when Call is pressed. The card opens from the server reply.
  }, []);

  const rejectCall = useCallback(() => {
    const cur = sessionRef.current;
    if (!cur || (cur.state !== "ringing" && cur.state !== "queued")) return;
    const sent = sendCallAs(roleForSession(cur), {
      type: cur.isCaller ? "CALL_CANCEL" : "CALL_REJECT",
      data: {
        call_id: cur.callId,
        guest_id: cur.guestId,
        zone_id: cur.zoneId,
        access_reject_escalation: cur.accessRejectEscalation,
        fullscreen: cur.fullscreen,
      },
    });
    if (!sent) {
      uiToast.error("Could not reach the server. The call is still ringing.", { title: "Call" });
    }
  }, [sendCallAs]);

  const endCall = useCallback(() => {
    const cur = sessionRef.current;
    if (!cur) return;
    if (!cur.callId.startsWith("pending-")) {
      sendCallAs(roleForSession(cur), {
        type: "CALL_END",
        data: { call_id: cur.callId },
      });
    }
    void clearSession();
  }, [clearSession, sendCallAs]);

  // Unanswered rings end with the server clock. A connected call is not timed out.
  useEffect(() => {
    if (!session || session.state !== "ringing") return;
    if (session.callId.startsWith("pending-") || session.callId.startsWith("queue-")) return;
    const limitSec = Math.min(45, Math.max(15, session.ringTimeoutSeconds || 30));
    const started = Date.parse(session.createdAt || "");
    const startMs = Number.isFinite(started) ? started : Date.now();
    const remaining = Math.max(0, startMs + limitSec * 1000 - Date.now());
    const timer = window.setTimeout(() => {
      const cur = sessionRef.current;
      if (!cur || cur.callId !== session.callId || cur.state !== "ringing") return;
      sendCallAs(roleForSession(cur), {
        type: cur.isCaller ? "CALL_CANCEL" : "CALL_REJECT",
        data: {
          call_id: cur.callId,
          guest_id: cur.guestId,
          zone_id: cur.zoneId,
          access_reject_escalation: cur.accessRejectEscalation,
        },
      });
      if (cur.accessRejectEscalation) emitEscalatedAccessClosed();
      void clearSession();
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [session, clearSession, sendCallAs]);

  const value = useMemo<GuestCallContextValue>(
    () => ({
      session,
      elapsedLabel,
      callRequesting,
      callBusy: Boolean(session) || callRequesting,
      startAdminCall,
      startGuestCall,
      presentLocalOutgoingCall,
      acceptCall,
      rejectCall,
      cancelCall: rejectCall,
      endCall,
      notifyCardVisible,
    }),
    [
      session,
      elapsedLabel,
      callRequesting,
      startAdminCall,
      startGuestCall,
      presentLocalOutgoingCall,
      acceptCall,
      rejectCall,
      endCall,
      notifyCardVisible,
    ],
  );

  return (
    <GuestCallContext.Provider value={value}>{children}</GuestCallContext.Provider>
  );
}

export function useGuestCall(): GuestCallContextValue {
  const ctx = useContext(GuestCallContext);
  if (!ctx) throw new Error("useGuestCall must be used within GuestCallProvider");
  return ctx;
}

export function useGuestCallOptional(): GuestCallContextValue | null {
  return useContext(GuestCallContext);
}
