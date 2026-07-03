import axios, { AxiosError } from "axios";
import type { GuestRequestRow } from "../../lib/guestRealtime";
import type { GuestArrivalPermissionPayload } from "../../lib/guestArrival";
import { API_BASE_URL, request as authRequest } from "./client";
import type {
  MessageFeaturePermissionDecision,
  MessageFeaturePayload,
  MessageFeaturePosition,
} from "./messageFeature";

/** POST target for PERMISSION payloads; override with `VITE_GUEST_ACCESS_PERMISSION_PATH` (e.g. `/api/access/permission`). */
export function guestAccessPermissionPath(): string {
  const env = String(import.meta.env.VITE_GUEST_ACCESS_PERMISSION_PATH ?? "").trim();
  return env.length > 0 ? env : "/api/access/permission";
}

const scanAuthUrl = (): string | null => {
  const raw = String(import.meta.env.VITE_GUEST_SCAN_AUTH_URL ?? "").trim();
  return raw.length > 0 ? raw : null;
};

const approvalPollTemplate = (): string | null => {
  const raw = String(import.meta.env.VITE_GUEST_APPROVAL_POLL_URL_TEMPLATE ?? "").trim();
  /** Example: `{requestId}` replaced: `/message-feature/access/guest-requests/{requestId}` */
  return raw.length > 0 ? raw : null;
};

const guestRequestsListPath = (): string => {
  const raw = String(import.meta.env.VITE_ADMIN_GUEST_REQUESTS_LIST_URL ?? "").trim();
  /** Default matches `/api/access/*` family; override if your server still uses message-feature paths. */
  return raw.length > 0 ? raw : "/api/access/guest-requests";
};

/** POST /api/access/permission (anonymous; no JWT). Override with `VITE_ANONYMOUS_ACCESS_PERMISSION_PATH`. */
export function anonymousAccessPermissionPath(): string {
  const raw = String(import.meta.env.VITE_ANONYMOUS_ACCESS_PERMISSION_PATH ?? "").trim();
  return raw.length > 0 ? raw : "/api/access/permission";
}

/** GET template for session polling; `{guest_id}` is replaced. Default `/api/access/session/{guest_id}`. */
export function accessSessionUrlTemplate(): string {
  const raw = String(import.meta.env.VITE_ACCESS_SESSION_URL_TEMPLATE ?? "").trim();
  return raw.length > 0 ? raw : "/api/access/session/{guest_id}";
}

const fallbackZeroPosition = (): MessageFeaturePosition => ({
  latitude: 0,
  longitude: 0,
});

/** Guest-facing HTTP calls must not attach the owner's Bearer token from local/session storage. */
const guestAxios = axios.create({
  baseURL: API_BASE_URL,
  headers: { "Content-Type": "application/json" },
});

function unwrapEnvelope(raw: unknown): unknown {
  if (
    raw &&
    typeof raw === "object" &&
    "status" in raw &&
    (raw as { status?: string }).status === "success" &&
    "data" in raw
  ) {
    return (raw as { data: unknown }).data;
  }
  return raw;
}

function unwrapAxiosEnvelopeError(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (row.status === "error" && row.error != null && typeof row.error === "object") {
    const e = row.error as { message?: string };
    return e.message || (typeof row.message === "string" ? row.message : null);
  }
  return null;
}

/** Global JSON errors: `{ status: "error", message, error_code }` or `{ message, error_code }`. */
function readGlobalErrorFields(body: unknown): { code?: string; message: string } | null {
  if (!body || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  const message =
    typeof row.message === "string" && row.message.trim()
      ? row.message.trim()
      : typeof row.detail === "string" && row.detail.trim()
        ? row.detail.trim()
        : null;
  if (!message) return null;
  const hasErrorShape =
    row.status === "error" || typeof row.error_code === "string";
  if (!hasErrorShape) return null;
  const code = typeof row.error_code === "string" ? row.error_code : undefined;
  return { code, message };
}

function toGuestMessageFeaturePayload(
  body: GuestArrivalPermissionPayload,
): MessageFeaturePayload {
  const position =
    body.position && Number.isFinite(body.position.latitude)
      ? body.position
      : fallbackZeroPosition();
  const msg = { ...(body.msg as Record<string, unknown>) };
  const base: MessageFeaturePayload = {
    type: "PERMISSION",
    hid: body.hid,
    ...(body.tt ? { tt: body.tt } : {}),
    to: body.to,
    msg,
    position,
    ...(typeof body.co === "string" && body.co.trim() ? { co: body.co.trim() } : {}),
  };
  return base;
}

export type GuestApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";

export type NormalizedGuestPermissionDecision = {
  expectation: "expected" | "unexpected";
  scheduleMatch?: boolean;
  proceedCopy?: string;
  waitCopy?: string;
  notifyMemberAssist?: boolean;
  requestId?: string;
  pollingNeeded?: boolean;
  approvalStatus?: GuestApprovalStatus | "NONE";
  nextInstructions?: string;
  /** Session poll id when backend aligns with anonymous `/access` contract. */
  guestId?: string;
  zoneId?: string;
  exchange_code?: string;
  exchange_expires_at?: string;
  raw?: MessageFeaturePermissionDecision;
};

export type SubmitGuestPermissionResult = {
  data: NormalizedGuestPermissionDecision | null;
  error: string | null;
  errorCode?: string;
};

function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = record[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function readZoneIdFromRow(
  r: Record<string, unknown>,
  depth = 0,
): string | undefined {
  if (depth > 4) return undefined;
  const s = readString(r, ["zone_id", "zoneId", "zid", "to"]);
  if (s) return s;

  const z = r.zone_id ?? r.zoneId ?? r.zid ?? r.to ?? r.zone;
  if (typeof z === "number" && Number.isFinite(z)) return String(Math.trunc(z));
  if (typeof z === "string" && z.trim()) return z.trim();
  if (z && typeof z === "object" && !Array.isArray(z)) {
    const zr = z as Record<string, unknown>;
    const nested = readString(zr, ["id", "zone_id", "zoneId", "uuid"]);
    if (nested) return nested;
  }

  const nestKeys = ["permission", "session", "guest_request", "request", "data"];
  for (const key of nestKeys) {
    const nest = r[key];
    if (nest && typeof nest === "object" && !Array.isArray(nest)) {
      const id = readZoneIdFromRow(nest as Record<string, unknown>, depth + 1);
      if (id) return id;
    }
  }
  return undefined;
}

/** Backend may use UUID `guest_id` or numeric `id`. */
function readGuestRequestRowId(r: Record<string, unknown>): string | undefined {
  const fromStrings = readString(r, ["guest_id", "request_id", "permission_request_id"]);
  if (fromStrings) return fromStrings;
  const idRaw = r.id;
  if (typeof idRaw === "number" && Number.isFinite(idRaw)) return String(Math.trunc(idRaw));
  if (typeof idRaw === "string" && idRaw.trim()) return idRaw.trim();
  return undefined;
}

function decisionFromDecisionField(
  value: string | undefined,
): NormalizedGuestPermissionDecision["expectation"] | undefined {
  if (!value) return undefined;
  const v = value.toUpperCase();
  if (
    v === "EXPECTED" ||
    v === "EXPECTED_GUEST" ||
    v === "GUEST_EXPECTED"
  )
    return "expected";
  if (
    v === "NOT_EXPECTED" ||
    v === "NOT_EXPECTED_GUEST" ||
    v === "UNEXPECTED" ||
    v === "GUEST_UNEXPECTED"
  )
    return "unexpected";
  return undefined;
}

export function normalizeGuestPermissionResponse(raw: unknown): NormalizedGuestPermissionDecision {
  const data = unwrapEnvelope(raw) as unknown;
  const row =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  const directDecision = decisionFromDecisionField(readString(row, ["decision"]));

  let legacy: Partial<MessageFeaturePermissionDecision> | null = null;
  if (
    (row.decision === "EXPECTED_GUEST" || row.decision === "NOT_EXPECTED_GUEST") &&
    typeof row.schedule_match === "boolean"
  ) {
    legacy = row as unknown as MessageFeaturePermissionDecision;
  }

  let expectation =
    legacy?.decision === "EXPECTED_GUEST"
      ? "expected"
      : legacy?.decision === "NOT_EXPECTED_GUEST"
        ? "unexpected"
        : directDecision;

  if (!expectation) {
    expectation = row.schedule_match === true ? "expected" : "unexpected";
  }

  const senderLegacy = legacy?.sender_message;
  const memberLegacy = legacy?.member_message;

  const proceedCopy =
    readString(row, ["proceed_copy", "proceed_hint", "proceed_instructions"]) ??
    senderLegacy?.text;

  const waitCopy =
    readString(row, ["wait_copy", "wait_hint", "host_wait_message"]) ??
    memberLegacy?.text;

  const requestId =
    readString(row, [
      "request_id",
      "permission_request_id",
      "guest_request_id",
      "id",
    ]);

  const pollingNeeded = Boolean(row.polling_needed ?? row.awaiting_approval);

  let approvalRaw = readString(row, ["approval_status", "status"]);
  let approvalStatus: NormalizedGuestPermissionDecision["approvalStatus"] = "NONE";
  if (approvalRaw) {
    const u = approvalRaw.toUpperCase();
    if (u === "PENDING" || u === "REVIEW") approvalStatus = "PENDING";
    else if (u === "APPROVED" || u === "GRANTED") approvalStatus = "APPROVED";
    else if (u === "REJECTED" || u === "DENIED") approvalStatus = "REJECTED";
  }

  if (expectation === "unexpected" && approvalStatus === "NONE") {
    approvalStatus = "PENDING";
  }

  const notifyMemberAssist = Boolean(
    row.notify_member_assist ?? row.notifyMemberAssist,
  );

  const guestId = readString(row, ["guest_id", "guestId"]);
  const zoneId = readZoneIdFromRow(row);
  const exchange_code = readString(row, ["exchange_code", "exchangeCode"]);
  const exchange_expires_at = readString(row, [
    "exchange_expires_at",
    "exchangeExpiresAt",
  ]);

  return {
    expectation,
    scheduleMatch: Boolean(legacy?.schedule_match ?? row.schedule_match),
    proceedCopy,
    waitCopy,
    notifyMemberAssist,
    requestId,
    pollingNeeded: pollingNeeded || approvalStatus === "PENDING",
    approvalStatus,
    nextInstructions: readString(row, ["next_instructions", "instructions"]),
    ...(guestId ? { guestId } : {}),
    ...(zoneId ? { zoneId } : {}),
    ...(exchange_code ? { exchange_code } : {}),
    ...(exchange_expires_at ? { exchange_expires_at } : {}),
    raw: legacy && legacy.decision ? (legacy as MessageFeaturePermissionDecision) : undefined,
  };
}

export function resolveMappedDeviceApiKey(): string {
  return String(import.meta.env.VITE_GUEST_DEVICE_API_KEY ?? "").trim();
}

export async function requestGuestScanAuthToken(payload: { to: string; token: string }): Promise<{
  data: { scanAuthToken?: string } | null;
  error: string | null;
}> {
  const url = scanAuthUrl();
  if (!url) {
    return { data: null, error: null };
  }
  try {
    const res = await guestAxios.post<unknown>(url, {
      to: payload.to,
      token: payload.token,
    });
    const body = unwrapEnvelope(res.data) as Record<string, unknown>;
    const scanAuthToken = readString(body, [
      "scanAuthToken",
      "scan_auth_token",
      "token",
    ]);
    return { data: scanAuthToken ? { scanAuthToken } : null, error: null };
  } catch (e) {
    const msg =
      e instanceof AxiosError
        ? unwrapAxiosEnvelopeError(e.response?.data) || e.message
        : String(e);
    return { data: null, error: msg || "scan auth failed" };
  }
}

export async function submitGuestArrivalPermission(
  payload: GuestArrivalPermissionPayload,
  options: {
    scanAuthToken?: string;
    fallbackApiKey?: string;
    idempotencyKey?: string;
  } = {},
): Promise<SubmitGuestPermissionResult> {
  const path = guestAccessPermissionPath();
  const headers: Record<string, string> = {};
  const scanTok = options.scanAuthToken?.trim();
  if (scanTok) {
    headers["X-Scan-Auth"] = scanTok;
    headers["x-scan-auth"] = scanTok;
  }
  const apiKey = options.fallbackApiKey?.trim();
  if (apiKey) headers["x-api-key"] = apiKey;

  const idem = options.idempotencyKey?.trim();
  if (idem) {
    headers["Idempotency-Key"] = idem;
    headers["idempotency-key"] = idem;
  }

  try {
    const res = await guestAxios.post<unknown>(path, toGuestMessageFeaturePayload(payload), {
      headers,
      validateStatus: () => true,
    });
    const status = res.status;
    const body = res.data;

    if (status === 401) {
      return {
        data: null,
        error: "Scan session expired. Please scan the guest QR again.",
        errorCode: "INVALID_SCAN_AUTH",
      };
    }

    if (status >= 400) {
      const msg =
        unwrapAxiosEnvelopeError(body) ||
        (typeof (body as { message?: string } | undefined)?.message === "string"
          ? (body as { message: string }).message
          : `Request failed (${status})`);
      if (status === 401 || /scan.*auth|invalid.*token/i.test(String(msg))) {
        return { data: null, error: msg, errorCode: "INVALID_SCAN_AUTH" };
      }
      return { data: null, error: msg };
    }

    return { data: normalizeGuestPermissionResponse(body), error: null };
  } catch (e) {
    const msg =
      e instanceof AxiosError
        ? unwrapAxiosEnvelopeError(e.response?.data) ||
          e.message ||
          "Request failed"
        : e instanceof Error
          ? e.message
          : "Request failed";
    return { data: null, error: msg };
  }
}

/** Poll guest-request status without auth (guest device). Backend may omit this route. */
export async function pollGuestApprovalStatus(requestId: string): Promise<{
  data: { status: GuestApprovalStatus } | null;
  error: string | null;
}> {
  const tpl = approvalPollTemplate();
  if (!tpl || !requestId.trim()) return { data: null, error: null };
  const url = tpl.replace(/\{requestId\}/gi, encodeURIComponent(requestId.trim()));
  try {
    const res = await guestAxios.get<unknown>(url, { validateStatus: () => true });
    if (res.status >= 400) return { data: null, error: null };
    const data = unwrapEnvelope(res.data);
    const row =
      data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const st = String(row.approval_status ?? row.status ?? "").toUpperCase();
    if (st === "PENDING") return { data: { status: "PENDING" }, error: null };
    if (st === "APPROVED" || st === "GRANTED")
      return { data: { status: "APPROVED" }, error: null };
    if (st === "REJECTED" || st === "DENIED")
      return { data: { status: "REJECTED" }, error: null };
    return { data: null, error: null };
  } catch {
    return { data: null, error: null };
  }
}

export async function listGuestRequestsForZone(zoneId: string): Promise<{
  data: GuestRequestRow[];
  error: string | null;
}> {
  const base = guestRequestsListPath();
  if (!zoneId.trim()) return { data: [], error: null };
  const result = await authRequest<unknown>({
    method: "GET",
    url: base,
    params: { zone_id: zoneId },
  });
  if (result.error) return { data: [], error: result.error };

  const raw = unwrapEnvelope(result.data);
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (
    raw &&
    typeof raw === "object" &&
    Array.isArray((raw as Record<string, unknown>).items)
  ) {
    list = (raw as { items: unknown[] }).items;
  }

  const rows: GuestRequestRow[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const id = readGuestRequestRowId(r);
    if (!id) continue;
    const kind = String(r.kind ?? "").toLowerCase();
    const guestStatusUpper = String(r.guest_status ?? "").toUpperCase();
    const expectation =
      guestStatusUpper === "UNEXPECTED" ||
      kind === "unexpected" ||
      String(r.expectation ?? "").toLowerCase().includes("unexpected") ||
      r.unexpected === true
        ? "unexpected"
        : "expected";
    let statusRaw = String(r.status ?? r.approval_status ?? "").toUpperCase();
    if (!statusRaw) {
      const res = String(r.resolution ?? "").toLowerCase();
      if (res === "pending" || res === "review") statusRaw = "PENDING";
      else if (res === "approved" || res === "granted") statusRaw = "APPROVED";
      else if (res === "rejected" || res === "denied") statusRaw = "REJECTED";
    }
    let status: GuestRequestRow["status"] = "ARRIVED";
    if (statusRaw === "PENDING" || statusRaw === "REVIEW") status = "PENDING";
    else if (statusRaw === "APPROVED") status = "APPROVED";
    else if (statusRaw === "REJECTED" || statusRaw === "DENIED") status = "REJECTED";
    rows.push({
      id,
      zoneId:
        readString(r, ["zone_id", "zoneId"]) ??
        zoneId,
      guestName: readString(r, ["guest_name", "guestName"]),
      hid: readString(r, ["hid", "device_id", "deviceId"]),
      createdAt:
        readString(r, ["created_at", "arrived_at", "time"]) ??
        undefined,
      expectation,
      status,
    });
  }
  return { data: rows, error: null };
}

export async function approveGuestPermissionRequestRemote(
  requestId: string,
  zoneId: string,
) {
  return authRequest<unknown>({
    method: "POST",
    url: `/message-feature/access/guest-requests/${encodeURIComponent(requestId)}/approve`,
    params: { zone_id: zoneId.trim() },
    data: {},
  });
}

export async function denyGuestPermissionRequestRemote(
  requestId: string,
  zoneId: string,
) {
  return authRequest<unknown>({
    method: "POST",
    url: `/message-feature/access/guest-requests/${encodeURIComponent(requestId)}/reject`,
    params: { zone_id: zoneId.trim() },
    data: {},
  });
}

export async function createGuestChatThreadPlaceholder(requestId: string) {
  return authRequest<{ id?: string; thread_id?: string }>({
    method: "POST",
    url: "/message-feature/access/guest-requests/chat-thread",
    data: { request_id: requestId },
  });
}

function parseAnonymousAccessFailure(body: unknown): { code?: string; message: string } {
  const globalErr = readGlobalErrorFields(body);
  if (globalErr) {
    return { code: globalErr.code, message: globalErr.message };
  }
  const envMsg = unwrapAxiosEnvelopeError(body);
  if (envMsg) {
    let code: string | undefined;
    if (body && typeof body === "object") {
      const r = body as Record<string, unknown>;
      code = readString(r, ["error_code", "code"]);
      const nest = r.error;
      if (!code && nest && typeof nest === "object") {
        code = readString(nest as Record<string, unknown>, ["code", "error_code"]);
      }
    }
    return { code, message: envMsg };
  }
  if (body && typeof body === "object") {
    const r = body as Record<string, unknown>;
    const message =
      readString(r, ["message", "detail"]) ?? "Request failed";
    const code = readString(r, ["error_code", "code"]);
    return { code, message };
  }
  return { message: "Request failed" };
}

export function mapGuestAccessErrorCode(code?: string, fallback?: string): string {
  const c = String(code ?? "").trim().toUpperCase();
  if (c === "PERMISSION_MANUAL_DISABLED") {
    return "Permission events are automatic from guest access workflow.";
  }
  if (c === "GUEST_MESSAGE_TYPE_NOT_ALLOWED") {
    return "Guests can send CHAT only";
  }
  if (c === "INVALID_GUEST_TOKEN" || c === "TOKEN_ZONE_MISMATCH") {
    return "This invite link is invalid. Ask your host for a new guest invite.";
  }
  if (c === "GUEST_NOT_AUTHORIZED_FOR_ZONE") {
    return "Access denied for this zone. Please choose an authorized zone.";
  }
  return fallback ?? "Request failed";
}

export type AnonymousGuestPermissionBody = {
  /** Issued guest QR token from `?gt=` (preferred for new flows). */
  guest_qr_token?: string;
  /** Plain zone check-in; omit when using `guest_qr_token` unless verifying zone match. */
  zone_id?: string;
  /** Network id from `?nid=` (Safe Zone Patrol network access QR). */
  network_id?: string;
  guest_name: string;
  event_id?: string;
  device_id?: string;
  location?: { lat: number; lng: number };
  /** Legacy / optional signed query param. */
  sig?: string;
};

export type AnonymousGuestPermissionResult =
  | {
      ok: true;
      status: "EXPECTED" | "UNEXPECTED";
      message: string;
      guestId?: string;
      /** Present when backend echoes zone; needed for GET /session/… when `zid` is not in URL. */
      zoneId?: string;
      /** When present, client can exchange immediately without polling session. */
      exchange_code?: string;
      exchange_expires_at?: string;
    }
  | { ok: false; errorCode?: string; message: string };

export async function submitAnonymousGuestPermission(
  body: AnonymousGuestPermissionBody,
): Promise<AnonymousGuestPermissionResult> {
  const path = anonymousAccessPermissionPath();
  const hasToken = Boolean(body.guest_qr_token?.trim());
  const hasZone = Boolean(body.zone_id?.trim());
  const hasNetwork = Boolean(body.network_id?.trim());
  if (!hasToken && !hasZone && !hasNetwork) {
    return { ok: false, message: "Missing zone, network id, or guest access token." };
  }
  try {
    const res = await guestAxios.post<unknown>(path, body, {
      validateStatus: () => true,
    });
    if (res.status >= 400) {
      const { code, message } = parseAnonymousAccessFailure(res.data);
      return {
        ok: false,
        errorCode: code,
        message: mapGuestAccessErrorCode(code, message),
      };
    }
    const data = unwrapEnvelope(res.data);
    const row =
      data && typeof data === "object" && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : {};
    const st = readString(row, ["status", "access_status"])?.toUpperCase();
    const message = readString(row, ["message", "detail", "msg"]) ?? "";
    const guestId = readString(row, ["guest_id", "guestId"]);
    const respZoneId = readZoneIdFromRow(row);
    const exchange_code = readString(row, ["exchange_code", "exchangeCode"]);
    const exchange_expires_at = readString(row, [
      "exchange_expires_at",
      "exchangeExpiresAt",
    ]);
    const exchangeFields =
      exchange_code && exchange_code.trim()
        ? {
            exchange_code: exchange_code.trim(),
            ...(exchange_expires_at?.trim()
              ? { exchange_expires_at: exchange_expires_at.trim() }
              : {}),
          }
        : {};

    if (st === "EXPECTED") {
      return {
        ok: true,
        status: "EXPECTED",
        message: message || "You are expected.",
        guestId,
        zoneId: respZoneId,
        ...exchangeFields,
      };
    }
    if (st === "UNEXPECTED") {
      return {
        ok: true,
        status: "UNEXPECTED",
        message: message || "Waiting for approval.",
        guestId,
        zoneId: respZoneId,
        ...exchangeFields,
      };
    }

    const decision = readString(row, ["decision", "expectation"])?.toUpperCase();
    if (decision === "EXPECTED" || row.expectation === true) {
      return {
        ok: true,
        status: "EXPECTED",
        message: message || "You are expected.",
        guestId,
        zoneId: respZoneId,
        ...exchangeFields,
      };
    }
    if (
      decision === "UNEXPECTED" ||
      decision === "NOT_EXPECTED" ||
      row.expectation === false
    ) {
      return {
        ok: true,
        status: "UNEXPECTED",
        message: message || "Waiting for approval.",
        guestId,
        zoneId: respZoneId,
        ...exchangeFields,
      };
    }

    return {
      ok: false,
      message: message || "Unexpected response from access service.",
    };
  } catch (e) {
    const msg =
      e instanceof AxiosError
        ? unwrapAxiosEnvelopeError(e.response?.data) || e.message
        : e instanceof Error
          ? e.message
          : "Request failed";
    return { ok: false, message: msg || "Request failed" };
  }
}

export type GuestSessionPollStatus = "PENDING" | "APPROVED" | "REJECTED" | "UNKNOWN";

export type ApiEnvelopeStatus = "success" | "error";

export type PrimaryGuestQrTokenResponse = {
  zone_id: string;
  url?: string | null;
  path_with_query?: string | null;
  token_suffix?: string | null;
};

export type GuestAccessPermissionSubmitResponse = {
  status: "EXPECTED" | "UNEXPECTED";
  message: string;
  guest_id?: string;
  zone_id?: string;
};

export type GuestAccessSessionPollResponse = {
  status: "PENDING" | "APPROVED" | "REJECTED";
  message?: string;
  exchange_code?: string;
  exchange_expires_at?: string;
};

export type GuestRequestListItem = {
  id: string;
  zone_id: string;
  guest_name?: string;
  hid?: string;
  created_at?: string;
  expectation: "expected" | "unexpected";
  status: "ARRIVED" | "PENDING" | "APPROVED" | "REJECTED";
};

export type GuestAccessSessionPollResult = {
  status: GuestSessionPollStatus;
  message?: string;
  /** Present when backend supports one-time guest session exchange (APPROVED only). */
  exchange_code?: string;
  exchange_expires_at?: string;
  error: string | null;
};

export async function pollGuestAccessSession(
  guestId: string,
  zoneId?: string,
): Promise<GuestAccessSessionPollResult> {
  const id = guestId.trim();
  const z = String(zoneId ?? "").trim();
  if (!id) {
    return { status: "UNKNOWN", error: "Missing guest id." };
  }
  const tpl = accessSessionUrlTemplate();
  const path = tpl
    .replace(/\{guest_id\}/gi, encodeURIComponent(id))
    .replace(/\{guestId\}/gi, encodeURIComponent(id));
  try {
    const res = await guestAxios.get<unknown>(path, {
      ...(z ? { params: { zone_id: z } } : {}),
      validateStatus: () => true,
    });
    if (res.status >= 400) {
      const { code, message } = parseAnonymousAccessFailure(res.data);
      return {
        status: "UNKNOWN",
        error: mapGuestAccessErrorCode(code, message || `Request failed (${res.status})`),
      };
    }
    const data = unwrapEnvelope(res.data);
    const row =
      data && typeof data === "object" && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : {};
    const st = readString(row, ["status", "approval_status", "session_status"])?.toUpperCase();
    const message = readString(row, ["message", "detail", "msg"]);
    if (st === "APPROVED" || st === "GRANTED") {
      const exchange_code = readString(row, ["exchange_code", "exchangeCode"]);
      const exchange_expires_at = readString(row, [
        "exchange_expires_at",
        "exchangeExpiresAt",
      ]);
      return {
        status: "APPROVED",
        message,
        ...(exchange_code ? { exchange_code } : {}),
        ...(exchange_expires_at ? { exchange_expires_at } : {}),
        error: null,
      };
    }
    if (st === "REJECTED" || st === "DENIED") {
      return { status: "REJECTED", message, error: null };
    }
    if (st === "PENDING" || st === "REVIEW" || st === "WAITING") {
      return { status: "PENDING", message, error: null };
    }
    return { status: "UNKNOWN", message, error: null };
  } catch (e) {
    const msg =
      e instanceof AxiosError
        ? unwrapAxiosEnvelopeError(e.response?.data) || e.message
        : "Request failed";
    return { status: "UNKNOWN", error: msg };
  }
}
