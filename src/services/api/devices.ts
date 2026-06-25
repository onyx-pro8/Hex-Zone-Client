import { request } from "./client";

export type PushPlatform = "EXPO" | "FCM" | "APNS";

export type PushTokenPayload = {
  token: string;
  platform: PushPlatform;
};

export type DeviceRecord = {
  id: number | string;
  hid: string;
  name?: string;
  address?: string;
  latitude?: number | null;
  longitude?: number | null;
  propagate_enabled?: boolean;
  propagate_radius_km?: number;
  enable_notification?: boolean;
  alert_threshold_meters?: number;
  update_interval_seconds?: number;
  active?: boolean;
  status?: boolean;
  is_online?: boolean;
  owner_id?: number | string;
  h3_cell_id?: string;
  last_seen?: string;
  created_at?: string;
  updated_at?: string;
  owner?: {
    id: number | string;
    email?: string;
    first_name?: string;
    last_name?: string;
    role?: "administrator" | "user" | string;
    account_type?: string;
    active?: boolean;
  } | null;
};

export type UpsertDevicePayload = {
  hid: string;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  propagate_enabled?: boolean;
  propagate_radius_km?: number;
  enable_notification?: boolean;
  alert_threshold_meters?: number;
  update_interval_seconds?: number;
  active?: boolean;
  status?: boolean;
  is_online?: boolean;
};

export async function registerPushToken(payload: PushTokenPayload) {
  return request<{ success?: boolean }>({
    method: "POST",
    url: "/devices/push-token",
    data: payload,
  });
}

export async function getDevices() {
  return request<DeviceRecord[]>({
    method: "GET",
    url: "/devices/",
  });
}

export async function createDevice(payload: UpsertDevicePayload) {
  return request<DeviceRecord>({
    method: "POST",
    url: "/devices/",
    data: {
      address: payload.address ?? "Unknown",
      latitude: payload.latitude ?? 0,
      longitude: payload.longitude ?? 0,
      propagate_enabled: payload.propagate_enabled ?? true,
      propagate_radius_km: payload.propagate_radius_km ?? 2.5,
      enable_notification: payload.enable_notification ?? true,
      alert_threshold_meters: payload.alert_threshold_meters ?? 100,
      update_interval_seconds: payload.update_interval_seconds ?? 60,
      active: payload.active ?? true,
      status: payload.status ?? true,
      is_online: payload.is_online ?? true,
      hid: payload.hid,
      name: payload.name,
    },
  });
}

export async function updateDevice(
  deviceId: number | string,
  payload: Partial<UpsertDevicePayload>,
) {
  const status = payload.status ?? payload.is_online ?? true;
  const isOnline = payload.is_online ?? payload.status ?? true;
  return request<DeviceRecord>({
    method: "PATCH",
    url: `/devices/${deviceId}`,
    data: {
      ...payload,
      status,
      is_online: isOnline,
    },
  });
}

export async function sendDeviceHeartbeat(deviceId: number | string) {
  return request<{ success?: boolean }>({
    method: "POST",
    url: `/devices/${deviceId}/heartbeat`,
  });
}

export async function deleteDevice(deviceId: number | string) {
  return request<{ success?: boolean }>({
    method: "DELETE",
    url: `/devices/${deviceId}`,
  });
}
