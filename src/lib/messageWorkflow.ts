import type { MessageType } from "./messageTypes";

export type MessagePriority = "CRITICAL" | "MAX" | "HIGH" | "MEDIUM" | "LOW";

/** How the client resolves coordinates before calling geo propagation. */
export type MessageLocationSource = "registered_address" | "live_gps" | "proximity" | "network_qr";

export type MessageWorkflowMeta = {
  priority: MessagePriority;
  description: string;
  delivery: string;
  locationSource: MessageLocationSource;
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
      "Telemetry alarm routed from your registered home address. In the admin primary zone, all invited members and the administrator receive it; in a member secondary zone, only that zone creator receives it.",
    delivery: "WebSocket + optional push when backgrounded.",
    locationSource: "registered_address",
    requiresAdmin: false,
    requiresRecipient: false,
    requiresLocation: true,
    responseTracking: false,
    confirmBeforeSend: false,
  },
  PANIC: {
    priority: "MAX",
    description:
      "Emergency distress alarm using your current device location. Inside the admin primary zone, all invited members and the administrator are notified; outside the primary zone, no one receives it.",
    delivery: "Instant push + WebSocket to matched network members.",
    locationSource: "live_gps",
    requiresAdmin: false,
    requiresRecipient: false,
    requiresLocation: true,
    responseTracking: false,
    confirmBeforeSend: true,
  },
  NS_PANIC: {
    priority: "MAX",
    description:
      "Non-silent emergency alarm with distinct urgency. Same primary-zone routing as PANIC using your current device location.",
    delivery: "Instant push + WebSocket to matched network members.",
    locationSource: "live_gps",
    requiresAdmin: false,
    requiresRecipient: false,
    requiresLocation: true,
    responseTracking: false,
    confirmBeforeSend: true,
  },
  UNKNOWN: {
    priority: "CRITICAL",
    description:
      "Highest-priority alarm delivered to the nearest active users by GPS proximity (no zone or network filter).",
    delivery: "Instant push + WebSocket; displayed above all other alarm types.",
    locationSource: "proximity",
    requiresAdmin: false,
    requiresRecipient: false,
    requiresLocation: true,
    responseTracking: false,
    confirmBeforeSend: false,
  },
  PRIVATE: {
    priority: "MEDIUM",
    description:
      "Direct alert to one selected member using your current device location. You must be inside an acceptable zone; routing follows primary vs secondary zone rules.",
    delivery: "Geo propagation to the selected recipient only (WebSocket + push).",
    locationSource: "live_gps",
    requiresAdmin: false,
    requiresRecipient: true,
    requiresLocation: true,
    responseTracking: false,
    confirmBeforeSend: false,
  },
  PA: {
    priority: "MEDIUM",
    description:
      "Public announcement using your current device location. Inside the admin primary zone, all invited members and the administrator receive it.",
    delivery: "WebSocket + optional push.",
    locationSource: "live_gps",
    requiresAdmin: false,
    requiresRecipient: false,
    requiresLocation: true,
    responseTracking: false,
    confirmBeforeSend: false,
  },
  SERVICE: {
    priority: "LOW",
    description:
      "Service listing or maintenance alert using your current device location. Routing follows primary vs secondary zone rules for your network.",
    delivery: "WebSocket; push optional.",
    locationSource: "live_gps",
    requiresAdmin: false,
    requiresRecipient: false,
    requiresLocation: true,
    responseTracking: false,
    confirmBeforeSend: false,
  },
  WELLNESS_CHECK: {
    priority: "HIGH",
    description:
      "Safety check alarm sent from your registered home address. Recipients can acknowledge they are OK. Routing follows primary vs secondary zone rules.",
    delivery: "WebSocket + push; acknowledgements tracked.",
    locationSource: "registered_address",
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

export function usesRegisteredAddressForType(type: MessageType): boolean {
  const workflow = getMessageWorkflow(type);
  return workflow?.locationSource === "registered_address";
}

export function usesLiveGpsForType(type: MessageType): boolean {
  const workflow = getMessageWorkflow(type);
  return workflow?.locationSource === "live_gps" || workflow?.locationSource === "proximity";
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
