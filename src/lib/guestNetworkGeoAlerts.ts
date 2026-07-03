import { getMessageWorkflow, isEmergencyMessageType } from "./messageWorkflow";
import type { MessageFeatureType } from "../services/api/messageFeature";

/** Geo types network-access guests may send (server: NETWORK_GUEST_GEO_MESSAGE_TYPES minus CHAT). */
export const GUEST_NETWORK_GEO_TYPES: MessageFeatureType[] = [
  "PANIC",
  "NS_PANIC",
  "UNKNOWN",
  "PRIVATE",
  "PA",
  "SERVICE",
];

function normType(value: string): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/-/g, "_");
}

export function guestHasNetworkGeoMessaging(input: {
  network_geo_messaging?: boolean;
  allowed_message_types?: string[];
}): boolean {
  if (input.network_geo_messaging) return true;
  const allowed = input.allowed_message_types ?? [];
  return allowed.some((t) =>
    GUEST_NETWORK_GEO_TYPES.some((g) => normType(g) === normType(t)),
  );
}

export function guestAllowedNetworkGeoTypes(
  allowed_message_types?: string[],
): MessageFeatureType[] {
  const set = new Set((allowed_message_types ?? []).map(normType));
  return GUEST_NETWORK_GEO_TYPES.filter((t) => set.has(normType(t)));
}

export function guestGeoAlertLabel(type: MessageFeatureType): string {
  if (type === "NS_PANIC") return "NS PANIC";
  return type.replace(/_/g, " ");
}

export function guestGeoAlertConfirmPrompt(type: MessageFeatureType): string | null {
  const workflow = getMessageWorkflow(type as Parameters<typeof getMessageWorkflow>[0]);
  if (!workflow?.confirmBeforeSend && !isEmergencyMessageType(type as Parameters<typeof isEmergencyMessageType>[0])) {
    return null;
  }
  return `Send ${guestGeoAlertLabel(type)} to network members using your current location?`;
}

export async function readGuestDevicePosition(): Promise<{
  latitude: number;
  longitude: number;
}> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location is not available in this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        }),
      () => reject(new Error("Could not read GPS. Allow location access and try again.")),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  });
}
