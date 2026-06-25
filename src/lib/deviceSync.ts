import {
  createDevice,
  getDevices,
  sendDeviceHeartbeat,
  updateDevice,
  deleteDevice,
  type DeviceRecord,
} from "../services/api/devices";
import type { AuthUser, AccountType } from "../services/api";

export const ACCOUNT_IN_USE_MESSAGE =
  "This account is already in use on another device. Sign out there first.";

export type DeviceSyncResult =
  | { status: "ok"; deviceId?: number | string }
  | { status: "account-in-use" }
  | { status: "error"; message: string };

const DEVICE_HID_KEY = "zoneweaver_device_hid";

function getAccountDeviceLimit(accountType: AccountType): number {
  if (accountType === "PRIVATE") return 1;
  if (accountType === "PRIVATE_PLUS") return 10;
  if (accountType === "EXCLUSIVE" || accountType === "ENHANCED") return 1;
  return Number.POSITIVE_INFINITY;
}

function normalizeAccountType(
  primary?: AccountType,
  legacy?: string | null,
): AccountType {
  if (primary) return primary;
  const normalizedLegacy = String(legacy ?? "").toUpperCase();
  if (normalizedLegacy === "PRIVATE_PLUS") return "PRIVATE_PLUS";
  if (normalizedLegacy === "EXCLUSIVE") return "EXCLUSIVE";
  if (normalizedLegacy === "ENHANCED") return "ENHANCED";
  if (normalizedLegacy === "ENHANCED_PLUS") return "ENHANCED_PLUS";
  return "PRIVATE";
}

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

export function deriveDeviceOnline(device: DeviceRecord): boolean {
  if (typeof device.is_online === "boolean") return device.is_online;
  if (typeof device.status === "boolean") return device.status;
  return device.active !== false;
}

function deviceRecency(device: DeviceRecord): number {
  const raw = device.last_seen ?? device.updated_at ?? device.created_at;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function ownerDevicesForUser(
  list: DeviceRecord[],
  ownerId: string,
): DeviceRecord[] {
  if (!ownerId) return list;
  return list.filter((d) => String(d.owner_id ?? "") === ownerId);
}

async function evictOfflineDevices(
  devices: DeviceRecord[],
  limit: number,
): Promise<void> {
  if (!Number.isFinite(limit)) return;
  let remaining = [...devices];
  while (remaining.length >= limit) {
    const offline = remaining.filter((d) => !deriveDeviceOnline(d));
    if (offline.length === 0) break;
    const oldest = offline.sort(
      (a, b) => deviceRecency(a) - deviceRecency(b),
    )[0];
    if (!oldest?.id) break;
    await deleteDevice(oldest.id);
    remaining = remaining.filter((d) => d.id !== oldest.id);
  }
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

export async function syncCurrentDevice(
  user: AuthUser | null,
): Promise<DeviceSyncResult> {
  if (!user) return { status: "ok" };
  try {
    const hid = getOrCreateDeviceHid();
    const displayName = user.name?.trim() || user.email?.trim() || "Web Device";
    const ownerId = String(user.id ?? "").trim();
    const accountType = normalizeAccountType(
      user.accountType,
      user.account_type,
    );
    const limit = getAccountDeviceLimit(accountType);

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
      const otherOnline = mine.filter(
        (d) =>
          String(d.hid).toUpperCase() !== hid.toUpperCase() &&
          deriveDeviceOnline(d),
      );
      if (otherOnline.length > 0) {
        return { status: "account-in-use" };
      }
      await updateDevice(byLocalHid.id, { is_online: true });
      await sendDeviceHeartbeat(byLocalHid.id);
      return { status: "ok", deviceId: byLocalHid.id };
    }

    const otherOnline = mine.filter((d) => deriveDeviceOnline(d));
    if (otherOnline.length > 0) {
      return { status: "account-in-use" };
    }

    await evictOfflineDevices(mine, limit);

    const created = await createDevice({
      hid,
      name: `${displayName} (Web)`,
      enable_notification: true,
      propagate_enabled: true,
      is_online: true,
    });
    if (created.error) {
      if (/already in use|sign out there first/i.test(created.error)) {
        return { status: "account-in-use" };
      }
      return { status: "error", message: created.error };
    }
    if (created.data?.id != null) {
      await updateDevice(created.data.id, { is_online: true });
      await sendDeviceHeartbeat(created.data.id);
      return { status: "ok", deviceId: created.data.id };
    }
    return { status: "ok" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/already in use|sign out there first/i.test(message)) {
      return { status: "account-in-use" };
    }
    return { status: "error", message };
  }
}

export function describeDeviceSyncFailure(
  result: Extract<DeviceSyncResult, { status: "account-in-use" | "error" }>,
): string {
  if (result.status === "account-in-use") return ACCOUNT_IN_USE_MESSAGE;
  return result.message;
}
