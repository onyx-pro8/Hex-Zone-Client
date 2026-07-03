import axios, { AxiosError, type AxiosInstance } from "axios";
import { API_BASE_URL } from "./client";
import {
  clearGuestAccessSession,
  getGuestAccessToken,
  persistGuestAccessToken,
  persistGuestSessionMeta,
  type GuestSessionMeta,
} from "../../lib/guestAccessToken";
import {
  completeGuestSessionAuthFailureRedirect,
  guestSession401TryBeginRedirect,
} from "../../lib/guestSessionAuthRedirect";

/** Anonymous POST only — never attaches member or guest Bearer. */
export const guestExchangeAxios: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: { "Content-Type": "application/json" },
});

/** Guest Bearer only — never reads `zoneweaver_token`. */
export const guestSessionAxios: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: { "Content-Type": "application/json" },
});

guestSessionAxios.interceptors.request.use((config) => {
  const token = getGuestAccessToken();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

guestSessionAxios.interceptors.response.use(
  (res) => res,
  (error: AxiosError) => {
    if (error.response?.status === 401 && guestSession401TryBeginRedirect()) {
      clearGuestAccessSession();
      completeGuestSessionAuthFailureRedirect();
    }
    return Promise.reject(error);
  },
);

export function guestSessionExchangeUrl(): string {
  const raw = String(import.meta.env.VITE_GUEST_SESSION_EXCHANGE_URL ?? "").trim();
  return raw.length > 0 ? raw : "/api/access/guest-session";
}

export function guestApiBasePath(): string {
  const raw = String(import.meta.env.VITE_GUEST_API_BASE_PATH ?? "").trim();
  const path = raw.length > 0 ? raw : "/api/guest";
  return path.replace(/\/$/, "");
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

export type GuestSessionExchangeRequest = {
  guest_id: string;
  zone_id: string;
  exchange_code: string;
  device_id?: string;
};

export type GuestSessionExchangeData = {
  access_token: string;
  token_type: string;
  expires_in: number;
  guest: {
    guest_id: string;
    display_name: string;
    zone_ids: string[];
    allowed_message_types: string[];
  };
};

export type GuestSessionExchangeResult = {
  data: GuestSessionExchangeData | null;
  error: string | null;
  status?: number;
};

export function normalizeGuestSessionExchangeData(raw: unknown): GuestSessionExchangeData | null {
  const data = unwrapEnvelope(raw) as unknown;
  const row =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  const access_token = readString(row, ["access_token", "accessToken"]);
  if (!access_token) return null;
  const token_type = readString(row, ["token_type", "tokenType"]) ?? "Bearer";
  const expires_in =
    typeof row.expires_in === "number" && Number.isFinite(row.expires_in)
      ? row.expires_in
      : typeof row.expiresIn === "number" && Number.isFinite(row.expiresIn)
        ? row.expiresIn
        : 3600;
  const g = row.guest;
  if (!g || typeof g !== "object" || Array.isArray(g)) return null;
  const gr = g as Record<string, unknown>;
  const guest_id = readString(gr, ["guest_id", "guestId"]);
  const display_name = readString(gr, ["display_name", "displayName"]) ?? "";
  if (!guest_id) return null;
  const zone_ids = Array.isArray(gr.zone_ids)
    ? (gr.zone_ids as unknown[]).filter(
        (x): x is string => typeof x === "string" && x.trim().length > 0,
      )
    : Array.isArray(gr.zoneIds)
      ? (gr.zoneIds as unknown[]).filter(
          (x): x is string => typeof x === "string" && x.trim().length > 0,
        )
      : [];
  const allowedRaw = gr.allowed_message_types ?? gr.allowedMessageTypes;
  const allowed_message_types: string[] = Array.isArray(allowedRaw)
    ? (allowedRaw as unknown[])
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((s) => s.trim().toUpperCase())
    : ["PERMISSION", "CHAT"];

  return {
    access_token,
    token_type,
    expires_in,
    guest: {
      guest_id,
      display_name,
      zone_ids,
      allowed_message_types,
    },
  };
}

export async function exchangeGuestSession(
  body: GuestSessionExchangeRequest,
): Promise<GuestSessionExchangeResult> {
  const url = guestSessionExchangeUrl();
  try {
    const res = await guestExchangeAxios.post<unknown>(url, body, {
      validateStatus: () => true,
    });
    if (res.status === 404) {
      return {
        data: null,
        error:
          "Guest session exchange is not available on this server yet (404). Your host may need to update the backend.",
        status: 404,
      };
    }
    if (res.status >= 400) {
      const msg =
        unwrapAxiosEnvelopeError(res.data) ||
        (typeof (res.data as { message?: string } | undefined)?.message === "string"
          ? (res.data as { message: string }).message
          : `Request failed (${res.status})`);
      return { data: null, error: msg, status: res.status };
    }
    const normalized = normalizeGuestSessionExchangeData(res.data);
    if (!normalized) {
      return { data: null, error: "Unexpected response from guest session exchange.", status: res.status };
    }
    return { data: normalized, error: null, status: res.status };
  } catch (e) {
    const msg =
      e instanceof AxiosError
        ? unwrapAxiosEnvelopeError(e.response?.data) || e.message
        : e instanceof Error
          ? e.message
          : "Request failed";
    const status = e instanceof AxiosError ? e.response?.status : undefined;
    return { data: null, error: msg || "Request failed", status };
  }
}

export function persistGuestSessionAfterExchange(
  data: GuestSessionExchangeData,
  /** Zone used at exchange (poll path); ensures meta has a primary zone when guest.zone_ids is empty. */
  fallbackZoneId: string,
): void {
  persistGuestAccessToken(data.access_token);
  const zoneIds = data.guest.zone_ids?.length ? data.guest.zone_ids : [];
  const fb = fallbackZoneId.trim();
  const primaryZone = zoneIds.find((z) => z === fb) ?? (fb || zoneIds[0] || "");
  const geoTypes = new Set([
    "PANIC",
    "NS_PANIC",
    "NS-PANIC",
    "UNKNOWN",
    "PRIVATE",
    "PA",
    "SERVICE",
  ]);
  const allowed = data.guest.allowed_message_types?.length
    ? data.guest.allowed_message_types
    : ["CHAT"];
  const network_geo_messaging = allowed.some((t) =>
    geoTypes.has(String(t).trim().toUpperCase()),
  );
  const meta: GuestSessionMeta = {
    guest_id: data.guest.guest_id,
    zone_id: primaryZone,
    display_name: data.guest.display_name,
    zone_ids: zoneIds.length ? zoneIds : primaryZone ? [primaryZone] : [],
    allowed_message_types: allowed,
    ...(network_geo_messaging ? { network_geo_messaging: true } : {}),
  };
  persistGuestSessionMeta(meta);
}
