import { useCallback, useEffect, useMemo, useState } from "react";
import {
  defaultRealtimeWsBase,
  parseWellnessAckBroadcast,
  WELLNESS_ACK_EVENT,
} from "../services/socket/messageSocket";

/**
 * Reusable WebSocket hook for React 18 + Strict Mode.
 *
 * Key decisions:
 * - **Single socket per `url` lifecycle:** The effect owns the socket; `wsRef` holds the active instance.
 * - **Deps only `url` + `enabled`:** Handlers and backoff tuning live in `optsRef` so callback identity does not recreate connections.
 * - **Strict Mode:** Cleanup sets `manualCloseRef` before `close()`, so `onclose` never schedules reconnect; ref resets after cleanup for the remount.
 * - **Reconnect:** Exponential backoff with jitter; only when close was not user-initiated and `reconnect` is true.
 * - **Logging:** URLs are logged with `token` query redacted; message bodies truncated (never log JWTs).
 */

export type WebSocketStatus = "connecting" | "open" | "closed";

export type UseWebSocketParams = {
  token: string | null;
  zoneIds: string[];
};

const LOG_PREFIX = "[WebSocket]";

function maskUrlForLog(url: string): string {
  try {
    const u = new URL(url);
    if (u.searchParams.has("token")) {
      u.searchParams.set("token", "<redacted>");
    }
    return u.toString();
  } catch {
    return url.replace(/([?&]token=)[^&]*/i, "$1<redacted>");
  }
}

function log(level: "log" | "warn" | "error", message: string, ...meta: unknown[]) {
  console[level](LOG_PREFIX, message, ...meta);
}

function previewPayload(data: string, max = 500): string {
  if (data.length <= max) return data;
  return `${data.slice(0, max)}…`;
}

type Snapshot = {
  status: WebSocketStatus;
  lastMessage: string | null;
};

type Listener = (snapshot: Snapshot) => void;

type SharedManager = {
  ws: WebSocket | null;
  status: WebSocketStatus;
  lastMessage: string | null;
  listeners: Set<Listener>;
  reconnectTimer: number | null;
  reconnectAttempt: number;
  activeUsers: number;
  token: string | null;
  zoneIds: string[];
  connectionSeq: number;
};

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const sharedManager: SharedManager = {
  ws: null,
  status: "closed",
  lastMessage: null,
  listeners: new Set(),
  reconnectTimer: null,
  reconnectAttempt: 0,
  activeUsers: 0,
  token: null,
  zoneIds: [],
  connectionSeq: 0,
};

function snapshot(): Snapshot {
  return {
    status: sharedManager.status,
    lastMessage: sharedManager.lastMessage,
  };
}

function emitSnapshot() {
  const next = snapshot();
  for (const listener of sharedManager.listeners) {
    listener(next);
  }
}

function clearReconnectTimer() {
  if (sharedManager.reconnectTimer != null) {
    window.clearTimeout(sharedManager.reconnectTimer);
    sharedManager.reconnectTimer = null;
  }
}

function closeSocket(reason: string) {
  clearReconnectTimer();
  const ws = sharedManager.ws;
  sharedManager.ws = null;
  if (ws) {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    ws.close(1000, reason);
  }
  sharedManager.status = "closed";
  emitSnapshot();
}

function buildSocketUrl(token: string): string {
  const base = defaultRealtimeWsBase();
  return `${base}?token=${encodeURIComponent(token)}`;
}

function sendSubscribeFrame() {
  if (sharedManager.zoneIds.length === 0) return;
  const ws = sharedManager.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const frame = JSON.stringify({
    type: "SUBSCRIBE",
    zoneIds: sharedManager.zoneIds,
  });
  ws.send(frame);
  log("log", "initial frame sent", previewPayload(frame, 200));
}

function scheduleReconnect() {
  if (!sharedManager.token || sharedManager.activeUsers === 0) return;
  clearReconnectTimer();
  const backoff = Math.min(
    MAX_BACKOFF_MS,
    INITIAL_BACKOFF_MS * 2 ** sharedManager.reconnectAttempt,
  );
  sharedManager.reconnectAttempt += 1;
  const jitter = Math.floor(Math.random() * 400);
  const delay = backoff + jitter;
  log("log", "reconnect scheduled", {
    delayMs: delay,
    attempt: sharedManager.reconnectAttempt,
  });
  sharedManager.reconnectTimer = window.setTimeout(() => {
    sharedManager.reconnectTimer = null;
    connectSocket();
  }, delay);
}

function connectSocket() {
  if (!sharedManager.token || sharedManager.activeUsers === 0) return;
  if (
    sharedManager.ws &&
    (sharedManager.ws.readyState === WebSocket.OPEN ||
      sharedManager.ws.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  const token = sharedManager.token;
  const url = buildSocketUrl(token);
  sharedManager.status = "connecting";
  emitSnapshot();

  const connectionId = ++sharedManager.connectionSeq;
  log("log", `connecting #${connectionId}`, maskUrlForLog(url));

  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch (error) {
    log("error", `constructor failed #${connectionId}`, error);
    sharedManager.status = "closed";
    emitSnapshot();
    scheduleReconnect();
    return;
  }

  sharedManager.ws = ws;

  ws.onopen = () => {
    if (sharedManager.ws !== ws) return;
    sharedManager.reconnectAttempt = 0;
    sharedManager.status = "open";
    emitSnapshot();
    log("log", `open #${connectionId}`);
    sendSubscribeFrame();
  };

  ws.onmessage = (event) => {
    if (sharedManager.ws !== ws) return;
    const payload = typeof event.data === "string" ? event.data : String(event.data);
    sharedManager.lastMessage = payload;
    emitSnapshot();
    const ack = parseWellnessAckBroadcast(payload);
    if (ack && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(WELLNESS_ACK_EVENT, { detail: ack }),
      );
    }
    log("log", `message #${connectionId}`, previewPayload(payload));
  };

  ws.onerror = (event) => {
    if (sharedManager.ws !== ws) return;
    log("error", `error #${connectionId}`, event);
  };

  ws.onclose = (event) => {
    if (sharedManager.ws === ws) {
      sharedManager.ws = null;
    }
    sharedManager.status = "closed";
    emitSnapshot();
    log("warn", `close #${connectionId}`, {
      code: event.code,
      reason: event.reason || "(none)",
      wasClean: event.wasClean,
    });
    if (sharedManager.activeUsers > 0) {
      scheduleReconnect();
    }
  };
}

function setToken(token: string | null) {
  if (sharedManager.token === token) return;
  sharedManager.token = token;
  closeSocket("token updated");
  if (token) {
    connectSocket();
  }
}

function setZoneIds(zoneIds: string[]) {
  const same =
    sharedManager.zoneIds.length === zoneIds.length &&
    sharedManager.zoneIds.every((id, idx) => id === zoneIds[idx]);
  if (same) return;
  sharedManager.zoneIds = [...zoneIds];
  sendSubscribeFrame();
}

export function useWebSocket({ token, zoneIds }: UseWebSocketParams) {
  const [state, setState] = useState<Snapshot>(() => snapshot());
  const zoneKey = useMemo(() => JSON.stringify(zoneIds), [zoneIds]);

  useEffect(() => {
    const listener: Listener = (next) => setState(next);
    sharedManager.listeners.add(listener);
    sharedManager.activeUsers += 1;
    setToken(token);
    setZoneIds(zoneIds);
    connectSocket();

    return () => {
      sharedManager.listeners.delete(listener);
      sharedManager.activeUsers = Math.max(0, sharedManager.activeUsers - 1);
      if (sharedManager.activeUsers === 0) {
        closeSocket("no subscribers");
      }
    };
    // Keep this stable for Strict Mode and avoid reconnecting on each render.
    // `zoneIds` updates are handled in the dedicated effect below.
  }, [token]);

  useEffect(() => {
    setZoneIds(zoneIds);
  }, [zoneKey]);

  const sendMessage = useCallback((payload: unknown) => {
    const ws = sharedManager.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    const data = typeof payload === "string" ? payload : JSON.stringify(payload);
    ws.send(data);
    log("log", "send", previewPayload(data, 200));
    return true;
  }, []);

  return {
    status: state.status,
    lastMessage: state.lastMessage,
    sendMessage,
  };
}

/**
 * Example usage:
 *
 * ```tsx
 * const { status, lastMessage, sendMessage } = useWebSocket({
 *   token,
 *   zoneIds: ["zone-123"],
 * });
 *
 * useEffect(() => {
 *   if (status === "open") {
 *     sendMessage({ type: "PING" });
 *   }
 * }, [status, sendMessage]);
 *
 * console.log(status, lastMessage);
 * ```
 */
