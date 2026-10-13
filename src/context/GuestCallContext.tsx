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
  sessionFromCallPayload,
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

type StartAdminCallArgs = {
  guestId: string;
  zoneId: string;
  guestName?: string;
  fullscreen?: boolean;
};

type GuestCallContextValue = {
  session: GuestCallSession | null;
  elapsedLabel: string;
  callBusy: boolean;
  startAdminCall: (args: StartAdminCallArgs) => boolean;
  startGuestCall: (opts?: { fullscreen?: boolean }) => boolean;
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
    const tick = () => setLabel(formatCallDuration((Date.now() - start) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [acceptedAt, active]);
  return label;
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

  useEffect(() => {
    const sync = () => {
      setGuestToken(getGuestAccessToken());
      const meta = getGuestSessionMeta();
      setGuestZoneIds(
        meta?.zone_ids?.length ? meta.zone_ids : meta?.zone_id ? [meta.zone_id] : [],
      );
    };
    sync();
    const id = window.setInterval(sync, 3000);
    window.addEventListener("storage", sync);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const memberZoneIds = user?.zone_id ? [String(user.zone_id)] : [];
  const { lastMessage, sendMessage, status } = useWebSocket({
    token: memberToken,
    zoneIds: memberZoneIds,
  });

  const guestWsRef = useRef<WebSocket | null>(null);
  const [guestLastMessage, setGuestLastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!guestToken) {
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
    const url = `${defaultRealtimeWsBase()}?token=${encodeURIComponent(guestToken)}`;
    const ws = new WebSocket(url);
    guestWsRef.current = ws;
    ws.onopen = () => {
      if (guestZoneIds.length) {
        ws.send(JSON.stringify({ type: "SUBSCRIBE", zoneIds: guestZoneIds }));
      }
    };
    ws.onmessage = (ev) => {
      const raw = typeof ev.data === "string" ? ev.data : "";
      if (raw) setGuestLastMessage(raw);
    };
    return () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      if (guestWsRef.current === ws) guestWsRef.current = null;
    };
  }, [guestToken, guestZoneIds]);

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

  const clearSession = useCallback(async () => {
    setSession(null);
    await stopGuestCallMedia();
  }, []);

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
      const ev = parseGuestCallSocketMessage(raw);
      if (!ev) return;
      if (ev.type === "CALL_SIGNAL") {
        const signal = ev.data.signal;
        if (signal && typeof signal === "object") {
          await handleGuestCallSignal(
            signal as Parameters<typeof handleGuestCallSignal>[0],
            (out) => {
              const callId = String(ev.data.call_id ?? sessionRef.current?.callId ?? "");
              if (!callId) return;
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
        await clearSession();
        return;
      }
      if (ev.type === "CALL_INVITE" || ev.type === "CALL_ACCEPT") {
        const next = sessionFromCallPayload(ev.data, { localRole: asRole });
        if (!next) return;
        if (ev.type === "CALL_ACCEPT") {
          next.state = "connected";
          if (!next.acceptedAt) next.acceptedAt = new Date().toISOString();
          setSession(next);
          await beginMedia(next);
          return;
        }
        setSession(next);
      }
    },
    [beginMedia, clearSession, sendCallAs],
  );

  useEffect(() => {
    void applyEvent(lastMessage, "admin");
  }, [lastMessage, applyEvent]);

  useEffect(() => {
    void applyEvent(guestLastMessage, "guest");
  }, [guestLastMessage, applyEvent]);

  const elapsedLabel = useElapsed(
    session?.acceptedAt ?? null,
    session?.state === "connected",
  );

  const startAdminCall = useCallback(
    (args: StartAdminCallArgs) => {
      if (sessionRef.current) return false;
      return sendCallAs("admin", {
        type: "CALL_INVITE",
        data: {
          guest_id: args.guestId,
          zone_id: args.zoneId,
          guest_name: args.guestName || "Guest",
          fullscreen: Boolean(args.fullscreen),
        },
      });
    },
    [sendCallAs],
  );

  const startGuestCall = useCallback(
    (opts?: { fullscreen?: boolean }) => {
      if (sessionRef.current) return false;
      if (!guestToken) return false;
      return sendCallAs("guest", {
        type: "CALL_INVITE",
        data: { fullscreen: Boolean(opts?.fullscreen) },
      });
    },
    [guestToken, sendCallAs],
  );

  const roleForSession = (cur: GuestCallSession): GuestCallRole =>
    cur.isCaller ? cur.callerRole : cur.callerRole === "guest" ? "admin" : "guest";

  const acceptCall = useCallback(() => {
    const cur = sessionRef.current;
    if (!cur || cur.state !== "ringing" || cur.isCaller) return;
    sendCallAs(roleForSession(cur), {
      type: "CALL_ACCEPT",
      data: { call_id: cur.callId },
    });
  }, [sendCallAs]);

  const rejectCall = useCallback(() => {
    const cur = sessionRef.current;
    if (!cur || cur.state !== "ringing") return;
    sendCallAs(roleForSession(cur), {
      type: cur.isCaller ? "CALL_CANCEL" : "CALL_REJECT",
      data: { call_id: cur.callId },
    });
    void clearSession();
  }, [clearSession, sendCallAs]);

  const endCall = useCallback(() => {
    const cur = sessionRef.current;
    if (!cur) return;
    sendCallAs(roleForSession(cur), {
      type: "CALL_END",
      data: { call_id: cur.callId },
    });
    void clearSession();
  }, [clearSession, sendCallAs]);

  const value = useMemo<GuestCallContextValue>(
    () => ({
      session,
      elapsedLabel,
      callBusy: Boolean(session) || status === "connecting",
      startAdminCall,
      startGuestCall,
      acceptCall,
      rejectCall,
      cancelCall: rejectCall,
      endCall,
    }),
    [
      session,
      elapsedLabel,
      status,
      startAdminCall,
      startGuestCall,
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
