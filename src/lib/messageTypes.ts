export const MESSAGE_CATEGORIES = ["Alarm", "Alert", "Access"] as const;
export type MessageCategory = (typeof MESSAGE_CATEGORIES)[number];

export const MESSAGE_SCOPES = ["public", "private"] as const;
export type MessageScope = (typeof MESSAGE_SCOPES)[number];

export const MESSAGE_TYPES = [
  "SENSOR",
  "PANIC",
  "NS_PANIC",
  "UNKNOWN",
  "PRIVATE",
  "PA",
  "SERVICE",
  "WELLNESS_CHECK",
  "PERMISSION",
  "CHAT",
] as const;

export type MessageType = (typeof MESSAGE_TYPES)[number];

type MessageTypeMeta = {
  displayLabel: string;
  category: MessageCategory;
  derivedScope: MessageScope;
};

const PRIVATE_MESSAGE_TYPES: ReadonlySet<MessageType> = new Set([
  "PRIVATE",
  "PERMISSION",
  "CHAT",
]);

export const MESSAGE_TYPE_META: Record<MessageType, MessageTypeMeta> = {
  SENSOR: { displayLabel: "SENSOR", category: "Alarm", derivedScope: "public" },
  PANIC: { displayLabel: "PANIC", category: "Alarm", derivedScope: "public" },
  NS_PANIC: { displayLabel: "NS PANIC", category: "Alarm", derivedScope: "public" },
  UNKNOWN: { displayLabel: "UNKNOWN", category: "Alarm", derivedScope: "public" },
  PRIVATE: { displayLabel: "PRIVATE", category: "Alert", derivedScope: "private" },
  PA: { displayLabel: "PA", category: "Alert", derivedScope: "public" },
  SERVICE: { displayLabel: "SERVICE", category: "Alert", derivedScope: "public" },
  WELLNESS_CHECK: {
    displayLabel: "WELLNESS CHECK",
    category: "Alert",
    derivedScope: "public",
  },
  PERMISSION: {
    displayLabel: "PERMISSION",
    category: "Access",
    derivedScope: "private",
  },
  CHAT: { displayLabel: "CHAT", category: "Access", derivedScope: "private" },
};

export function toMessageType(value: unknown): MessageType | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  if (!upper) return null;
  if ((MESSAGE_TYPES as readonly string[]).includes(upper)) return upper as MessageType;
  return null;
}

export function isPrivateMessageType(type: MessageType): boolean {
  return PRIVATE_MESSAGE_TYPES.has(type);
}

/** Access types where the member compose UI should address guests only (not owner-to-owner). */
export function isAccessGuestChannelType(type: MessageType): boolean {
  return type === "PERMISSION" || type === "CHAT";
}

/** Alarm/alert types that must use geo propagation (not legacy POST /messages). */
const GEO_PROPAGATION_MESSAGE_TYPES: ReadonlySet<MessageType> = new Set([
  "SENSOR",
  "PANIC",
  "NS_PANIC",
  "UNKNOWN",
  "PRIVATE",
  "PA",
  "SERVICE",
  "WELLNESS_CHECK",
]);

export function usesGeoPropagationMessageType(type: MessageType): boolean {
  return GEO_PROPAGATION_MESSAGE_TYPES.has(type);
}

export function toMessageTypeLabel(type: MessageType): string {
  return MESSAGE_TYPE_META[type].displayLabel;
}

export function getMessageTypeCategory(type: MessageType): MessageCategory {
  return MESSAGE_TYPE_META[type].category;
}

export function getMessageScopeForType(type: MessageType): MessageScope {
  return MESSAGE_TYPE_META[type].derivedScope;
}

export function groupMessageTypesForUI(): Array<{
  category: MessageCategory;
  options: Array<{ type: MessageType; label: string; scope: MessageScope }>;
}> {
  return MESSAGE_CATEGORIES.map((category) => ({
    category,
    options: MESSAGE_TYPES.filter((type) => MESSAGE_TYPE_META[type].category === category).map(
      (type) => ({
        type,
        label: toMessageTypeLabel(type),
        scope: getMessageScopeForType(type),
      }),
    ),
  }));
}
