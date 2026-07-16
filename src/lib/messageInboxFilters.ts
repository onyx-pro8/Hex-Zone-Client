import {
  MESSAGE_TYPE_META,
  MESSAGE_TYPES,
  toMessageTypeLabel,
  type MessageCategory,
  type MessageScope,
  type MessageType,
} from "./messageTypes";

/** Minimal message shape needed for inbox filtering. */
export type InboxFilterableMessage = {
  zone_id: string;
  sender_id: number;
  receiver_id: number | null;
  type: MessageType;
  category: MessageCategory;
  scope: MessageScope;
  message: string;
  created_at: string;
  guest_sender_id?: string;
  guest_id?: string | null;
};

export type MessageInboxFilterParams = {
  zoneFilter?: string;
  scopeFilter?: "all" | MessageScope;
  categoryFilter?: "all" | MessageCategory;
  typeFilter?: "all" | MessageType;
  /** Inclusive start day (YYYY-MM-DD). */
  dateFrom?: string;
  /** Inclusive end day (YYYY-MM-DD). */
  dateTo?: string;
  search?: string;
  /** Drop these categories before other filters (e.g. Alarm on Messages). */
  excludeCategories?: readonly MessageCategory[];
  /** Keep only these categories (e.g. Alarm on Incoming Alarms). */
  includeCategories?: readonly MessageCategory[];
};

export function messageCreatedDay(createdAt: string): string {
  const ms = new Date(createdAt).getTime();
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

export function messageMatchesKeyword(
  message: InboxFilterableMessage,
  rawQuery: string,
): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  const guestSenderMatch =
    message.guest_sender_id != null &&
    (message.guest_sender_id.toLowerCase().includes(q) ||
      (q.length > 0 && "guest".startsWith(q)));
  const guestIdMatch =
    message.guest_id != null &&
    typeof message.guest_id === "string" &&
    message.guest_id.toLowerCase().includes(q);
  return (
    message.message.toLowerCase().includes(q) ||
    message.zone_id.toLowerCase().includes(q) ||
    String(message.sender_id).includes(q) ||
    String(message.receiver_id ?? "").includes(q) ||
    guestSenderMatch ||
    guestIdMatch
  );
}

export function messageMatchesDateRange(
  message: InboxFilterableMessage,
  dateFrom: string,
  dateTo: string,
): boolean {
  const from = dateFrom.trim();
  const to = dateTo.trim();
  if (!from && !to) return true;
  const ymd = messageCreatedDay(message.created_at);
  if (!ymd) return false;
  if (from && ymd < from) return false;
  if (to && ymd > to) return false;
  return true;
}

export function applyMessageInboxFilters<T extends InboxFilterableMessage>(
  messages: readonly T[],
  params: MessageInboxFilterParams,
): T[] {
  const zoneFilter = params.zoneFilter ?? "all";
  const scopeFilter = params.scopeFilter ?? "all";
  const categoryFilter = params.categoryFilter ?? "all";
  const typeFilter = params.typeFilter ?? "all";
  const dateFrom = params.dateFrom ?? "";
  const dateTo = params.dateTo ?? "";
  const search = params.search ?? "";
  const exclude = params.excludeCategories;
  const include = params.includeCategories;

  return messages.filter((message) => {
    if (exclude?.includes(message.category)) return false;
    if (include && include.length > 0 && !include.includes(message.category)) {
      return false;
    }
    if (zoneFilter !== "all" && message.zone_id !== zoneFilter) return false;
    if (scopeFilter !== "all" && message.scope !== scopeFilter) return false;
    if (categoryFilter !== "all" && message.category !== categoryFilter) {
      return false;
    }
    if (typeFilter !== "all" && message.type !== typeFilter) return false;
    if (!messageMatchesDateRange(message, dateFrom, dateTo)) return false;
    return messageMatchesKeyword(message, search);
  });
}

export function messageTypesForCategories(
  categories: readonly MessageCategory[],
): Array<{ type: MessageType; label: string; category: MessageCategory }> {
  const allowed = new Set(categories);
  return MESSAGE_TYPES.filter((type) =>
    allowed.has(MESSAGE_TYPE_META[type].category),
  ).map((type) => ({
    type,
    label: toMessageTypeLabel(type),
    category: MESSAGE_TYPE_META[type].category,
  }));
}

export function groupMessageTypesForCategories(
  categories: readonly MessageCategory[],
): Array<{
  category: MessageCategory;
  options: Array<{ type: MessageType; label: string }>;
}> {
  return categories.map((category) => ({
    category,
    options: messageTypesForCategories([category]).map(({ type, label }) => ({
      type,
      label,
    })),
  }));
}
