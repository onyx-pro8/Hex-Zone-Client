import { AxiosError } from "axios";
import { API_BASE_URL } from "./client";
import { guestApiBasePath, guestSessionAxios } from "./guestSession";

function guestApiDevLog(method: string, pathWithQuery: string) {
  if (!import.meta.env.DEV) return;
  const root = API_BASE_URL.replace(/\/+$/, "");
  const p = pathWithQuery.startsWith("/") ? pathWithQuery : `/${pathWithQuery}`;
  // eslint-disable-next-line no-console
  console.debug(`[guest-api] ${method} ${root}${p}`);
}

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

function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = record[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/** Like readString but coerces finite numeric ids (many backends send owner_id as JSON number). */
function readIdString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = record[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(Math.trunc(v));
  }
  return undefined;
}

export type GuestMe = {
  guest_id: string;
  display_name: string;
  zone_ids: string[];
  allowed_message_types: string[];
};

function readZoneIdsLoose(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const x of value) {
    if (typeof x === "string" && x.trim()) {
      out.push(x.trim());
      continue;
    }
    if (x && typeof x === "object" && !Array.isArray(x)) {
      const o = x as Record<string, unknown>;
      const id = o.id ?? o.zone_id ?? o.zoneId;
      if (typeof id === "string" && id.trim()) out.push(id.trim());
      else if (typeof id === "number" && Number.isFinite(id)) out.push(String(Math.trunc(id)));
    }
  }
  return out;
}

export function normalizeGuestMe(raw: unknown): GuestMe | null {
  const data = unwrapEnvelope(raw) as unknown;
  const base =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  const nested = base.guest;
  const row: Record<string, unknown> = { ...base };
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    Object.assign(row, nested as Record<string, unknown>);
  }
  const guest_id =
    readString(row, ["guest_id", "guestId"]) ??
    (nested && typeof nested === "object" && !Array.isArray(nested)
      ? readString(nested as Record<string, unknown>, ["id"])
      : undefined);
  if (!guest_id) return null;
  const display_name = readString(row, ["display_name", "displayName"]) ?? "";
  let zone_ids = readZoneIdsLoose(row.zone_ids);
  if (!zone_ids.length) zone_ids = readZoneIdsLoose(row.zoneIds);
  if (!zone_ids.length) zone_ids = readZoneIdsLoose(row.zones);
  const single = readString(row, ["zone_id", "zoneId"]);
  if (!zone_ids.length && single) zone_ids = [single];
  const allowedRaw = row.allowed_message_types ?? row.allowedMessageTypes;
  const allowed_message_types: string[] = Array.isArray(allowedRaw)
    ? (allowedRaw as unknown[])
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((s) => s.trim().toUpperCase())
    : [];
  return { guest_id, display_name, zone_ids, allowed_message_types };
}

export type GuestPeer = {
  owner_id: string;
  display_name?: string;
};

/** Normalize peer list for tests and reuse; supports several backend key names. */
export function normalizeGuestPeers(raw: unknown): GuestPeer[] {
  const data = unwrapEnvelope(raw) as unknown;
  let list: unknown[] = [];
  if (Array.isArray(data)) list = data;
  else if (data && typeof data === "object" && !Array.isArray(data)) {
    const bag = data as Record<string, unknown>;
    const keys = ["items", "peers", "hosts", "staff", "members", "zone_members", "admins", "contacts"];
    for (const k of keys) {
      const arr = bag[k];
      if (Array.isArray(arr)) {
        list = arr;
        break;
      }
    }
  }
  const out: GuestPeer[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const owner_id = readIdString(r, [
      "owner_id",
      "ownerId",
      "user_id",
      "userId",
      "account_owner_id",
      "accountOwnerId",
      "id",
    ]);
    if (!owner_id) continue;
    out.push({
      owner_id,
      display_name: readString(r, ["display_name", "displayName", "name", "label"]),
    });
  }
  return out;
}

export type GuestApiMessage = {
  id: string;
  zone_id: string;
  type: string;
  text?: string;
  from_owner_id?: string;
  to_owner_id?: string;
  created_at?: string;
  /** When the backend includes a structured blob (e.g. permission_visibility). */
  raw_payload?: Record<string, unknown> | null;
  /** From `raw_payload.permission_visibility` or top-level when type is PERMISSION. */
  permission_visibility?: string | null;
};

function normalizeGuestMessages(raw: unknown): GuestApiMessage[] {
  const data = unwrapEnvelope(raw) as unknown;
  let list: unknown[] = [];
  if (Array.isArray(data)) list = data;
  else if (
    data &&
    typeof data === "object" &&
    Array.isArray((data as Record<string, unknown>).items)
  ) {
    list = (data as { items: unknown[] }).items;
  } else if (
    data &&
    typeof data === "object" &&
    Array.isArray((data as Record<string, unknown>).messages)
  ) {
    list = (data as { messages: unknown[] }).messages;
  }
  const out: GuestApiMessage[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const id =
      readString(r, ["id", "message_id", "messageId"]) ??
      (typeof r.id === "number" ? String(r.id) : undefined);
    if (!id) continue;
    const zone_id = readString(r, ["zone_id", "zoneId"]) ?? "";
    const type = (
      readString(r, ["type", "message_type", "messageType"]) ?? "CHAT"
    ).toUpperCase();
    const rawPayload =
      r.raw_payload != null && typeof r.raw_payload === "object" && !Array.isArray(r.raw_payload)
        ? (r.raw_payload as Record<string, unknown>)
        : null;
    let permission_visibility: string | null | undefined;
    if (type === "PERMISSION") {
      const topPv = readString(r, ["permission_visibility", "permissionVisibility"]);
      const nestedPv = rawPayload
        ? readString(rawPayload, ["permission_visibility", "permissionVisibility"])
        : undefined;
      if (topPv !== undefined) permission_visibility = topPv;
      else if ("permission_visibility" in r && r.permission_visibility === null) permission_visibility = null;
      else if (nestedPv !== undefined) permission_visibility = nestedPv;
      else if (
        rawPayload &&
        "permission_visibility" in rawPayload &&
        rawPayload.permission_visibility === null
      ) {
        permission_visibility = null;
      }
    }
    out.push({
      id,
      zone_id,
      type,
      text: readString(r, ["text", "message", "body"]),
      from_owner_id: readString(r, ["from_owner_id", "fromOwnerId", "sender_id", "senderId", "from"]),
      to_owner_id: readString(r, ["to_owner_id", "toOwnerId", "receiver_id", "receiverId", "to"]),
      created_at: readString(r, ["created_at", "createdAt", "time"]),
      ...(rawPayload ? { raw_payload: rawPayload } : {}),
      ...(permission_visibility !== undefined ? { permission_visibility } : {}),
    });
  }
  return out;
}

export async function fetchGuestMe(): Promise<{
  data: GuestMe | null;
  error: string | null;
  status?: number;
}> {
  const base = guestApiBasePath();
  guestApiDevLog("GET", `${base}/me`);
  try {
    const res = await guestSessionAxios.get<unknown>(`${base}/me`, {
      validateStatus: () => true,
    });
    if (res.status === 404) {
      return { data: null, error: "Guest profile not found (404).", status: 404 };
    }
    if (res.status >= 400) {
      const msg =
        unwrapAxiosEnvelopeError(res.data) ||
        (typeof (res.data as { message?: string } | undefined)?.message === "string"
          ? (res.data as { message: string }).message
          : `Request failed (${res.status})`);
      return { data: null, error: msg, status: res.status };
    }
    return { data: normalizeGuestMe(res.data), error: null, status: res.status };
  } catch (e) {
    const msg =
      e instanceof AxiosError
        ? unwrapAxiosEnvelopeError(e.response?.data) || e.message
        : "Request failed";
    return { data: null, error: msg };
  }
}

export async function fetchGuestPeers(zoneId: string): Promise<{
  data: GuestPeer[];
  error: string | null;
  status?: number;
}> {
  const z = zoneId.trim();
  if (!z) return { data: [], error: "Missing zone id." };
  const base = guestApiBasePath();
  guestApiDevLog("GET", `${base}/zones/${encodeURIComponent(z)}/peers`);
  try {
    const res = await guestSessionAxios.get<unknown>(`${base}/zones/${encodeURIComponent(z)}/peers`, {
      validateStatus: () => true,
    });
    if (res.status === 404) {
      return {
        data: [],
        error: `Guest peers API returned 404. Implement GET ${base}/zones/{zone_id}/peers returning zone hosts (owner_id + display_name). See Hex-Zone-Client docs/BACKEND_ACCESS_ZONE_FULL_CONTRACT.md section 4.3.`,
        status: 404,
      };
    }
    if (res.status >= 400) {
      const msg =
        unwrapAxiosEnvelopeError(res.data) ||
        (typeof (res.data as { detail?: string } | undefined)?.detail === "string"
          ? String((res.data as { detail: string }).detail)
          : typeof (res.data as { message?: string } | undefined)?.message === "string"
            ? (res.data as { message: string }).message
            : `Request failed (${res.status})`);
      return { data: [], error: msg, status: res.status };
    }
    return { data: normalizeGuestPeers(res.data), error: null, status: res.status };
  } catch (e) {
    const msg =
      e instanceof AxiosError
        ? unwrapAxiosEnvelopeError(e.response?.data) || e.message
        : "Request failed";
    return { data: [], error: msg };
  }
}

export async function listGuestThreadMessages(params: {
  zone_id: string;
  with_owner_id: string;
  limit?: number;
}): Promise<{ data: GuestApiMessage[]; error: string | null; status?: number }> {
  const base = guestApiBasePath();
  const q = new URLSearchParams();
  q.set("zone_id", params.zone_id.trim());
  q.set("with_owner_id", params.with_owner_id.trim());
  if (params.limit != null) q.set("limit", String(params.limit));
  guestApiDevLog("GET", `${base}/messages?${q.toString()}`);
  try {
    const res = await guestSessionAxios.get<unknown>(`${base}/messages?${q.toString()}`, {
      validateStatus: () => true,
    });
    if (res.status >= 400) {
      const msg =
        unwrapAxiosEnvelopeError(res.data) ||
        (typeof (res.data as { message?: string } | undefined)?.message === "string"
          ? (res.data as { message: string }).message
          : `Request failed (${res.status})`);
      return { data: [], error: msg, status: res.status };
    }
    return { data: normalizeGuestMessages(res.data), error: null, status: res.status };
  } catch (e) {
    const msg =
      e instanceof AxiosError
        ? unwrapAxiosEnvelopeError(e.response?.data) || e.message
        : "Request failed";
    return { data: [], error: msg };
  }
}

export type GuestSendMessageBody = {
  zone_id: string;
  type: "CHAT";
  text?: string;
  to_owner_id: string;
  msg?: Record<string, unknown>;
};

export async function sendGuestMessage(
  body: GuestSendMessageBody,
): Promise<{ data: GuestApiMessage | null; error: string | null; status?: number }> {
  const base = guestApiBasePath();
  guestApiDevLog("POST", `${base}/messages`);
  try {
    const res = await guestSessionAxios.post<unknown>(`${base}/messages`, body, {
      validateStatus: () => true,
    });
    if (res.status >= 400) {
      const msg =
        unwrapAxiosEnvelopeError(res.data) ||
        (typeof (res.data as { message?: string } | undefined)?.message === "string"
          ? (res.data as { message: string }).message
          : `Request failed (${res.status})`);
      return { data: null, error: msg, status: res.status };
    }
    const data = unwrapEnvelope(res.data);
    const row =
      data && typeof data === "object" && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : {};
    const id = readString(row, ["id", "message_id", "messageId"]);
    if (!id) {
      return { data: null, error: null, status: res.status };
    }
    return {
      data: {
        id,
        zone_id: readString(row, ["zone_id", "zoneId"]) ?? body.zone_id,
        type: (readString(row, ["type", "message_type"]) ?? body.type).toUpperCase(),
        text: readString(row, ["text", "message"]),
        to_owner_id: readString(row, ["to_owner_id", "toOwnerId"]) ?? body.to_owner_id,
        created_at: readString(row, ["created_at", "createdAt"]),
      },
      error: null,
      status: res.status,
    };
  } catch (e) {
    const msg =
      e instanceof AxiosError
        ? unwrapAxiosEnvelopeError(e.response?.data) || e.message
        : "Request failed";
    return { data: null, error: msg };
  }
}

/** Optional dashboard blob; 404 returns `{ data: null, error: null }` so UI can skip. */
export async function fetchGuestZoneDashboard(zoneId: string): Promise<{
  data: unknown | null;
  error: string | null;
  notFound?: boolean;
}> {
  const z = zoneId.trim();
  if (!z) return { data: null, error: "Missing zone id." };
  const base = guestApiBasePath();
  guestApiDevLog("GET", `${base}/zones/${encodeURIComponent(z)}/dashboard`);
  try {
    const res = await guestSessionAxios.get<unknown>(
      `${base}/zones/${encodeURIComponent(z)}/dashboard`,
      { validateStatus: (s) => (s >= 200 && s < 300) || s === 404 },
    );
    if (res.status === 404) {
      return { data: null, error: null, notFound: true };
    }
    if (res.status >= 400) {
      const msg =
        unwrapAxiosEnvelopeError(res.data) ||
        (typeof (res.data as { message?: string } | undefined)?.message === "string"
          ? (res.data as { message: string }).message
          : `Request failed (${res.status})`);
      return { data: null, error: msg };
    }
    return { data: unwrapEnvelope(res.data), error: null };
  } catch (e) {
    const msg =
      e instanceof AxiosError
        ? unwrapAxiosEnvelopeError(e.response?.data) || e.message
        : "Request failed";
    return { data: null, error: msg };
  }
}
