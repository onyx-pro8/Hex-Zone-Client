import { API_BASE_URL } from "../api/client";
import { normalizeMessage, type Message } from "../api/messages";
import type {
  MessageFeaturePermissionDecision,
  MessageFeaturePropagationResponse,
} from "../api/messageFeature";

type IncomingNewMessage = {
  type: "NEW_MESSAGE";
  data: Message;
};

type MessageFeatureEnvelopeType =
  | "NEW_GEO_MESSAGE"
  | "PERMISSION_MESSAGE"
  | "NEW_MESSAGE";

export type MessageFeatureSocketEvent =
  | IncomingNewMessage
  | { type: "NEW_GEO_MESSAGE"; data: MessageFeaturePropagationResponse }
  | { type: "PERMISSION_MESSAGE"; data: MessageFeaturePermissionDecision };

type SocketEvent =
  | MessageFeatureSocketEvent
  | { type: MessageFeatureEnvelopeType | string; data?: unknown };

function isPropagationResponse(
  value: unknown,
): value is MessageFeaturePropagationResponse {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (row.skipped === true) return false;
  return (
    row.id != null &&
    typeof row.type === "string" &&
    Array.isArray(row.delivered_owner_ids) &&
    Array.isArray(row.blocked_owner_ids) &&
    typeof row.created_at === "string"
  );
}

/** Whether this viewer should see a geo propagation row in the Messages inbox. */
export function shouldShowGeoPropagationInInbox(
  propagation: MessageFeaturePropagationResponse,
  viewerOwnerId: number,
): boolean {
  if (!Number.isFinite(viewerOwnerId) || viewerOwnerId <= 0) return false;
  if (propagation.skipped) return false;
  const senderId = propagation.sender_id;
  if (typeof senderId === "number" && senderId === viewerOwnerId) return true;
  return (propagation.delivered_owner_ids ?? []).some((id) => Number(id) === viewerOwnerId);
}

function isPermissionDecision(
  value: unknown,
): value is MessageFeaturePermissionDecision {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const sender = row.sender_message as Record<string, unknown> | undefined;
  const member = row.member_message as Record<string, unknown> | undefined;
  return (
    (row.decision === "EXPECTED_GUEST" || row.decision === "NOT_EXPECTED_GUEST") &&
    typeof row.schedule_match === "boolean" &&
    Array.isArray(row.delivered_owner_ids) &&
    sender != null &&
    typeof sender.code === "string" &&
    typeof sender.text === "string" &&
    member != null &&
    typeof member.code === "string" &&
    typeof member.text === "string"
  );
}

/** WebSocket base (no query): wss://host/ws matching API host unless VITE_WS_URL is set. */
export function defaultRealtimeWsBase(): string {
  const explicit = import.meta.env.VITE_WS_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "").split("?")[0] ?? explicit;
  }
  try {
    const u = new URL(API_BASE_URL);
    const wsProto = u.protocol === "https:" ? "wss:" : "ws:";
    return `${wsProto}//${u.host}/ws`;
  } catch {
    return "wss://zone-weaver-server-7ksef.ondigitalocean.app/ws";
  }
}

/** Parse a text frame from the realtime API; returns null if not a NEW_MESSAGE. */
export function parseMessageSocketPayload(raw: string): Message | null {
  const event = parseMessageFeatureSocketEvent(raw);
  if (event?.type === "NEW_MESSAGE") {
    return event.data;
  }
  return null;
}

/**
 * True when the socket frame should trigger a debounced refetch of GET /messages
 * (WS payloads are signals, not authoritative merged history for PERMISSION).
 */
export function parseInboxSocketRefetchSignal(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as { type?: unknown };
    const t = parsed.type;
    if (typeof t !== "string") return false;
    return (
      t === "NEW_MESSAGE" ||
      t === "PERMISSION_MESSAGE" ||
      t === "NEW_GEO_MESSAGE" ||
      t === "unexpected_guest" ||
      t === "guest_is_here"
    );
  } catch {
    return false;
  }
}

/** Parse message-feature envelope events and keep NEW_MESSAGE backward compatible. */
export function parseMessageFeatureSocketEvent(
  raw: string,
): MessageFeatureSocketEvent | null {
  try {
    const parsed = JSON.parse(raw) as SocketEvent;
    if (parsed.type === "NEW_MESSAGE") {
      const normalized = normalizeMessage(parsed.data);
      if (normalized) return { type: "NEW_MESSAGE", data: normalized };
    }
    if (parsed.type === "NEW_GEO_MESSAGE" && isPropagationResponse(parsed.data)) {
      return { type: "NEW_GEO_MESSAGE", data: parsed.data };
    }
    if (parsed.type === "PERMISSION_MESSAGE" && isPermissionDecision(parsed.data)) {
      return { type: "PERMISSION_MESSAGE", data: parsed.data };
    }
  } catch {
    /* ignore */
  }
  return null;
}
