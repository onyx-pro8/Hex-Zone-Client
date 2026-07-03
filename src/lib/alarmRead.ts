import type { Message } from "../services/api/messages";

export function withAlarmMarkedRead(message: Message, ownerId: number | string): Message {
  const viewerId = Number(ownerId);
  const readBy = [...(message.read_by_owner_ids ?? [])];
  if (Number.isFinite(viewerId) && viewerId > 0 && !readBy.includes(viewerId)) {
    readBy.push(viewerId);
  }
  return {
    ...message,
    is_read_by_viewer: true,
    read_by_owner_ids: readBy,
  };
}

export function isAlarmUnread(message: Message, ownerId: number | string): boolean {
  if (message.category !== "Alarm") return false;
  const viewerId = Number(ownerId);
  if (!Number.isFinite(viewerId) || viewerId <= 0) return false;
  if (typeof message.is_read_by_viewer === "boolean") {
    return !message.is_read_by_viewer;
  }
  const readBy = message.read_by_owner_ids ?? [];
  return !readBy.includes(viewerId);
}

export function countUnreadAlarms(messages: Message[], ownerId: number | string): number {
  return messages.filter((message) => isAlarmUnread(message, ownerId)).length;
}

export function unreadAlarmIds(messages: Message[], ownerId: number | string): string[] {
  return messages
    .filter((message) => isAlarmUnread(message, ownerId))
    .map((message) => message.id);
}

/** Count unread alarms once when the same alarm is in the inbox and live notification list. */
export function countUniqueUnreadAlarmBadge(
  alarmMessages: Message[],
  liveAlarms: { id: string }[],
  ownerId: number | string | null | undefined,
): number {
  if (ownerId == null) return liveAlarms.length;
  const ids = new Set(unreadAlarmIds(alarmMessages, ownerId));
  for (const alarm of liveAlarms) {
    const feedRow = alarmMessages.find((message) => message.id === alarm.id);
    if (!feedRow || isAlarmUnread(feedRow, ownerId)) {
      ids.add(alarm.id);
    }
  }
  return ids.size;
}
