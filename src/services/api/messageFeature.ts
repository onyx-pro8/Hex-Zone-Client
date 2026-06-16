import axios from "axios";
import { apiClient } from "./client";

export type MessageFeatureType =
  | "SENSOR"
  | "PANIC"
  | "NS_PANIC"
  | "UNKNOWN"
  | "PRIVATE"
  | "PA"
  | "SERVICE"
  | "WELLNESS_CHECK"
  | "PERMISSION"
  | "CHAT";

export type MessageFeaturePosition = {
  latitude: number;
  longitude: number;
};

export type MessageFeaturePayload = {
  type: MessageFeatureType;
  hid: string;
  tt?: string;
  msg: Record<string, unknown>;
  position: MessageFeaturePosition;
  city?: string;
  province?: string;
  country?: string;
  to?: string;
  co?: string;
  receiver_owner_id?: number;
};

export type MessageFeaturePropagationResponse = {
  id: string | null;
  type: string;
  zone_ids: string[];
  zone_id?: string | null;
  sender_id?: number | null;
  category?: string | null;
  scope?: string | null;
  text?: string | null;
  delivered_owner_ids: number[];
  blocked_owner_ids: number[];
  created_at: string;
  skipped?: boolean;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  push_sent?: number | null;
  push_failed?: number | null;
  priority?: string | null;
  response_tracking_enabled?: boolean | null;
};

export type WellnessAcknowledgement = {
  id: string;
  owner_id: number;
  status: string;
  note?: string | null;
  created_at: string;
};

export type WellnessAckSummary = {
  message_event_id: string;
  expected_recipient_ids: number[];
  pending_recipient_ids: number[];
  acknowledgements: WellnessAcknowledgement[];
  response_tracking_enabled: boolean;
  acknowledgement?: WellnessAcknowledgement;
};

export type MessageFeaturePermissionDecision = {
  decision: "EXPECTED_GUEST" | "NOT_EXPECTED_GUEST";
  schedule_match: boolean;
  sender_message: { code: string; text: string };
  member_message: { code: string; text: string };
  delivered_owner_ids: number[];
};

export type MessageFeatureBlock = {
  id: string;
  blocked_owner_id?: number;
  blocked_message_type?: MessageFeatureType;
  created_at?: string;
};

export type MessageFeatureBlockCreatePayload = {
  blocked_owner_id?: number;
  blocked_message_type?: MessageFeatureType;
};

export type MessageFeatureAccessSchedulePayload = {
  zone_id: string;
  event_id?: string;
  guest_id?: string;
  guest_name?: string;
  starts_at?: string;
  ends_at?: string;
  notify_member_assist: boolean;
};

export type MessageFeatureAccessSchedule = MessageFeatureAccessSchedulePayload & {
  id: string;
  created_at?: string;
  updated_at?: string;
};

export type MessageFeatureValidationErrors = Record<string, string[]>;

export type MessageFeatureApiResult<T> = {
  data: T | null;
  error: string | null;
  status: number | null;
  validationErrors: MessageFeatureValidationErrors | null;
  loading: boolean;
};

function normalizeValidationErrors(raw: unknown): MessageFeatureValidationErrors | null {
  if (!raw || typeof raw !== "object") return null;
  const bag = raw as Record<string, unknown>;
  const details = bag.detail;
  if (!Array.isArray(details)) return null;
  const out: MessageFeatureValidationErrors = {};
  for (const entry of details) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const loc = Array.isArray(row.loc) ? row.loc : [];
    const field = loc
      .map((segment) => String(segment))
      .filter((segment) => segment !== "body")
      .join(".");
    const message = typeof row.msg === "string" ? row.msg : "Invalid field";
    if (!field) continue;
    if (!out[field]) out[field] = [];
    out[field].push(message);
  }
  return Object.keys(out).length > 0 ? out : null;
}

async function requestMessageFeature<T>(
  method: "GET" | "POST" | "DELETE",
  url: string,
  options?: {
    data?: unknown;
    params?: Record<string, unknown>;
    headers?: Record<string, string>;
  },
): Promise<MessageFeatureApiResult<T>> {
  try {
    const response = await apiClient.request<T>({
      method,
      url,
      data: options?.data,
      params: options?.params,
      headers: options?.headers,
    });
    return {
      data: response.data,
      error: null,
      status: response.status,
      validationErrors: null,
      loading: false,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status ?? null;
      const validationErrors = normalizeValidationErrors(error.response?.data);
      const fallbackMessage =
        (error.response?.data as { message?: string } | undefined)?.message ||
        error.message ||
        "Request failed";
      return {
        data: null,
        error: fallbackMessage,
        status,
        validationErrors,
        loading: false,
      };
    }
    return {
      data: null,
      error: error instanceof Error ? error.message : "Request failed",
      status: null,
      validationErrors: null,
      loading: false,
    };
  }
}

export async function refreshMessageFeatureMembershipLocation(
  payload: MessageFeaturePosition,
) {
  return requestMessageFeature<{ zone_ids: string[] }>(
    "POST",
    "/message-feature/members/location",
    { data: payload },
  );
}

export async function propagateMessageFeatureMessage(payload: MessageFeaturePayload) {
  return requestMessageFeature<MessageFeaturePropagationResponse>(
    "POST",
    "/message-feature/messages/propagate",
    { data: payload },
  );
}

export type InZoneMember = {
  id: number;
  name: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  zone_id: string | null;
};

export type InZoneMembersResponse = {
  zone_ids: string[];
  members: InZoneMember[];
};

/** Members currently located inside the caller's zone(s) — the valid PRIVATE
 *  recipients per server delivery rules (cross-account, location-based). */
export async function listInZoneMembers(position?: MessageFeaturePosition) {
  return requestMessageFeature<InZoneMembersResponse>(
    "GET",
    "/message-feature/members/in-zone",
    {
      params: position
        ? { latitude: position.latitude, longitude: position.longitude }
        : undefined,
    },
  );
}

export async function listWellnessAcknowledgements(messageEventId: string) {
  return requestMessageFeature<WellnessAckSummary>(
    "GET",
    `/message-feature/messages/${encodeURIComponent(messageEventId)}/wellness-acks`,
  );
}

export async function acknowledgeWellnessCheck(
  messageEventId: string,
  payload: { status?: "ok" | "need_help"; note?: string } = {},
) {
  return requestMessageFeature<WellnessAckSummary>(
    "POST",
    `/message-feature/messages/${encodeURIComponent(messageEventId)}/wellness-ack`,
    { data: payload },
  );
}

export async function ingestMessageFeatureMessage(
  payload: MessageFeaturePayload,
  apiKey: string,
) {
  return requestMessageFeature<MessageFeaturePropagationResponse>(
    "POST",
    "/message-feature/messages/ingest",
    {
      data: payload,
      headers: { "x-api-key": apiKey },
    },
  );
}

export async function createMessageFeatureBlock(
  payload: MessageFeatureBlockCreatePayload,
) {
  return requestMessageFeature<MessageFeatureBlock>(
    "POST",
    "/message-feature/blocks",
    { data: payload },
  );
}

export async function listMessageFeatureBlocks() {
  return requestMessageFeature<MessageFeatureBlock[]>("GET", "/message-feature/blocks");
}

export async function deleteMessageFeatureBlock(blockId: string) {
  return requestMessageFeature<{ success: boolean }>(
    "DELETE",
    `/message-feature/blocks/${encodeURIComponent(blockId)}`,
  );
}

export async function createMessageFeatureAccessSchedule(
  payload: MessageFeatureAccessSchedulePayload,
) {
  return requestMessageFeature<MessageFeatureAccessSchedule>(
    "POST",
    "/message-feature/access/schedules",
    { data: payload },
  );
}

export async function listMessageFeatureAccessSchedules(zoneId: string) {
  return requestMessageFeature<MessageFeatureAccessSchedule[]>(
    "GET",
    "/message-feature/access/schedules",
    {
      params: { zone_id: zoneId },
    },
  );
}

export async function decideMessageFeaturePermission(payload: MessageFeaturePayload) {
  return requestMessageFeature<MessageFeaturePermissionDecision>(
    "POST",
    "/message-feature/access/permission",
    { data: payload },
  );
}

export async function listNewMessageFeatureMessages(
  since: string,
  type?: MessageFeatureType,
) {
  return requestMessageFeature<MessageFeaturePropagationResponse[]>(
    "GET",
    "/message-feature/messages/new",
    {
      params: type ? { since, type } : { since },
    },
  );
}

export type EmergencyEvent = {
  id: string;
  messageEventId: string | null;
  type: string;
  senderId: number | null;
  zoneId: string | null;
  recipientCount: number;
  latitude: number | null;
  longitude: number | null;
  text: string | null;
  createdAt: string;
};

export async function listEmergencyEvents(params?: {
  limit?: number;
  skip?: number;
  type?: "PANIC" | "NS_PANIC";
}) {
  return requestMessageFeature<EmergencyEvent[]>(
    "GET",
    "/message-feature/emergency-events",
    {
      params: {
        limit: params?.limit ?? 100,
        skip: params?.skip ?? 0,
        ...(params?.type ? { type: params.type } : {}),
      },
    },
  );
}

export type PrivateThreadMessage = {
  id: string;
  type: string;
  senderId: number | null;
  receiverId: number | null;
  text: string | null;
  body: Record<string, unknown> | null;
  createdAt: string;
};

export async function getPrivateThread(otherOwnerId: number, limit = 100) {
  return requestMessageFeature<PrivateThreadMessage[]>(
    "GET",
    "/message-feature/messages/private-thread",
    {
      params: { other_owner_id: otherOwnerId, limit },
    },
  );
}
