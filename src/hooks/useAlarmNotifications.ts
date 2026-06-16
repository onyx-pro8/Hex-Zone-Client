import { useEffect, useRef, useState } from "react";
import {
  alarmFromPropagation,
  isAlarmType,
  notificationPermission,
  playAlarmSound,
  showBrowserAlarmNotification,
} from "../lib/alarmNotifications";
import { parseMessageFeatureSocketEvent } from "../services/socket/messageSocket";
import { useWebSocket } from "./useWebSocket";

export type ActiveAlarm = {
  id: string;
  type: string;
  title: string;
  body: string;
  createdAt: string;
};

/**
 * Subscribe to the shared message-feature WebSocket and surface alarm-type
 * geo messages (UNKNOWN / PANIC / NS_PANIC / SENSOR) as:
 *   1. A browser system notification (when permission granted).
 *   2. A short audible beep.
 *   3. An in-memory list of "active" alarms for an in-app toast/banner.
 *
 * Designed to be mounted once globally (e.g. from a top-level layout) while
 * the user is authenticated — the underlying socket is shared via
 * `useWebSocket`, so calling this alongside `useMessageFeed` is safe.
 */
export function useAlarmNotifications(token: string | null) {
  const { lastMessage } = useWebSocket({ token, zoneIds: [] });
  const [activeAlarms, setActiveAlarms] = useState<ActiveAlarm[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!lastMessage) return;
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

    const title = `Hex Zone ${String(propagation.type ?? "ALARM").replace(/_/g, " ")}`;
    const body = payload.text || title;
    const createdAt = propagation.created_at ?? new Date().toISOString();
    setActiveAlarms((prev) => {
      const next: ActiveAlarm = {
        id: idKey,
        type: String(propagation.type ?? "ALARM"),
        title,
        body,
        createdAt,
      };
      const deduped = [next, ...prev.filter((row) => row.id !== idKey)];
      return deduped.slice(0, 5);
    });
  }, [lastMessage]);

  const dismissAlarm = (id: string) => {
    setActiveAlarms((prev) => prev.filter((alarm) => alarm.id !== id));
  };

  return {
    activeAlarms,
    dismissAlarm,
    notificationPermission: notificationPermission(),
  };
}
