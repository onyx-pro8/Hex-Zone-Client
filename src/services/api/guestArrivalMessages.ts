import axios from "axios";
import { apiClient } from "./client";

/**
 * Path template for zone guest arrival copy settings. `{zone_id}` / `{zoneId}` are replaced with encodeURIComponent(zoneId).
 * Override with `VITE_GUEST_ARRIVAL_MESSAGES_PATH_TEMPLATE` if the backend route differs.
 */
const guestArrivalMessagesPathTemplate = (): string => {
  const raw = String(
    import.meta.env.VITE_GUEST_ARRIVAL_MESSAGES_PATH_TEMPLATE ?? "",
  ).trim();
  return raw.length > 0 ? raw : "/api/access/zones/{zone_id}/guest-arrival-messages";
};

/** HTTP verb for save; default `patch`. Set `VITE_GUEST_ARRIVAL_MESSAGES_SAVE_METHOD` to `put` if required. */
const guestArrivalMessagesSaveMethod = (): "patch" | "put" => {
  const raw = String(
    import.meta.env.VITE_GUEST_ARRIVAL_MESSAGES_SAVE_METHOD ?? "",
  )
    .trim()
    .toLowerCase();
  return raw === "put" ? "put" : "patch";
};

export function guestArrivalMessagesPath(zoneId: string): string {
  const z = zoneId.trim();
  const enc = encodeURIComponent(z);
  return guestArrivalMessagesPathTemplate()
    .replace(/\{zone_id\}/gi, enc)
    .replace(/\{zoneId\}/gi, enc);
}

/** Used when `defaults` is omitted from GET (placeholders only). */
export const GUEST_ARRIVAL_FALLBACK_DEFAULTS = {
  expected_arrival_message: "You are expected. Please proceed.",
  unexpected_arrival_message:
    "You are not scheduled. Please wait for approval.",
  guest_pass_verified_message:
    "Your guest pass was verified. Please proceed.",
} as const;

export type GuestArrivalMessagesDefaults = {
  expected_arrival_message: string;
  unexpected_arrival_message: string;
  guest_pass_verified_message?: string;
};

export type GuestArrivalMessagesData = {
  zone_id: string;
  expected_arrival_message: string | null;
  unexpected_arrival_message: string | null;
  guest_pass_verified_message?: string | null;
  defaults?: GuestArrivalMessagesDefaults;
};

export type GuestArrivalMessagesUpdatePayload = {
  expected_arrival_message: string | null;
  unexpected_arrival_message: string | null;
  guest_pass_verified_message?: string | null;
};

export type GuestArrivalMessagesValidationErrors = Record<string, string[]>;

export type GuestArrivalMessagesNormalized = GuestArrivalMessagesData & {
  defaults: GuestArrivalMessagesDefaults;
  supports_guest_pass_verified_message: boolean;
};

export type GuestArrivalMessagesLoadResult =
  | {
      ok: true;
      status: number;
      data: GuestArrivalMessagesNormalized;
    }
  | {
      ok: false;
      status: number;
      message: string;
      validationErrors: GuestArrivalMessagesValidationErrors | null;
    };

export type GuestArrivalMessagesSaveResult =
  | { ok: true; status: number; data: GuestArrivalMessagesNormalized }
  | {
      ok: false;
      status: number;
      message: string;
      validationErrors: GuestArrivalMessagesValidationErrors | null;
    };

const MAX_MESSAGE_LEN = 500;

export function guestArrivalMessageMaxLength(): number {
  return MAX_MESSAGE_LEN;
}

function unwrapEnvelope(raw: unknown): unknown {
  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    (raw as { status?: string }).status === "success" &&
    "data" in raw
  ) {
    return (raw as { data: unknown }).data;
  }
  return raw;
}

function readString(
  record: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const v = record[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/** Reads first present key; null or blank string → null; missing key → null. */
function readMessageOverride(
  record: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const v = record[key];
    if (v === null) return null;
    if (typeof v === "string") {
      const t = v.trim();
      return t.length > 0 ? t : null;
    }
    return null;
  }
  return null;
}

function normalizeValidationErrors(
  raw: unknown,
): GuestArrivalMessagesValidationErrors | null {
  if (!raw || typeof raw !== "object") return null;
  const bag = raw as Record<string, unknown>;
  const details = bag.detail;
  if (!Array.isArray(details)) return null;
  const out: GuestArrivalMessagesValidationErrors = {};
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

function errorMessageFromBody(status: number, body: unknown): string {
  if (!body || typeof body !== "object") {
    return status === 404
      ? "Zone or resource not found."
      : `Request failed (${status}).`;
  }
  const row = body as Record<string, unknown>;
  const detail = row.detail;
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  if (Array.isArray(detail)) {
    const first = detail[0];
    if (first && typeof first === "object") {
      const msg = (first as { msg?: string }).msg;
      if (typeof msg === "string" && msg.trim()) return msg.trim();
    }
  }
  const msg =
    typeof row.message === "string"
      ? row.message.trim()
      : typeof row.error === "string"
        ? row.error.trim()
        : "";
  if (msg) return msg;
  return status === 404
    ? "Zone or resource not found."
    : `Request failed (${status}).`;
}

function parseDefaults(
  raw: Record<string, unknown> | null,
): Partial<GuestArrivalMessagesDefaults> {
  if (!raw) return {};
  return {
    ...(readString(raw, ["expected_arrival_message", "expectedArrivalMessage"])
      ? {
          expected_arrival_message: readString(raw, [
            "expected_arrival_message",
            "expectedArrivalMessage",
          ])!,
        }
      : {}),
    ...(readString(raw, [
      "unexpected_arrival_message",
      "unexpectedArrivalMessage",
    ])
      ? {
          unexpected_arrival_message: readString(raw, [
            "unexpected_arrival_message",
            "unexpectedArrivalMessage",
          ])!,
        }
      : {}),
    ...(readString(raw, [
      "guest_pass_verified_message",
      "guestPassVerifiedMessage",
    ])
      ? {
          guest_pass_verified_message: readString(raw, [
            "guest_pass_verified_message",
            "guestPassVerifiedMessage",
          ])!,
        }
      : {}),
  };
}

function normalizeLoaded(
  row: Record<string, unknown>,
): GuestArrivalMessagesNormalized {
  const zone_id =
    readString(row, ["zone_id", "zoneId"]) ??
    readString(row, ["id"]) ??
    "";

  const expected_arrival_message = readMessageOverride(row, [
    "expected_arrival_message",
    "expectedArrivalMessage",
  ]);
  const unexpected_arrival_message = readMessageOverride(row, [
    "unexpected_arrival_message",
    "unexpectedArrivalMessage",
  ]);

  const hasGuestPassKey = Object.prototype.hasOwnProperty.call(
    row,
    "guest_pass_verified_message",
  );

  let guest_pass_verified_message: string | null | undefined;
  if (hasGuestPassKey) {
    guest_pass_verified_message = readMessageOverride(row, [
      "guest_pass_verified_message",
      "guestPassVerifiedMessage",
    ]);
  }

  const defaultsRaw =
    row.defaults && typeof row.defaults === "object" && !Array.isArray(row.defaults)
      ? (row.defaults as Record<string, unknown>)
      : null;
  const parsedDefaults = parseDefaults(defaultsRaw);
  const hasGuestPassInDefaults =
    defaultsRaw != null &&
    Object.prototype.hasOwnProperty.call(
      defaultsRaw,
      "guest_pass_verified_message",
    );

  const supports_guest_pass_verified_message =
    hasGuestPassKey || hasGuestPassInDefaults;

  const defaults: GuestArrivalMessagesDefaults = {
    expected_arrival_message:
      parsedDefaults.expected_arrival_message ??
      GUEST_ARRIVAL_FALLBACK_DEFAULTS.expected_arrival_message,
    unexpected_arrival_message:
      parsedDefaults.unexpected_arrival_message ??
      GUEST_ARRIVAL_FALLBACK_DEFAULTS.unexpected_arrival_message,
    ...(supports_guest_pass_verified_message
      ? {
          guest_pass_verified_message:
            parsedDefaults.guest_pass_verified_message ??
            GUEST_ARRIVAL_FALLBACK_DEFAULTS.guest_pass_verified_message,
        }
      : {}),
  };

  return {
    zone_id,
    expected_arrival_message,
    unexpected_arrival_message,
    ...(supports_guest_pass_verified_message
      ? { guest_pass_verified_message }
      : {}),
    defaults,
    supports_guest_pass_verified_message,
  };
}

function normalizeFromResponseBody(body: unknown): GuestArrivalMessagesNormalized | null {
  const inner = unwrapEnvelope(body);
  if (!inner || typeof inner !== "object" || Array.isArray(inner)) return null;
  return normalizeLoaded(inner as Record<string, unknown>);
}

export function formatGuestArrivalValidationErrors(
  errors: GuestArrivalMessagesValidationErrors | null,
): string | null {
  if (!errors) return null;
  const parts: string[] = [];
  for (const [field, msgs] of Object.entries(errors)) {
    for (const m of msgs) {
      parts.push(field ? `${field}: ${m}` : m);
    }
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

export async function getGuestArrivalMessages(
  zoneId: string,
): Promise<GuestArrivalMessagesLoadResult> {
  const z = zoneId.trim();
  if (!z) {
    return {
      ok: false,
      status: 400,
      message: "Missing network id.",
      validationErrors: null,
    };
  }
  const url = guestArrivalMessagesPath(z);
  try {
    const response = await apiClient.get<unknown>(url, {
      validateStatus: () => true,
    });
    if (response.status === 200) {
      const parsed = normalizeFromResponseBody(response.data);
      if (!parsed) {
        return {
          ok: false,
          status: 500,
          message: "Unexpected response shape from server.",
          validationErrors: null,
        };
      }
      return { ok: true, status: 200, data: parsed };
    }
    const validationErrors = normalizeValidationErrors(response.data);
    return {
      ok: false,
      status: response.status,
      message: errorMessageFromBody(response.status, response.data),
      validationErrors,
    };
  } catch (error) {
    const message = axios.isAxiosError(error)
      ? error.message || "Request failed"
      : error instanceof Error
        ? error.message
        : "Request failed";
    return {
      ok: false,
      status: 0,
      message,
      validationErrors: null,
    };
  }
}

/** Trim; empty string becomes null. Enforces max length (throws if over). */
export function normalizeGuestArrivalMessageField(
  value: string,
): string | null {
  const t = value.trim();
  if (!t) return null;
  if (t.length > MAX_MESSAGE_LEN) {
    throw new Error(`Messages must be at most ${MAX_MESSAGE_LEN} characters.`);
  }
  return t;
}

export async function updateGuestArrivalMessages(
  zoneId: string,
  payload: GuestArrivalMessagesUpdatePayload,
): Promise<GuestArrivalMessagesSaveResult> {
  const z = zoneId.trim();
  if (!z) {
    return {
      ok: false,
      status: 400,
      message: "Missing network id.",
      validationErrors: null,
    };
  }
  const url = guestArrivalMessagesPath(z);
  const method = guestArrivalMessagesSaveMethod();
  try {
    const response = await apiClient.request<unknown>({
      method,
      url,
      data: payload,
      validateStatus: () => true,
    });
    if (response.status >= 200 && response.status < 300) {
      const parsed = normalizeFromResponseBody(response.data);
      if (!parsed) {
        return {
          ok: false,
          status: 500,
          message: "Unexpected response shape from server.",
          validationErrors: null,
        };
      }
      return { ok: true, status: response.status, data: parsed };
    }
    const validationErrors = normalizeValidationErrors(response.data);
    return {
      ok: false,
      status: response.status,
      message: errorMessageFromBody(response.status, response.data),
      validationErrors,
    };
  } catch (error) {
    const message = axios.isAxiosError(error)
      ? error.message || "Request failed"
      : error instanceof Error
        ? error.message
        : "Request failed";
    return {
      ok: false,
      status: 0,
      message,
      validationErrors: null,
    };
  }
}
