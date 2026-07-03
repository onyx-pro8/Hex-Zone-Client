export type GuestArrivalPosition = {
  latitude: number;
  longitude: number;
};

export type GuestArrivalPermissionPayload = {
  type: "PERMISSION";
  hid: string;
  tt?: string;
  to: string;
  msg: {
    guest_name: string;
    event_id?: string;
    guest_id?: string;
    scan_nonce?: string;
  };
  co?: string;
  position?: GuestArrivalPosition;
};

type GuestArrivalPayloadBuilderInput = {
  hid: string;
  to: string;
  guestName: string;
  eventId?: string;
  guestId?: string;
  scanNonce?: string;
  timestamp?: string;
  co?: string;
  position?: GuestArrivalPosition | null;
};

function toOptionalString(value?: string): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function pickZoneId(raw: Record<string, unknown>): string | null {
  const direct = [raw.to, raw.zone_id, raw.zoneId, raw.zone, raw.zid];
  for (const value of direct) {
    const trimmed = String(value ?? "").trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function parseZoneFromUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    const fromQuery =
      url.searchParams.get("to") ??
      url.searchParams.get("zone_id") ??
      url.searchParams.get("zoneId") ??
      url.searchParams.get("zone") ??
      url.searchParams.get("zid");
    if (fromQuery && fromQuery.trim()) return fromQuery.trim();
  } catch {
    return null;
  }
  return null;
}

function parseTokenFromUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    const token =
      url.searchParams.get("token") ??
      url.searchParams.get("tt") ??
      url.searchParams.get("guest_token");
    if (token && token.trim()) return token.trim();
  } catch {
    return null;
  }
  return null;
}

export function buildGuestArrivalQrUrl(
  zoneId: string,
  baseOrigin: string,
  token?: string,
): string {
  const trimmedZoneId = zoneId.trim();
  if (!trimmedZoneId) {
    throw new Error("Network id is required to build guest arrival QR URL.");
  }
  const url = new URL("/guest-arrival", baseOrigin);
  url.searchParams.set("to", trimmedZoneId);
  const trimmedToken = token?.trim();
  if (trimmedToken) {
    url.searchParams.set("token", trimmedToken);
  }
  return url.href;
}

export function parseGuestArrivalZoneFromQrPayload(payload: string): string | null {
  const trimmed = payload.trim();
  if (!trimmed) return null;

  const fromUrl = parseZoneFromUrl(trimmed);
  if (fromUrl) return fromUrl;

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return pickZoneId(parsed as Record<string, unknown>);
      }
      return null;
    } catch {
      return null;
    }
  }

  return trimmed;
}

export function parseGuestArrivalTokenFromQrPayload(payload: string): string | null {
  const trimmed = payload.trim();
  if (!trimmed) return null;

  const fromUrl = parseTokenFromUrl(trimmed);
  if (fromUrl) return fromUrl;

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const token = String(
        parsed.token ?? parsed.tt ?? parsed.guest_token ?? "",
      ).trim();
      return token || null;
    } catch {
      return null;
    }
  }

  return null;
}

export function buildGuestArrivalPermissionPayload(
  input: GuestArrivalPayloadBuilderInput,
): GuestArrivalPermissionPayload {
  const hid = input.hid.trim();
  const to = input.to.trim();
  const guestName = input.guestName.trim();
  const timestamp = toOptionalString(input.timestamp);
  const scanNonce = toOptionalString(input.scanNonce);
  if (!hid) throw new Error("HID is required.");
  if (!to) throw new Error("Scanned network id (to) is required.");
  if (!guestName) throw new Error("Guest name is required.");

  const eventId = toOptionalString(input.eventId);
  const guestId = toOptionalString(input.guestId);
  const co = toOptionalString(input.co);

  return {
    type: "PERMISSION",
    hid,
    ...(timestamp ? { tt: timestamp } : {}),
    to,
    msg: {
      guest_name: guestName,
      ...(eventId ? { event_id: eventId } : {}),
      ...(guestId ? { guest_id: guestId } : {}),
      ...(scanNonce ? { scan_nonce: scanNonce } : {}),
    },
    ...(co ? { co } : {}),
    ...(input.position ? { position: input.position } : {}),
  };
}
