import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { useMessageFeed } from "../../hooks/useMessageFeed";
import { useAuth } from "../../hooks/useAuth";
import { unreadAlarmIds } from "../../lib/alarmRead";
import { markAlarmsRead } from "../../services/api/messageFeature";
import type { Message } from "../../services/api/messages";

type AlarmInboxContextValue = {
  alarmMessages: Message[];
  markAlarmsSeen: (extraIds?: string[]) => Promise<void>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const AlarmInboxContext = createContext<AlarmInboxContextValue | undefined>(
  undefined,
);

export function AlarmInboxProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const ownerId = user?.id;
  const numericOwnerId = Number(ownerId);
  const { messages, loading, error, refreshInbox, markAlarmsReadLocally } =
    useMessageFeed([]);

  const alarmMessages = useMemo(
    () => messages.filter((message) => message.category === "Alarm"),
    [messages],
  );

  const markAlarmsSeen = useCallback(
    async (extraIds: string[] = []) => {
      if (!Number.isFinite(numericOwnerId) || numericOwnerId <= 0) return;
      const ids = [
        ...new Set([
          ...unreadAlarmIds(alarmMessages, numericOwnerId),
          ...extraIds.filter(Boolean),
        ]),
      ];
      if (ids.length === 0) return;

      markAlarmsReadLocally(ids);
      const result = await markAlarmsRead(ids);
      if (result.error) {
        console.warn("[AlarmInbox] markAlarmsRead failed:", result.error);
      }
      await refreshInbox();
    },
    [alarmMessages, markAlarmsReadLocally, numericOwnerId, refreshInbox],
  );

  useEffect(() => {
    if (pathname === "/alerts") {
      void markAlarmsSeen();
    }
  }, [pathname, markAlarmsSeen]);

  const value = useMemo<AlarmInboxContextValue>(
    () => ({
      alarmMessages,
      markAlarmsSeen,
      loading,
      error,
      refresh: refreshInbox,
    }),
    [alarmMessages, markAlarmsSeen, loading, error, refreshInbox],
  );

  return (
    <AlarmInboxContext.Provider value={value}>{children}</AlarmInboxContext.Provider>
  );
}

export function useAlarmInbox(): AlarmInboxContextValue {
  const ctx = useContext(AlarmInboxContext);
  if (!ctx) {
    throw new Error("useAlarmInbox must be used within AlarmInboxProvider");
  }
  return ctx;
}
