import type { Message } from "../services/api/messages";

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
