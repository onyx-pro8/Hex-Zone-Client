import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listMessages, type Message } from "../services/api/messages";
import { listMessageFeatureBlocks, type MessageFeatureBlock } from "../services/api/messageFeature";
import { filterMessagesForBlocks } from "../lib/messageBlocks";
import { parseInboxSocketRefetchSignal } from "../services/socket/messageSocket";
import { useAuth } from "./useAuth";
import { useAppState } from "../state/app/AppStateContext";
import { useWebSocket } from "./useWebSocket";

function sortByNewest(list: Message[]) {
  return [...list].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

// Polls `GET /messages` + `GET /message-feature/blocks` while the user is
// active. Polling is the **fallback** path; the WebSocket triggers the same
// hydrate on the fly via `parseInboxSocketRefetchSignal`. Loop is built around
// refs so React Strict Mode and dependency changes (block rules, callbacks)
// never schedule a second concurrent poll, which previously caused an O(N)
// loop hammering the API multiple times per second.
const POLL_INTERVAL_MS = 30_000;

export function useMessageFeed(zoneIds: string[]) {
  const { token, user } = useAuth();
  const { setMessages: setGlobalMessages } = useAppState();
  const [messages, setLocalMessages] = useState<Message[]>([]);
  const [blockRules, setBlockRules] = useState<MessageFeatureBlock[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ownerId = Number(user?.id);
  const refetchDebounceRef = useRef<number | undefined>(undefined);
  const blockRulesRef = useRef<MessageFeatureBlock[]>([]);
  const setGlobalMessagesRef = useRef(setGlobalMessages);

  useEffect(() => {
    blockRulesRef.current = blockRules;
  }, [blockRules]);

  useEffect(() => {
    setGlobalMessagesRef.current = setGlobalMessages;
  }, [setGlobalMessages]);

  const applyInboxBatch = useCallback((batch: Message[], blocks: MessageFeatureBlock[]) => {
    const visible = filterMessagesForBlocks(batch, blocks);
    if (visible.length > 0) {
      setLocalMessages(sortByNewest(visible));
    } else {
      setLocalMessages([]);
      setGlobalMessagesRef.current([]);
    }
  }, []);

  const hydrateInbox = useCallback(async () => {
    if (!Number.isFinite(ownerId) || ownerId <= 0 || !token) {
      return;
    }
    const [messagesResult, blocksResult] = await Promise.all([
      listMessages({
        owner_id: ownerId,
        skip: 0,
        limit: 100,
      }),
      listMessageFeatureBlocks(),
    ]);
    const rules = blocksResult.error
      ? blockRulesRef.current
      : (blocksResult.data ?? []);
    if (!blocksResult.error) {
      setBlockRules(rules);
    }
    if (messagesResult.error) {
      setError(messagesResult.error);
    } else {
      const batch = messagesResult.data ?? [];
      setError(null);
      applyInboxBatch(batch, rules);
    }
  }, [ownerId, token, applyInboxBatch]);

  const scheduleInboxRefetchFromSocket = useCallback(() => {
    window.clearTimeout(refetchDebounceRef.current);
    refetchDebounceRef.current = window.setTimeout(() => {
      void hydrateInbox();
    }, 400);
  }, [hydrateInbox]);

  const { lastMessage, status } = useWebSocket({
    token,
    zoneIds,
  });

  useEffect(() => {
    if (!lastMessage) return;
    if (!parseInboxSocketRefetchSignal(lastMessage)) return;
    scheduleInboxRefetchFromSocket();
  }, [lastMessage, scheduleInboxRefetchFromSocket]);

  useEffect(() => {
    return () => {
      if (refetchDebounceRef.current) window.clearTimeout(refetchDebounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (status === "closed" && token) {
      setError(null);
      return;
    }
    if (status === "open") {
      setError(null);
    }
  }, [status, token]);

  useEffect(() => {
    if (!Number.isFinite(ownerId) || ownerId <= 0 || !token) {
      setLocalMessages([]);
      setGlobalMessagesRef.current([]);
      return;
    }
    let active = true;
    let pollTimer: number | undefined;
    let inFlight = false;

    const poll = async () => {
      if (!active || inFlight) {
        if (active && !pollTimer) {
          pollTimer = window.setTimeout(poll, POLL_INTERVAL_MS);
        }
        return;
      }
      inFlight = true;
      setLoading(true);
      try {
        const [messagesResult, blocksResult] = await Promise.all([
          listMessages({
            owner_id: ownerId,
            skip: 0,
            limit: 100,
          }),
          listMessageFeatureBlocks(),
        ]);
        if (!active) return;
        const rules = blocksResult.error
          ? blockRulesRef.current
          : (blocksResult.data ?? []);
        if (!blocksResult.error) {
          setBlockRules(rules);
        }
        if (messagesResult.error) {
          setError(messagesResult.error);
        } else {
          setError(null);
          applyInboxBatch(messagesResult.data ?? [], rules);
        }
      } finally {
        inFlight = false;
        if (active) setLoading(false);
        if (active) pollTimer = window.setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    void poll();

    return () => {
      active = false;
      if (pollTimer) window.clearTimeout(pollTimer);
    };
  }, [token, ownerId, applyInboxBatch]);

  useEffect(() => {
    setGlobalMessages(messages);
  }, [messages, setGlobalMessages]);

  const zones = useMemo(
    () => Array.from(new Set(messages.map((msg) => msg.zone_id))),
    [messages],
  );

  return { messages, zones, loading, error, refreshInbox: hydrateInbox };
}
