import { getAppSettings } from "./appSettings";
import { formatPhotonLabel } from "./addressSearch";
import type { DeviceRecord } from "../services/api/devices";

export type MainDevicePlace = {
  address: string;
  latitude?: number;
  longitude?: number;
};

function clean(value?: string | null): string {
  return (value ?? "").trim();
}

export function isPlaceholderAddress(value?: string | null): boolean {
  const text = clean(value).toLowerCase();
  return !text || text === "unknown" || text === "unknown location";
}

function coordsClose(a?: number | null, b?: number | null): boolean {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) < 0.0008;
}

function readBrowserPosition(): Promise<{ latitude: number; longitude: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    const timer = window.setTimeout(() => resolve(null), 5000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        window.clearTimeout(timer);
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
      },
      () => {
        window.clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 120_000 },
    );
  });
}

async function reverseGeocode(latitude: number, longitude: number): Promise<string> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 4000);
  try {
    const url = `https://photon.komoot.io/reverse?lat=${latitude}&lon=${longitude}&lang=en`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return "";
    const data = (await res.json()) as {
      features?: Array<{ properties?: Parameters<typeof formatPhotonLabel>[0] }>;
    };
    const label = formatPhotonLabel(data.features?.[0]?.properties ?? {});
    return isPlaceholderAddress(label) ? "" : label;
  } catch {
    return "";
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Place for the signed-in browser. Live GPS wins. The account address in
 * Settings is used only when GPS is unavailable and the browser has no place yet.
 */
export async function resolveMainDevicePlace(
  currentAddress?: string | null,
  fallbackCenter?: { latitude: number; longitude: number } | null,
): Promise<MainDevicePlace | null> {
  const gps = await readBrowserPosition();
  if (gps) {
    const label =
      (await reverseGeocode(gps.latitude, gps.longitude)) ||
      clean(getAppSettings().address);
    if (!label) return null;
    return { address: label, latitude: gps.latitude, longitude: gps.longitude };
  }

  if (!isPlaceholderAddress(currentAddress)) return null;
  const address = clean(getAppSettings().address);
  if (!address) return null;
  return {
    address,
    ...(fallbackCenter
      ? { latitude: fallbackCenter.latitude, longitude: fallbackCenter.longitude }
      : {}),
  };
}

export function mainDevicePlaceChanged(
  device: Pick<DeviceRecord, "address" | "latitude" | "longitude">,
  place: MainDevicePlace,
): boolean {
  if (clean(device.address) !== place.address) return true;
  if (place.latitude == null || place.longitude == null) return false;
  return (
    !coordsClose(device.latitude, place.latitude) ||
    !coordsClose(device.longitude, place.longitude)
  );
}
