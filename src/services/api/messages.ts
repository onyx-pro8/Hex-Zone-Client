import { API_BASE_URL, request } from "./client";
import type { MessageFeaturePropagationResponse } from "./messageFeature";
import {
  getMessageTypeCategory,
  getMessageScopeForType,
  toMessageType,
  type MessageCategory,
  type MessageScope,
  type MessageType,
} from "../../lib/messageTypes";
import {
  isPermissionZonePendingBroadcastVisibility,
  normalizePermissionVisibilityToken,
} from "../../lib/permissionVisibility";

export type MessageVisibility = MessageScope;

/** Placeholder `sender_id` when the logical sender is a guest (UUID) without a numeric owner id. */
export const GUEST_LOGICAL_SENDER_ID = 0;

/**
 * Member inbox row from `GET /messages` (numeric or UUID string `id`, merged with Access events).
 * Use `permission_visibility` when `type === "PERMISSION"`; tolerate absence for older servers.
 */
export type ZoneMessageResponse = Message;

export type Message = {
  /** Server may return a number or UUID string for Access events. */
  id: string;
  zone_id: string;
  sender_id: number;
  receiver_id: number | null;
  type: MessageType;
  category: "Alarm" | "Alert" | "Access";
  scope: MessageScope;
  visibility: MessageVisibility;
  message: string;
  created_at: string;
  raw_payload: Record<string, unknown> | null;
  /** Present when the row is guest-originated Access traffic (mirrored CHAT/PERMISSION) without numeric sender. */
  guest_sender_id?: string;
  /**
   * Access-row guest reference from the API (`guest_id`). May be JSON null for some guest-pass lifecycle rows.
   * Distinct from `guest_sender_id` (logical sender when numeric sender is absent).
   */
  guest_id?: string | null;
  /** When `type === "PERMISSION"`, optional visibility hint from the backend. */
  permission_visibility?: string | null;
};

export type ListMessagesParams = {
  owner_id: number;
  other_owner_id?: number;
  skip?: number;
  limit?: number;
};

export type SendMessagePayload = {
  message: string;
  type: MessageType;
  zone_id?: string;
  receiver_id?: number;
  /** Access-channel recipient (guest). When set, member UI should omit owner-to-owner use for PERMISSION/CHAT. */
  guest_id?: string;
};

function toLegacyTypeFromVisibility(visibility: unknown): MessageType | null {
  if (visibility === "private") return "PRIVATE";
  if (visibility === "public") return "SERVICE";
  return null;
}

function normalizeReceiverId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeOwnerNumericId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
}

function coerceMessageCategory(value: unknown): MessageCategory | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  if (key === "alarm") return "Alarm";
  if (key === "alert") return "Alert";
  if (key === "access") return "Access";
  return null;
}

function coerceMessageScope(value: unknown): MessageScope | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  if (key === "public" || key === "private") return key;
  return null;
}

function logMalformedMessageWarning(id: unknown, reason: string) {
  if (!import.meta.env.DEV) return;
  // eslint-disable-next-line no-console
  console.warn(`[messages] malformed message record (${String(id ?? "unknown")}): ${reason}`);
}

function logGuestLogicalSenderAccepted(id: unknown, guestId: string) {
  if (!import.meta.env.DEV) return;
  // eslint-disable-next-line no-console
  console.info(
    `[messages] inbound Access row kept via guest sender path (${String(id ?? "unknown")}): guest_id=${guestId}; sender_id placeholder ${GUEST_LOGICAL_SENDER_ID}`,
  );
}

function normalizeGuestSenderIdString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

/**
 * Guest id on mirrored Access rows may appear at the top level, under `msg`, or inside `raw_payload`.
 */
export function extractGuestSenderId(
  row: Record<string, unknown>,
  msgRecord: Record<string, unknown> | null,
  structuredPayload: Record<string, unknown> | null,
): string | null {
  const tryObj = (o: Record<string, unknown> | null) => {
    if (!o) return null;
    return (
      normalizeGuestSenderIdString(o.guest_id) ?? normalizeGuestSenderIdString(o.guestId) ?? null
    );
  };
  return (
    tryObj(row) ??
    tryObj(msgRecord) ??
    tryObj(structuredPayload) ??
    null
  );
}

/** API `guest_id` on Access rows (may be JSON null); not used for logical-sender resolution. */
function readAccessGuestIdContract(
  row: Record<string, unknown>,
  msgRecord: Record<string, unknown> | null,
  rowStructuredPayload: Record<string, unknown> | null,
  type: MessageType,
): string | null | undefined {
  if (type !== "PERMISSION" && type !== "CHAT") return undefined;
  const read = (o: Record<string, unknown> | null): string | null | undefined => {
    if (!o) return undefined;
    if (Object.prototype.hasOwnProperty.call(o, "guest_id")) {
      const v = o.guest_id;
      if (v === null) return null;
      if (typeof v === "string") {
        const t = v.trim();
        return t.length > 0 ? t : null;
      }
      return undefined;
    }
    if (Object.prototype.hasOwnProperty.call(o, "guestId")) {
      const v = o.guestId;
      if (v === null) return null;
      if (typeof v === "string") {
        const t = v.trim();
        return t.length > 0 ? t : null;
      }
      return undefined;
    }
    return undefined;
  };
  const top = read(row);
  if (top !== undefined) return top;
  const mid = read(msgRecord);
  if (mid !== undefined) return mid;
  return read(rowStructuredPayload);
}

function extractPermissionVisibility(
  row: Record<string, unknown>,
  msgRecord: Record<string, unknown> | null,
  rowStructuredPayload: Record<string, unknown> | null,
  type: MessageType,
): string | null | undefined {
  if (type !== "PERMISSION") return undefined;
  const pick = (o: Record<string, unknown> | null): string | null | undefined => {
    if (!o) return undefined;
    if (Object.prototype.hasOwnProperty.call(o, "permission_visibility")) {
      return normalizePermissionVisibilityToken(o.permission_visibility);
    }
    if (Object.prototype.hasOwnProperty.call(o, "permissionVisibility")) {
      return normalizePermissionVisibilityToken(o.permissionVisibility);
    }
    return undefined;
  };
  return pick(row) ?? pick(msgRecord) ?? pick(rowStructuredPayload);
}

/** Pin zone pending broadcast PERMISSION rows to the top of the Access section. */
export function sortInboxAccessMessages(list: Message[]): Message[] {
  return [...list].sort((a, b) => {
    const pa =
      a.type === "PERMISSION" && isPermissionZonePendingBroadcastVisibility(a.permission_visibility)
        ? 1
        : 0;
    const pb =
      b.type === "PERMISSION" && isPermissionZonePendingBroadcastVisibility(b.permission_visibility)
        ? 1
        : 0;
    if (pa !== pb) return pb - pa;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

export function sortInboxGeneralMessages(list: Message[]): Message[] {
  return [...list].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

function coerceMessageBodyText(row: Record<string, unknown>): string {
  const text = row.message;
  if (typeof text === "string") return text;
  const msg = row.msg;
  if (msg && typeof msg === "object" && !Array.isArray(msg)) {
    const nested = msg as Record<string, unknown>;
    const t = nested.text ?? nested.body ?? nested.message;
    if (typeof t === "string") return t;
  }
  return "";
}

function permissionBodyFallback(meta: Record<string, unknown> | null): string {
  if (!meta || Object.keys(meta).length === 0) return "(Permission traffic)";
  const status =
    typeof meta.status === "string"
      ? meta.status
      : typeof meta.state === "string"
        ? meta.state
        : "";
  const action =
    typeof meta.action === "string"
      ? meta.action
      : typeof meta.event === "string"
        ? meta.event
        : "";
  const code =
    typeof meta.code === "string"
      ? meta.code
      : typeof meta.reason === "string"
        ? meta.reason
        : "";
  const parts = [
    status && `status: ${status}`,
    action && `event: ${action}`,
    code && `detail: ${code}`,
  ].filter(Boolean);
  if (parts.length) return parts.join(" · ");
  try {
    return JSON.stringify(meta);
  } catch {
    return "(Permission traffic)";
  }
}

export function normalizeMessage(raw: unknown): Message | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = row.id;
  const zoneIdRaw = row.zone_id ?? row.zoneId;
  const senderId = row.sender_id;
  const createdAt = row.created_at;
  const visibility = row.visibility;
  const directType = toMessageType(row.type ?? row.message_type);
  const fallbackType = toLegacyTypeFromVisibility(visibility);
  const type = directType ?? fallbackType ?? "UNKNOWN";
  const meta = {
    category: getMessageTypeCategory(type),
    scope: getMessageScopeForType(type),
  };

  const zoneId = typeof zoneIdRaw === "string" ? zoneIdRaw : String(zoneIdRaw ?? "");
  const senderIdValue =
    normalizeOwnerNumericId(senderId) ??
    normalizeOwnerNumericId(row.owner_id) ??
    normalizeOwnerNumericId(row.user_id);

  const msgRecord =
    row.msg != null && typeof row.msg === "object" && !Array.isArray(row.msg)
      ? (row.msg as Record<string, unknown>)
      : null;
  const rowStructuredPayload =
    row.raw_payload != null && typeof row.raw_payload === "object" && !Array.isArray(row.raw_payload)
      ? (row.raw_payload as Record<string, unknown>)
      : null;

  const guestSenderIdRaw = extractGuestSenderId(row, msgRecord, rowStructuredPayload);

  let textValue = coerceMessageBodyText(row).trim();

  const allowSyntheticBody = type === "PERMISSION" || type === "CHAT";
  if (textValue.length === 0 && allowSyntheticBody && msgRecord) {
    textValue = permissionBodyFallback(msgRecord).trim();
  }
  if (textValue.length === 0 && type === "PERMISSION") {
    textValue = permissionBodyFallback(rowStructuredPayload).trim();
  }
  /** placeholder so UI list/detail can render; avoids dropping valid backend PERMISSION envelopes */
  if (textValue.length === 0 && type === "PERMISSION") {
    textValue = "(Permission traffic)";
  }
  /** CHAT envelopes sometimes carry only structured metadata */
  if (textValue.length === 0 && type === "CHAT") {
    textValue = "(Chat)";
  }

  const raw_payload: Record<string, unknown> | null = msgRecord ?? rowStructuredPayload;

  const accessGuestChannel = type === "CHAT" || type === "PERMISSION";
  const useGuestLogicalSender =
    senderIdValue == null && accessGuestChannel && guestSenderIdRaw != null;

  const resolvedSenderId = useGuestLogicalSender
    ? GUEST_LOGICAL_SENDER_ID
    : senderIdValue;

  if (useGuestLogicalSender && guestSenderIdRaw) {
    logGuestLogicalSenderAccepted(id, guestSenderIdRaw);
  }

  if (
    id == null ||
    zoneId.trim().length === 0 ||
    resolvedSenderId == null ||
    typeof createdAt !== "string" ||
    textValue.trim().length === 0
  ) {
    logMalformedMessageWarning(id, "missing core identifiers");
    return null;
  }
  const receiver = normalizeReceiverId(row.receiver_id ?? row.receiver_owner_id);
  if (!directType && !fallbackType) {
    logMalformedMessageWarning(id, "type missing; using UNKNOWN");
  }
  let category = meta.category;
  let scope = meta.scope;
  if (type === "CHAT" || type === "PERMISSION") {
    const categoryHint =
      coerceMessageCategory(row.category) ??
      (msgRecord ? coerceMessageCategory(msgRecord.category) : null) ??
      (rowStructuredPayload ? coerceMessageCategory(rowStructuredPayload.category) : null);
    if (categoryHint) category = categoryHint;
    const scopeHint =
      coerceMessageScope(row.scope) ??
      (msgRecord ? coerceMessageScope(msgRecord.scope) : null) ??
      (rowStructuredPayload ? coerceMessageScope(rowStructuredPayload.scope) : null);
    if (scopeHint) scope = scopeHint;
  }
  const contractGuestId = readAccessGuestIdContract(row, msgRecord, rowStructuredPayload, type);
  const permissionVisibility = extractPermissionVisibility(
    row,
    msgRecord,
    rowStructuredPayload,
    type,
  );
  return {
    id: String(id),
    zone_id: zoneId,
    sender_id: resolvedSenderId,
    receiver_id: receiver,
    type,
    category,
    scope,
    visibility: scope,
    message: textValue,
    created_at: createdAt,
    raw_payload,
    ...(useGuestLogicalSender && guestSenderIdRaw
      ? { guest_sender_id: guestSenderIdRaw }
      : {}),
    ...(contractGuestId !== undefined ? { guest_id: contractGuestId } : {}),
    ...(permissionVisibility !== undefined
      ? { permission_visibility: permissionVisibility }
      : {}),
  };
}

function messagesListUrl(): string {
  const base = API_BASE_URL.replace(/\/+$/, "");
  return `${base}/messages/`;
}

/** Map a WebSocket/API geo propagation payload into a Messages inbox row. */
export function messageFromGeoPropagation(
  propagation: MessageFeaturePropagationResponse,
): Message | null {
  const zoneId =
    (typeof propagation.zone_id === "string" && propagation.zone_id.trim()) ||
    (propagation.zone_ids?.[0] ?? "");
  const meta =
    propagation.metadata && typeof propagation.metadata === "object"
      ? (propagation.metadata as Record<string, unknown>)
      : null;
  const senderFromMeta = meta?.sender_id ?? meta?.senderId;
  const senderId =
    typeof propagation.sender_id === "number"
      ? propagation.sender_id
      : typeof senderFromMeta === "number"
        ? senderFromMeta
        : null;
  if (senderId == null || !Number.isFinite(senderId)) {
    return null;
  }
  const scopeRaw = String(propagation.scope ?? "public").toLowerCase();
  const visibility: MessageVisibility =
    scopeRaw === "private" ? "private" : "public";
  const type = toMessageType(propagation.type) ?? "UNKNOWN";
  const text =
    (typeof propagation.text === "string" && propagation.text.trim()) ||
    String(propagation.type ?? "ALARM");
  const createdAt = propagation.created_at;
  const id = propagation.id;
  if (id == null || !zoneId || typeof createdAt !== "string") {
    return null;
  }
  return normalizeMessage({
    id,
    zone_id: zoneId,
    sender_id: senderId,
    receiver_id: null,
    type,
    category: propagation.category ?? getMessageTypeCategory(type),
    scope: visibility,
    visibility,
    message: text,
    created_at: createdAt,
    raw_payload: propagation.metadata ?? null,
  });
}

export { shouldShowGeoPropagationInInbox } from "../socket/messageSocket";

/**
 * Member message inbox. Server: `GET ${VITE_API_BASE_URL}/messages/` with query params
 * `owner_id` (required), optional `other_owner_id`, `skip`, `limit`. PERMISSION / CHAT for
 * Access Zone should appear here when the backend mirrors those rows for the signed-in owner;
 * rows with empty legacy `message` text are surfaced when typed as PERMISSION / CHAT.
 */
export async function listMessages(params: ListMessagesParams) {
  const result = await request<unknown[]>({
    method: "GET",
    url: messagesListUrl(),
    params,
  });
  return {
    ...result,
    data: (result.data ?? []).map(normalizeMessage).filter((m): m is Message => Boolean(m)),
  };
}

/** List/detail label: guest-originated Access rows use a stable "Guest" label instead of the numeric placeholder. */
export function formatMessageSenderLabel(message: Message): string {
  return message.guest_sender_id != null ? "Guest" : String(message.sender_id);
}

export async function sendMessage(payload: SendMessagePayload) {
  const gid = payload.guest_id?.trim();
  const data: Record<string, unknown> = {
    message: payload.message,
    message_type: payload.type,
    visibility: getMessageScopeForType(payload.type),
    ...(payload.zone_id ? { zone_id: payload.zone_id } : {}),
  };
  if (gid) {
    data.guest_id = gid;
  } else if (payload.receiver_id != null) {
    data.receiver_id = payload.receiver_id;
  }
  const result = await request<unknown>({
    method: "POST",
    url: "/messages",
    data,
  });
  return {
    ...result,
    data: normalizeMessage(result.data),
  };
}
