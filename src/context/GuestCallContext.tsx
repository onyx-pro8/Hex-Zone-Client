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
import { useWebSocket } from "../hooks/useWebSocket";
import {
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
  startAdminCall: (args: StartAdminCallArgs) => boolean;
  startGuestCall: (opts?: { fullscreen?: boolean }) => boolean;
  presentLocalOutgoingCall: (args: PresentLocalOutgoingArgs) => void;
  acceptCall: () => void;
  rejectCall: () => void;
  cancelCall: () => void;
  endCall: () => void;
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
  const sessionRef = useRef<GuestCallSession | null>(null);
  sessionRef.current = session;

  const guestTokenRef = useRef<string | null>(guestToken);
  guestTokenRef.current = guestToken;
  const guestWsRef = useRef<WebSocket | null>(null);
  const [guestWsOpen, setGuestWsOpen] = useState(false);
  const lastHandledRef = useRef<{ admin: string | null; guest: string | null }>({
    admin: null,
    guest: null,
  });

  const putSession = useCallback((next: GuestCallSession) => {
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

  const clearSession = useCallback(async () => {
    sessionRef.current = null;
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
  const { lastMessage, sendMessage, status } = useWebSocket({
    token: memberToken,
    zoneIds: memberZoneIds,
  });

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
        if (
          cur &&
          endedId &&
          cur.callId !== endedId &&
          !cur.callId.startsWith("pending-") &&
          !cur.callId.startsWith("queue-")
        ) {
          return;
        }
        await clearSession();
        return;
      }

      if (ev.type === "CALL_QUEUED") {
        const next = sessionFromCallPayload(ev.data, { localRole: asRole });
        if (!next) return;
        next.state = "queued";
        const alreadyQueued =
          sessionRef.current?.state === "queued" &&
          sessionRef.current.callId === next.callId;
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
    if (!lastMessage) return;
    void applyEventRef.current(lastMessage, "admin");
  }, [lastMessage]);

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
    const url = `${defaultRealtimeWsBase()}?token=${encodeURIComponent(guestToken)}`;
    const ws = new WebSocket(url);
    guestWsRef.current = ws;
    ws.onopen = () => {
      if (closed) return;
      setGuestWsOpen(true);
      if (guestZoneIds.length) {
        ws.send(JSON.stringify({ type: "SUBSCRIBE", zoneIds: guestZoneIds }));
      }
    };
    ws.onclose = () => {
      if (closed) return;
      setGuestWsOpen(false);
    };
    ws.onmessage = (ev) => {
      if (closed) return;
      const raw = typeof ev.data === "string" ? ev.data : "";
      if (raw) void applyEventRef.current(raw, "guest");
    };
    return () => {
      closed = true;
      setGuestWsOpen(false);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      if (guestWsRef.current === ws) guestWsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestToken]);

  useEffect(() => {
    const ws = guestWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !guestZoneIds.length) return;
    ws.send(JSON.stringify({ type: "SUBSCRIBE", zoneIds: guestZoneIds }));
  }, [guestZoneIds]);

  const elapsedLabel = useElapsed(
    session?.acceptedAt ?? null,
    session?.state === "connected",
  );

  const startAdminCall = useCallback(
    (args: StartAdminCallArgs) => {
      if (sessionRef.current) return false;
      const optimistic: GuestCallSession = {
        callId: pendingCallId(),
        zoneId: args.zoneId,
        guestId: args.guestId,
        guestName: args.guestName || "Guest",
        adminOwnerId: 0,
        callerRole: "admin",
        fullscreen: Boolean(args.fullscreen),
        accessRejectEscalation: false,
        state: "ringing",
        acceptedAt: null,
        isCaller: true,
        adminAvatarUrl:
          String((user as { avatar_url?: string } | null)?.avatar_url || "").trim() ||
          null,
        guestAvatarUrl: null,
      };
      sessionRef.current = optimistic;
      setSession(optimistic);
      const ok = sendCallAs("admin", {
        type: "CALL_INVITE",
        data: {
          guest_id: args.guestId,
          zone_id: args.zoneId,
          guest_name: args.guestName || "Guest",
          fullscreen: Boolean(args.fullscreen),
        },
      });
      if (!ok) void clearSession();
      return ok;
    },
    [clearSession, sendCallAs],
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
    (opts?: { fullscreen?: boolean }) => {
      if (sessionRef.current && !sessionRef.current.callId.startsWith("pending-")) {
        return false;
      }
      if (!guestTokenRef.current) return false;
      const optimistic: GuestCallSession = {
        callId: pendingCallId(),
        zoneId: guestZoneIds[0] || "",
        guestId: "",
        guestName: "Administrator",
        adminOwnerId: 0,
        callerRole: "guest",
        fullscreen: Boolean(opts?.fullscreen),
        accessRejectEscalation: Boolean(opts?.fullscreen),
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
      const guestAvatar = String(
        (user as { avatar_url?: string } | null)?.avatar_url || "",
      ).trim();
      const payload = {
        type: "CALL_INVITE",
        data: {
          fullscreen: Boolean(opts?.fullscreen),
          access_reject_escalation: Boolean(opts?.fullscreen),
          ...(guestAvatar ? { guest_avatar_url: guestAvatar } : {}),
        },
      };
      if (sendCallAs("guest", payload)) return true;
      let attempts = 0;
      const timer = window.setInterval(() => {
        attempts += 1;
        if (!sessionRef.current || sessionRef.current.callId !== optimistic.callId) {
          window.clearInterval(timer);
          return;
        }
        if (sendCallAs("guest", payload) || attempts >= 15) {
          window.clearInterval(timer);
          if (attempts >= 15 && sessionRef.current?.callId === optimistic.callId) {
            void clearSession();
          }
        }
      }, 200);
      return true;
    },
    [clearSession, guestZoneIds, sendCallAs],
  );

  const roleForSession = (cur: GuestCallSession): GuestCallRole =>
    cur.isCaller ? cur.callerRole : cur.callerRole === "guest" ? "admin" : "guest";

  const acceptCall = useCallback(() => {
    const cur = sessionRef.current;
    if (!cur || cur.state !== "ringing" || cur.isCaller) return;
    if (cur.callId.startsWith("pending-")) return;
    sendCallAs(roleForSession(cur), {
      type: "CALL_ACCEPT",
      data: { call_id: cur.callId },
    });
  }, [sendCallAs]);

  const rejectCall = useCallback(() => {
    const cur = sessionRef.current;
    if (!cur || (cur.state !== "ringing" && cur.state !== "queued")) return;
    if (!cur.callId.startsWith("pending-")) {
      sendCallAs(roleForSession(cur), {
        type: cur.isCaller ? "CALL_CANCEL" : "CALL_REJECT",
        data: { call_id: cur.callId },
      });
    }
    void clearSession();
  }, [clearSession, sendCallAs]);

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
        data: { call_id: cur.callId },
      });
      void clearSession();
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [session, clearSession, sendCallAs]);

  const value = useMemo<GuestCallContextValue>(
    () => ({
      session,
      elapsedLabel,
      callBusy:
        Boolean(session) ||
        (guestToken ? !guestWsOpen : status === "connecting"),
      startAdminCall,
      startGuestCall,
      presentLocalOutgoingCall,
      acceptCall,
      rejectCall,
      cancelCall: rejectCall,
      endCall,
    }),
    [
      session,
      elapsedLabel,
      guestToken,
      guestWsOpen,
      status,
      startAdminCall,
      startGuestCall,
      presentLocalOutgoingCall,
      acceptCall,
      rejectCall,
      endCall,
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
