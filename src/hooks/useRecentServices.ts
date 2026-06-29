import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listMessages, type Message } from "../services/api/messages";
import { listMessageFeatureBlocks } from "../services/api/messageFeature";
import { filterMessagesForBlocks } from "../lib/messageBlocks";
import { parseMessageSocketPayload } from "../services/socket/messageSocket";
import { useAuth } from "./useAuth";
import { useWebSocket } from "./useWebSocket";

const FETCH_LIMIT = 100;
const POLL_MS = 30_000;

function sortNewest(list: Message[]) {
  return [...list].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

function filterServiceMessages(batch: Message[], zoneId: string): Message[] {
  const services = batch.filter((row) => row.type === "SERVICE");
  if (!zoneId) return services;
  return services.filter((row) => row.zone_id === zoneId);
}

export function useRecentServices(zoneId?: string) {
  const { token, user } = useAuth();
  const ownerId = Number(user?.id);
  const normalizedZoneId = zoneId?.trim() ?? "";
  const [services, setServices] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refetchDebounceRef = useRef<number | undefined>(undefined);

  const zoneIds = useMemo(
    () => (normalizedZoneId ? [normalizedZoneId] : []),
    [normalizedZoneId],
  );

  const applyBatch = useCallback(
    (batch: Message[]) => {
      setServices(sortNewest(filterServiceMessages(batch, normalizedZoneId)));
      setError(null);
    },
    [normalizedZoneId],
  );

  const refresh = useCallback(async () => {
    if (!Number.isFinite(ownerId) || ownerId <= 0 || !token) return;
    setLoading(true);
    try {
      const [messagesResult, blocksResult] = await Promise.all([
        listMessages({ owner_id: ownerId, skip: 0, limit: FETCH_LIMIT }),
        listMessageFeatureBlocks(),
      ]);
      if (messagesResult.error) {
        setError(messagesResult.error);
        return;
      }
      const blocks = blocksResult.error ? [] : (blocksResult.data ?? []);
      const visible = filterMessagesForBlocks(messagesResult.data ?? [], blocks);
      applyBatch(visible);
    } finally {
      setLoading(false);
    }
  }, [ownerId, token, applyBatch]);

  const scheduleRefresh = useCallback(() => {
    window.clearTimeout(refetchDebounceRef.current);
    refetchDebounceRef.current = window.setTimeout(() => {
      void refresh();
    }, 400);
  }, [refresh]);

  const prependService = useCallback(
    (incoming: Message) => {
      if (incoming.type !== "SERVICE") return;
      if (normalizedZoneId && incoming.zone_id !== normalizedZoneId) return;
      setServices((prev) =>
        sortNewest([
          incoming,
          ...prev.filter((row) => row.id !== incoming.id),
        ]),
      );
      setError(null);
    },
    [normalizedZoneId],
  );

  const { lastMessage } = useWebSocket({ token, zoneIds });

  useEffect(() => {
    if (!lastMessage) return;
    const row = parseMessageSocketPayload(lastMessage);
    if (row) {
      if (row.type === "SERVICE") prependService(row);
      scheduleRefresh();
      return;
    }
    try {
      const parsed = JSON.parse(lastMessage) as { type?: string };
      if (parsed.type === "NEW_MESSAGE") scheduleRefresh();
    } catch {
      /* ignore */
    }
  }, [lastMessage, prependService, scheduleRefresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!Number.isFinite(ownerId) || ownerId <= 0 || !token) return;
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [ownerId, token, refresh]);

  useEffect(() => {
    return () => {
      if (refetchDebounceRef.current) window.clearTimeout(refetchDebounceRef.current);
    };
  }, []);

  return { services, loading, error, refresh };
}
