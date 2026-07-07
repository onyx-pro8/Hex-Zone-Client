import type { MessageType } from "./messageTypes";
import { usesRegisteredAddressForType } from "./messageWorkflow";

export type MessagePosition = {
  latitude: number;
  longitude: number;
};

export const MESSAGE_POSITION_REQUIRED =
  "No location available. Allow browser location access, or set your address on your account so we can use it as a fallback.";

export const REGISTERED_ADDRESS_REQUIRED =
  "No registered address on your account. Set your home address in account settings — SENSOR and WELLNESS CHECK use that location, not live GPS.";

export type MessagePositionSource = "gps" | "profile";

export type ResolvedMessagePosition = {
  position: MessagePosition;
  source: MessagePositionSource;
};

/** Max time to wait for a fresh GPS fix before falling back. */
const SEND_GPS_TIMEOUT_MS = 7000;

/** Best-effort: keep server-side presence current for geo message delivery. */
export async function publishMemberLocation(position: MessagePosition): Promise<void> {
  try {
    const { updateLocation } = await import("../services/api/members");
    await updateLocation(position);
  } catch {
    /* non-blocking */
  }
}

function normalizeMapCenter(
  value:
    | { latitude?: unknown; longitude?: unknown }
    | null
    | undefined,
): MessagePosition | null {
  if (!value || typeof value !== "object") return null;
  const rawLat = Number(value.latitude);
  const rawLng = Number(value.longitude);
  if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng)) return null;

  if (Math.abs(rawLat) <= 90 && Math.abs(rawLng) <= 180) {
    return { latitude: rawLat, longitude: rawLng };
  }
  if (Math.abs(rawLng) <= 90 && Math.abs(rawLat) <= 180) {
    return { latitude: rawLng, longitude: rawLat };
  }
  return null;
}

async function tryReadGps(): Promise<MessagePosition | null> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    return null;
  }
  return new Promise<MessagePosition | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: SEND_GPS_TIMEOUT_MS, maximumAge: 30_000 },
    );
  });
}

/**
 * Resolves sender position for outbound messages.
 *
 * Priority:
 *   1. Live browser GPS (short timeout so Send does not hang).
 *   2. Profile `mapCenter` — geocoded registered home address from the account.
 */
export async function resolveMessagePropagationPosition(
  profileMapCenter?: MessagePosition | null,
): Promise<ResolvedMessagePosition | { error: string }> {
  const gps = await tryReadGps();
  if (gps) {
    void publishMemberLocation(gps);
    return { position: gps, source: "gps" };
  }

  const fromProfile = normalizeMapCenter(profileMapCenter ?? null);
  if (fromProfile) {
    void publishMemberLocation(fromProfile);
    return { position: fromProfile, source: "profile" };
  }

  return { error: MESSAGE_POSITION_REQUIRED };
}

/**
 * Type-aware position resolution for geo propagation.
 *
 * - SENSOR / WELLNESS CHECK → registered address only (profile mapCenter).
 * - PANIC, NS-PANIC, PRIVATE, PA, SERVICE, UNKNOWN → live GPS, then profile fallback.
 */
export async function resolveMessagePropagationPositionForType(
  messageType: MessageType,
  profileMapCenter?: MessagePosition | null,
): Promise<ResolvedMessagePosition | { error: string }> {
  if (usesRegisteredAddressForType(messageType)) {
    const fromProfile = normalizeMapCenter(profileMapCenter ?? null);
    if (fromProfile) {
      return { position: fromProfile, source: "profile" };
    }
    return { error: REGISTERED_ADDRESS_REQUIRED };
  }

  return resolveMessagePropagationPosition(profileMapCenter);
}

export function messagePositionSourceLabel(source: MessagePositionSource): string {
  return source === "gps" ? "live GPS" : "registered address";
}
