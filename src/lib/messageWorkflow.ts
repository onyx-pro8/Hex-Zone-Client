import type { MessageType } from "./messageTypes";

export type MessagePriority = "CRITICAL" | "MAX" | "HIGH" | "MEDIUM" | "LOW";

export type MessageWorkflowMeta = {
  priority: MessagePriority;
  description: string;
  delivery: string;
  requiresAdmin: boolean;
  requiresRecipient: boolean;
  requiresLocation: boolean;
  responseTracking: boolean;
  confirmBeforeSend: boolean;
};

export const MESSAGE_WORKFLOW: Record<
  | "SENSOR"
  | "PANIC"
  | "NS_PANIC"
  | "UNKNOWN"
  | "PRIVATE"
  | "PA"
  | "SERVICE"
  | "WELLNESS_CHECK",
  MessageWorkflowMeta
> = {
  SENSOR: {
    priority: "MEDIUM",
    description:
      "Telemetry alert from your location. Broadcast to all members in matching zone(s).",
    delivery: "WebSocket + optional push when backgrounded.",
    requiresAdmin: false,
    requiresRecipient: false,
    requiresLocation: true,
    responseTracking: false,
    confirmBeforeSend: false,
  },
  PANIC: {
    priority: "MAX",
    description:
      "Emergency distress alert. Broadcast to all owners who share the zone id at your location.",
    delivery: "Instant push + WebSocket to matched zone members.",
    requiresAdmin: false,
    requiresRecipient: false,
    requiresLocation: true,
    responseTracking: false,
    confirmBeforeSend: true,
  },
  NS_PANIC: {
    priority: "MAX",
    description:
      "Non-silent emergency alert with distinct urgency. Same routing as PANIC.",
    delivery: "Instant push + WebSocket to all zone members.",
    requiresAdmin: false,
    requiresRecipient: false,
    requiresLocation: true,
    responseTracking: false,
    confirmBeforeSend: true,
  },
  UNKNOWN: {
    priority: "CRITICAL",
    description:
      "Highest-priority alarm. Nearest-neighbour fan-out with maximum visual urgency.",
    delivery: "Instant push + WebSocket; displayed above all other alarm types.",
    requiresAdmin: false,
    requiresRecipient: false,
    requiresLocation: true,
    responseTracking: false,
    confirmBeforeSend: false,
  },
  PRIVATE: {
    priority: "MEDIUM",
    description:
      "Same location-based send flow as PANIC or PA, but you search and pick exactly one owner with the same zone id.",
    delivery: "Geo propagation to the selected recipient only (WebSocket + push).",
    requiresAdmin: false,
    requiresRecipient: true,
    requiresLocation: true,
    responseTracking: false,
    confirmBeforeSend: false,
  },
  PA: {
    priority: "MEDIUM",
    description:
      "Public announcement broadcast to all owners who share the zone id at your location.",
    delivery: "WebSocket + optional push.",
    requiresAdmin: false,
    requiresRecipient: false,
    requiresLocation: true,
    responseTracking: false,
    confirmBeforeSend: false,
  },
  SERVICE: {
    priority: "LOW",
    description:
      "System or maintenance informational broadcast. Administrators only.",
    delivery: "WebSocket; push optional.",
    requiresAdmin: true,
    requiresRecipient: false,
    requiresLocation: true,
    responseTracking: false,
    confirmBeforeSend: false,
  },
  WELLNESS_CHECK: {
    priority: "HIGH",
    description:
      "Safety check request to all zone members. Recipients can acknowledge they are OK.",
    delivery: "WebSocket + push; acknowledgements tracked.",
    requiresAdmin: false,
    requiresRecipient: false,
    requiresLocation: true,
    responseTracking: true,
    confirmBeforeSend: false,
  },
};

export function getMessageWorkflow(type: MessageType): MessageWorkflowMeta | null {
  if (type in MESSAGE_WORKFLOW) {
    return MESSAGE_WORKFLOW[type as keyof typeof MESSAGE_WORKFLOW];
  }
  return null;
}

export function isEmergencyMessageType(type: MessageType): boolean {
  return type === "PANIC" || type === "NS_PANIC";
}

export function isUnknownMessageType(type: MessageType): boolean {
  return type === "UNKNOWN";
}

export function requiresAdminToSendType(type: MessageType): boolean {
  return getMessageWorkflow(type)?.requiresAdmin ?? false;
}

export function priorityBadgeClass(priority: MessagePriority): string {
  switch (priority) {
    case "CRITICAL":
      return "bg-[#C62828] text-white text-sm font-extrabold";
    case "MAX":
      return "bg-[#E23B4E] text-white";
    case "HIGH":
      return "bg-[#E0992A] text-white";
    case "LOW":
      return "bg-[#8694AC] text-white";
    default:
      return "bg-[#2F80ED] text-white";
  }
}
