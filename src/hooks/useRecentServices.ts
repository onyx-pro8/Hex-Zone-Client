import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listMessages,
  messageFromGeoPropagation,
  type Message,
} from "../services/api/messages";
import { listMessageFeatureBlocks } from "../services/api/messageFeature";
import { filterMessagesForBlocks } from "../lib/messageBlocks";
import { filterDashboardServiceMessages } from "../lib/recentServicesFilter";
import {
  parseMessageFeatureSocketEvent,
  shouldShowGeoPropagationInInbox,
} from "../services/socket/messageSocket";
import { useAuth } from "./useAuth";
import { useWebSocket } from "./useWebSocket";

const FETCH_LIMIT = 100;
const POLL_MS = 30_000;

function sortNewest(list: Message[]) {
  return [...list].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
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
      setServices(sortNewest(filterDashboardServiceMessages(batch, normalizedZoneId)));
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
      setServices((prev) =>
        sortNewest([
          incoming,
          ...prev.filter((row) => row.id !== incoming.id),
        ]),
      );
      setError(null);
    },
    [],
  );

  const { lastMessage } = useWebSocket({ token, zoneIds });

  useEffect(() => {
    if (!lastMessage) return;

    const event = parseMessageFeatureSocketEvent(lastMessage);
    if (event?.type === "NEW_MESSAGE") {
      if (event.data.type === "SERVICE") prependService(event.data);
      scheduleRefresh();
      return;
    }
    if (event?.type === "NEW_GEO_MESSAGE") {
      if (Number.isFinite(ownerId) && ownerId > 0) {
        if (shouldShowGeoPropagationInInbox(event.data, ownerId)) {
          const row = messageFromGeoPropagation(event.data);
          if (row?.type === "SERVICE") prependService(row);
        }
      }
      scheduleRefresh();
      return;
    }

    try {
      const parsed = JSON.parse(lastMessage) as { type?: string };
      if (
        parsed.type === "NEW_MESSAGE" ||
        parsed.type === "NEW_GEO_MESSAGE"
      ) {
        scheduleRefresh();
      }
    } catch {
      /* ignore */
    }
  }, [lastMessage, ownerId, prependService, scheduleRefresh]);

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
