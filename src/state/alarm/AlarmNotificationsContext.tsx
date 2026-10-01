import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  alarmFromPropagation,
  alarmTitle,
  isAlarmType,
  notificationPermission,
  playAlarmSound,
  showBrowserAlarmNotification,
  showBrowserMessageNotification,
} from "../../lib/alarmNotifications";
import { parseMessageFeatureSocketEvent } from "../../services/socket/messageSocket";
import { useAuth } from "../../hooks/useAuth";
import { useWebSocket } from "../../hooks/useWebSocket";

export type ActiveAlarm = {
  id: string;
  type: string;
  title: string;
  body: string;
  createdAt: string;
};

type AlarmNotificationsContextValue = {
  activeAlarms: ActiveAlarm[];
  dismissAlarm: (id: string) => void;
  dismissAllAlarms: () => void;
  notificationPermission: ReturnType<typeof notificationPermission>;
};

const AlarmNotificationsContext = createContext<
  AlarmNotificationsContextValue | undefined
>(undefined);

function pushActiveAlarm(
  setActiveAlarms: (updater: (prev: ActiveAlarm[]) => ActiveAlarm[]) => void,
  next: ActiveAlarm,
) {
  setActiveAlarms((prev) => {
    const deduped = [next, ...prev.filter((row) => row.id !== next.id)];
    return deduped.slice(0, 5);
  });
}

export function AlarmNotificationsProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const { lastMessage } = useWebSocket({ token, zoneIds: [] });
  const [activeAlarms, setActiveAlarms] = useState<ActiveAlarm[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!lastMessage) return;

    try {
      const parsed = JSON.parse(lastMessage) as {
        type?: string;
        guest_name?: string;
        guest_id?: string;
        zone_id?: string;
        data?: Record<string, unknown>;
      };
      if (parsed.type === "unexpected_guest" || parsed.type === "guest_is_here") {
        const nested =
          parsed.data != null &&
          typeof parsed.data === "object" &&
          !Array.isArray(parsed.data)
            ? parsed.data
            : null;
        const guestId = String(nested?.guest_id ?? parsed.guest_id ?? "").trim();
        const guestName =
          String(nested?.guest_name ?? parsed.guest_name ?? "Guest").trim() || "Guest";
        const zoneId = String(nested?.zone_id ?? parsed.zone_id ?? "").trim();
        const idKey = guestId
          ? `guest-arrival:${guestId}`
          : `guest-arrival:${parsed.type}:${guestName}:${zoneId}`;
        if (seenIdsRef.current.has(idKey)) return;
        seenIdsRef.current.add(idKey);

        const isUnexpected = parsed.type === "unexpected_guest";
        const title = zoneId
          ? `${zoneId} · ${isUnexpected ? "Guest access request" : "Expected guest"}`
          : isUnexpected
            ? "Guest access request"
            : "Expected guest arrived";
        const body = isUnexpected
          ? `${guestName} is requesting access and awaiting approval.`
          : `${guestName} has arrived.`;

        showBrowserMessageNotification({ title, body, tag: idKey });
        try {
          playAlarmSound("SERVICE");
        } catch {
          /* ignore audio failures */
        }
        pushActiveAlarm(setActiveAlarms, {
          id: idKey,
          type: "PERMISSION",
          title,
          body,
          createdAt: new Date().toISOString(),
        });
        return;
      }
    } catch {
      /* fall through to geo alarm handling */
    }

    const event = parseMessageFeatureSocketEvent(lastMessage);
    if (!event || event.type !== "NEW_GEO_MESSAGE") return;
    const propagation = event.data;
    if (!isAlarmType(propagation.type)) return;

    const idKey = String(propagation.id || `${propagation.type}-${propagation.created_at}`);
    if (seenIdsRef.current.has(idKey)) return;
    seenIdsRef.current.add(idKey);

    const payload = alarmFromPropagation(propagation);
    if (!payload) return;

    showBrowserAlarmNotification(payload);
    try {
      playAlarmSound(propagation.type);
    } catch {
      /* ignore audio failures */
    }

    const title = alarmTitle(payload);
    const body = payload.text || title;
    const createdAt = propagation.created_at ?? new Date().toISOString();
    pushActiveAlarm(setActiveAlarms, {
      id: idKey,
      type: String(propagation.type ?? "ALARM"),
      title,
      body,
      createdAt,
    });
  }, [lastMessage]);

  const dismissAlarm = useCallback((id: string) => {
    setActiveAlarms((prev) => prev.filter((alarm) => alarm.id !== id));
  }, []);

  const dismissAllAlarms = useCallback(() => {
    setActiveAlarms([]);
  }, []);

  const value: AlarmNotificationsContextValue = {
    activeAlarms,
    dismissAlarm,
    dismissAllAlarms,
    notificationPermission: notificationPermission(),
  };

  return (
    <AlarmNotificationsContext.Provider value={value}>
      {children}
    </AlarmNotificationsContext.Provider>
  );
}

export function useAlarmNotifications(): AlarmNotificationsContextValue {
  const ctx = useContext(AlarmNotificationsContext);
  if (!ctx) {
    throw new Error(
      "useAlarmNotifications must be used within AlarmNotificationsProvider",
    );
  }
  return ctx;
}
