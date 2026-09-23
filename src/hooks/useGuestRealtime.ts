import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultRealtimeWsBase } from "../services/socket/messageSocket";

type PresenceMap = Record<number, boolean>;

function parseMemberPresence(raw: string): { ownerId: number; online: boolean } | null {
  try {
    const parsed = JSON.parse(raw) as { type?: unknown; data?: unknown };
    if (parsed.type !== "MEMBER_PRESENCE") return null;
    const data =
      parsed.data != null && typeof parsed.data === "object" && !Array.isArray(parsed.data)
        ? (parsed.data as Record<string, unknown>)
        : {};
    const rawId = data.owner_id ?? data.ownerId;
    const ownerId =
      typeof rawId === "number"
        ? rawId
        : typeof rawId === "string" && rawId.trim()
          ? Number(rawId)
          : NaN;
    if (!Number.isFinite(ownerId) || ownerId <= 0) return null;
    if (typeof data.online !== "boolean") return null;
    return { ownerId, online: data.online };
  } catch {
    return null;
  }
}

/**
 * Isolated guest WebSocket — receives live **MEMBER_PRESENCE** for peer dots.
 * Does not share the member AuthContext socket.
 */
export function useGuestRealtime(params: {
  token: string | null;
  zoneIds: string[];
  enabled?: boolean;
  seedPresence?: PresenceMap;
}): {
  status: "connecting" | "open" | "closed";
  isPeerOnline: (ownerId: string | number | null | undefined) => boolean;
  lastMessage: string | null;
} {
  const { token, zoneIds, enabled = true, seedPresence } = params;
  const [status, setStatus] = useState<"connecting" | "open" | "closed">("closed");
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const [presence, setPresence] = useState<PresenceMap>({});
  const wsRef = useRef<WebSocket | null>(null);
  const zoneKey = useMemo(() => JSON.stringify(zoneIds), [zoneIds]);

  useEffect(() => {
    if (!seedPresence) return;
    setPresence((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [k, v] of Object.entries(seedPresence)) {
        const id = Number(k);
        if (!Number.isFinite(id) || id <= 0) continue;
        if (next[id] !== v) {
          next[id] = v;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [seedPresence]);

  useEffect(() => {
    if (!enabled || !token?.trim()) {
      setStatus("closed");
      return;
    }
    let closed = false;
    let reconnectTimer: number | null = null;
    let attempt = 0;

    const connect = () => {
      if (closed) return;
      setStatus("connecting");
      const url = `${defaultRealtimeWsBase()}?token=${encodeURIComponent(token.trim())}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (closed) return;
        attempt = 0;
        setStatus("open");
        const ids = zoneIds.map((z) => z.trim()).filter(Boolean);
        if (ids.length) {
          ws.send(JSON.stringify({ type: "SUBSCRIBE", zoneIds: ids }));
        }
      };

      ws.onmessage = (ev) => {
        if (closed) return;
        const raw = typeof ev.data === "string" ? ev.data : "";
        if (!raw) return;
        setLastMessage(raw);
        const presenceEv = parseMemberPresence(raw);
        if (presenceEv) {
          setPresence((prev) => {
            if (prev[presenceEv.ownerId] === presenceEv.online) return prev;
            return { ...prev, [presenceEv.ownerId]: presenceEv.online };
          });
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (closed) {
          setStatus("closed");
          return;
        }
        setStatus("closed");
        const delay = Math.min(30_000, 1000 * 2 ** attempt);
        attempt += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      };

      ws.onerror = () => {
        /* onclose handles reconnect */
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
      }
      setStatus("closed");
    };
  }, [token, enabled, zoneKey]);

  const isPeerOnline = useCallback(
    (ownerId: string | number | null | undefined) => {
      if (ownerId == null || ownerId === "") return false;
      const id = typeof ownerId === "number" ? ownerId : Number(String(ownerId).trim());
      if (!Number.isFinite(id) || id <= 0) return false;
      return presence[id] === true;
    },
    [presence],
  );

  return { status, isPeerOnline, lastMessage };
}
