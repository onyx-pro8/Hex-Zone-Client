import {
  claimDeviceSession,
  createDevice,
  getDevices,
  sendDeviceHeartbeat,
  updateDevice,
  deleteDevice,
  type DeviceRecord,
} from "../services/api/devices";
import type { AuthUser } from "../services/api";
import {
  mainDevicePlaceChanged,
  resolveMainDevicePlace,
} from "./mainDeviceLocation";
import { parseServerDate } from "./serverDate";

export { parseServerDate } from "./serverDate";

/** Thrown when login succeeds but another device holds the active session. */
export class DeviceSessionConflictError extends Error {
  constructor(
    message = "This account is already active on another device.",
  ) {
    super(message);
    this.name = "DeviceSessionConflictError";
  }
}

export function isDeviceSessionConflictError(
  err: unknown,
): err is DeviceSessionConflictError {
  return (
    err instanceof DeviceSessionConflictError ||
    (err instanceof Error && err.name === "DeviceSessionConflictError")
  );
}

export function isDeviceSessionConflictMessage(message: string): boolean {
  return /already in use|sign out there first|already active on another device|change the device/i.test(
    message,
  );
}

export const DEVICE_PRESENCE_TIMEOUT_MS = 30 * 60 * 1000;

export const DEVICE_CHANGE_PROMPT_TITLE = "Change the device?";
export const DEVICE_CHANGE_PROMPT_MESSAGE =
  "This account is already active on another device. Use this device instead? The other device will be signed out and removed.";
export const DEVICE_CHANGE_DECLINED_MESSAGE =
  "Login cancelled. Sign out on the other device first, or choose to change the device when prompted.";
export const DEVICE_SIGNED_OUT_ELSEWHERE_MESSAGE =
  "You were signed out because this account is now active on another device.";

export const ACCOUNT_IN_USE_MESSAGE = DEVICE_CHANGE_PROMPT_MESSAGE;

export type DeviceSyncResult =
  | { status: "ok"; deviceId?: number | string }
  | { status: "account-in-use" }
  | { status: "error"; message: string };

const DEVICE_HID_KEY = "zoneweaver_device_hid";

function randomHidSuffix(len = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)] ?? "X";
  }
  return out;
}

export function getOrCreateDeviceHid(): string {
  const existing = localStorage.getItem(DEVICE_HID_KEY);
  if (existing) return existing;
  const next = `WEB-${randomHidSuffix()}`;
  localStorage.setItem(DEVICE_HID_KEY, next);
  return next;
}

function deviceLastSeenMs(device: DeviceRecord): number | null {
  const parsed = parseServerDate(
    device.last_seen ?? device.updated_at ?? device.created_at,
  );
  return parsed ? parsed.getTime() : null;
}

/** Phone (MOB-) and browser (WEB-) login clients — not smart-home hubs. */
export function isClientSessionHid(hid?: string | null): boolean {
  const upper = String(hid ?? "").trim().toUpperCase();
  return upper.startsWith("MOB-") || upper.startsWith("WEB-");
}

export function isSmartHomeHid(hid?: string | null): boolean {
  const upper = String(hid ?? "").trim().toUpperCase();
  return Boolean(upper) && !isClientSessionHid(upper);
}

/** Whether another phone/web device currently holds the account session. */
export function isDeviceSessionBlocking(device: DeviceRecord): boolean {
  if (!isClientSessionHid(device.hid)) return false;
  return device.is_online === true;
}

/** UI presence: online flag plus optional stale timeout for display. */
export function deriveDeviceOnline(device: DeviceRecord): boolean {
  if (device.is_online !== true) return false;
  const seen = deviceLastSeenMs(device);
  if (seen == null) return true;
  return Date.now() - seen <= DEVICE_PRESENCE_TIMEOUT_MS;
}

export function isAccountInUseError(message: string): boolean {
  return isDeviceSessionConflictMessage(message);
}

/** True while this hardware id still holds the active account session. */
export async function isLocalDeviceSessionActive(
  ownerId: string,
): Promise<boolean> {
  const localHid = getOrCreateDeviceHid();
  const devices = await getDevices();
  if (devices.error) return true;
  const id = String(ownerId ?? "").trim();
  const mine = (devices.data ?? []).filter(
    (d) => !id || String(d.owner_id ?? "") === id,
  );
  const local = mine.find(
    (d) => String(d.hid).toUpperCase() === localHid.toUpperCase(),
  );
  if (!local) return false;
  return local.is_online === true;
}

function ownerDevicesForUser(
  list: DeviceRecord[],
  ownerId: string,
): DeviceRecord[] {
  if (!ownerId) return list;
  return list.filter((d) => String(d.owner_id ?? "") === ownerId);
}

function mapCreateError(error: string): DeviceSyncResult {
  if (isAccountInUseError(error)) {
    return { status: "account-in-use" };
  }
  if (/allows at most \d+ device/i.test(error)) {
    return { status: "account-in-use" };
  }
  return { status: "error", message: error };
}

export async function setCurrentDeviceOffline(): Promise<void> {
  const hid = localStorage.getItem(DEVICE_HID_KEY);
  if (!hid) return;
  const devices = await getDevices();
  const existing = (devices.data ?? []).find(
    (d) => String(d.hid).toUpperCase() === hid.toUpperCase(),
  );
  if (!existing?.id) return;
  await updateDevice(existing.id, { is_online: false });
}

export async function signOutDevice(deviceId: number | string): Promise<void> {
  await updateDevice(deviceId, { is_online: false });
}

export async function removeDevice(deviceId: number | string): Promise<void> {
  await deleteDevice(deviceId);
}

function sessionCenter(user: AuthUser | null): { latitude: number; longitude: number } | null {
  const center = user?.mapCenter ?? user?.map_center;
  if (!center) return null;
  if (!Number.isFinite(center.latitude) || !Number.isFinite(center.longitude)) return null;
  return { latitude: center.latitude, longitude: center.longitude };
}

/** Write GPS, or the Settings address, onto this browser. Hubs keep their own address. */
export async function refreshSessionDevicePlace(
  device: DeviceRecord,
  user?: AuthUser | null,
): Promise<void> {
  if (!device.id || !isClientSessionHid(device.hid)) return;
  try {
    const place = await resolveMainDevicePlace(device.address, sessionCenter(user ?? null));
    if (!place || !mainDevicePlaceChanged(device, place)) return;
    await updateDevice(device.id, {
      address: place.address,
      ...(place.latitude != null && place.longitude != null
        ? { latitude: place.latitude, longitude: place.longitude }
        : {}),
    });
  } catch {
    /* presence stays online even if the place lookup fails */
  }
}

export async function syncCurrentDevice(
  user: AuthUser | null,
  options?: { forceTakeover?: boolean; resumeSession?: boolean },
): Promise<DeviceSyncResult> {
  if (!user) return { status: "ok" };
  try {
    const hid = getOrCreateDeviceHid();
    const displayName = user.name?.trim() || user.email?.trim() || "Web Device";
    const ownerId = String(user.id ?? "").trim();

    if (options?.forceTakeover) {
      const claim = await claimDeviceSession(hid);
      if (claim.error) {
        return { status: "error", message: claim.error };
      }
    }

    const devicesResult = await getDevices();
    if (devicesResult.error) {
      return { status: "error", message: devicesResult.error };
    }
    const list = devicesResult.data ?? [];
    const mine = ownerDevicesForUser(list, ownerId);

    const byLocalHid = mine.find(
      (d) => String(d.hid).toUpperCase() === hid.toUpperCase(),
    );
    if (byLocalHid?.id != null) {
      if (!options?.forceTakeover && !options?.resumeSession) {
        const otherOnline = mine.filter(
          (d) =>
            String(d.hid).toUpperCase() !== hid.toUpperCase() &&
            isDeviceSessionBlocking(d),
        );
        if (otherOnline.length > 0) {
          return { status: "account-in-use" };
        }
      }
      await updateDevice(byLocalHid.id, { is_online: true });
      await sendDeviceHeartbeat(byLocalHid.id);
      await refreshSessionDevicePlace(byLocalHid, user);
      return { status: "ok", deviceId: byLocalHid.id };
    }

    if (!options?.forceTakeover) {
      const otherOnline = mine.filter((d) => isDeviceSessionBlocking(d));
      if (otherOnline.length > 0) {
        return { status: "account-in-use" };
      }
    }

    const place = isClientSessionHid(hid)
      ? await resolveMainDevicePlace("Unknown", sessionCenter(user)).catch(() => null)
      : null;
    const created = await createDevice({
      hid,
      name: `${displayName} (Web)`,
      enable_notification: true,
      propagate_enabled: true,
      is_online: true,
      ...(place
        ? {
            address: place.address,
            ...(place.latitude != null && place.longitude != null
              ? { latitude: place.latitude, longitude: place.longitude }
              : {}),
          }
        : {}),
    });
    if (created.error) {
      return mapCreateError(created.error);
    }
    if (created.data?.id != null) {
      await updateDevice(created.data.id, { is_online: true });
      await sendDeviceHeartbeat(created.data.id);
      return { status: "ok", deviceId: created.data.id };
    }
    return { status: "ok" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return mapCreateError(message);
  }
}

export function describeDeviceSyncFailure(
  result: Extract<DeviceSyncResult, { status: "account-in-use" | "error" }>,
): string {
  if (result.status === "account-in-use") return ACCOUNT_IN_USE_MESSAGE;
  return result.message;
}
