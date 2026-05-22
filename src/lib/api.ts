import axios from "axios";

const baseURL =
  import.meta.env.VITE_API_BASE_URL || "https://hex-zone-server.onrender.com";

const api = axios.create({
  baseURL,
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use((config) => {
  const token =
    localStorage.getItem("zoneweaver_token") ||
    sessionStorage.getItem("zoneweaver_token");
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/** Read a human-readable message from Hex Zone API error bodies (envelope or FastAPI). */
export function parseApiErrorBody(data: unknown): string {
  if (typeof data === "string" && data.trim().length > 0) {
    return data.trim();
  }
  if (!data || typeof data !== "object") return "";
  const row = data as Record<string, unknown>;
  const nested =
    row.error && typeof row.error === "object" && row.error !== null
      ? String((row.error as { message?: string }).message ?? "").trim()
      : "";
  const message =
    typeof row.message === "string" ? row.message.trim() : "";
  const detail =
    typeof row.detail === "string" ? row.detail.trim() : "";
  return message || nested || detail;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  account_type: "private" | "exclusive";
  phone?: string;
  zone_id?: string;
  address?: string;
}

export async function login(payload: LoginPayload) {
  return api.post("/owners/login", payload).then((res) => res.data);
}

export async function register(payload: RegisterPayload) {
  return api.post("/owners/register", payload).then((res) => res.data);
}

export interface GenerateQrTokenPayload {
  zone_id: string;
}

export interface GenerateQrTokenResponse {
  token: string;
  zone_id?: string;
  expires_at?: string;
}

export async function generateQrRegistrationToken(
  payload: GenerateQrTokenPayload,
) {
  return api
    .post<GenerateQrTokenResponse>("/utils/qr/generate", payload)
    .then((res) => res.data);
}

export interface QrJoinPayload {
  token: string;
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  address: string;
  phone?: string;
}

export async function joinWithQrToken(payload: QrJoinPayload) {
  return api.post("/utils/qr/join", payload).then((res) => res.data);
}

export async function fetchMe() {
  return api.get("/owners/me").then((res) => res.data);
}

/** PATCH /owners/{owner_id} — partial owner update (e.g. active). */
export interface OwnerUpdatePayload {
  first_name?: string | null;
  last_name?: string | null;
  active?: boolean | null;
}

export async function updateOwner(
  ownerId: number | string,
  payload: OwnerUpdatePayload,
) {
  return api.patch(`/owners/${ownerId}`, payload).then((res) => res.data);
}

/** Owners returned from GET /owners/ (registered accounts in the DB). */
export interface OwnerListItem {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  account_type?: string;
  active?: boolean;
}

export async function fetchOwners(params?: { skip?: number; limit?: number }) {
  return api
    .get<OwnerListItem[]>("/owners/", { params })
    .then((res) => res.data);
}

/** POST /devices/ — create device (full payload). */
export interface CreateDevicePayload {
  hid: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  propagate_enabled: boolean;
  propagate_radius_km: number;
  enable_notification: boolean;
  alert_threshold_meters: number;
  update_interval_seconds: number;
}

/** PATCH /devices/{device_id} — update device settings. */
export interface UpdateDevicePayload {
  name?: string;
  address?: string;
  propagate_enabled?: boolean;
  propagate_radius_km?: number;
  enable_notification?: boolean;
  alert_threshold_meters?: number;
  update_interval_seconds?: number;
}

/** Typical device response from list/detail endpoints. */
export interface DeviceResponse {
  id: number;
  hid: string;
  device_id?: string;
  name: string;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  h3_cell_id?: string | null;
  owner_id?: number;
  owner?: {
    id: number | string;
    email?: string;
    first_name?: string;
    last_name?: string;
    role?: "administrator" | "user" | string;
    account_type?: string;
    active?: boolean;
  } | null;
  propagate_enabled?: boolean;
  propagate_radius_km?: number | null;
  active: boolean;
  is_online?: boolean;
  last_seen?: string | null;
  enable_notification?: boolean;
  alert_threshold_meters?: number | null;
  update_interval_seconds?: number | null;
  created_at?: string;
  updated_at?: string | null;
}

/** Cached device fields in localStorage (offline / fallback). */
export type CachedDeviceSettings = UpdateDevicePayload & {
  name?: string;
};

export async function fetchDevices() {
  return api.get<DeviceResponse[]>("/devices/").then((res) => res.data);
}

export async function fetchDevice(deviceId: number | string) {
  return api
    .get<DeviceResponse>(`/devices/${deviceId}`)
    .then((res) => res.data);
}

export async function createDevice(payload: CreateDevicePayload) {
  return api.post<DeviceResponse>("/devices/", payload).then((res) => res.data);
}

export async function updateDevice(
  deviceId: number | string,
  payload: UpdateDevicePayload,
) {
  return api
    .patch<DeviceResponse>(`/devices/${deviceId}`, payload)
    .then((res) => res.data);
}

export async function sendDeviceHeartbeat(deviceId: number | string) {
  return api.post(`/devices/${deviceId}/heartbeat`).then((res) => res.data);
}

export async function fetchZones() {
  return api.get("/zones/").then((res) => res.data);
}

export async function fetchZonesByZoneId(zoneId: number | string) {
  return api
    .get("/zones/", { params: { zone_id: zoneId } })
    .then((res) => res.data);
}

export async function createZone(payload: any) {
  return api.post("/zones", payload).then((res) => res.data);
}

export async function updateZone(id: number | string, payload: any) {
  return api.patch(`/zones/${id}`, payload).then((res) => res.data);
}

export async function convertH3(
  latitude: number,
  longitude: number,
  resolution = 13,
) {
  return api
    .post("/utils/h3/convert", { latitude, longitude, resolution })
    .then((res) => res.data);
}

export async function updateDeviceLocation(
  id: number | string,
  payload: { latitude: number; longitude: number; address?: string },
) {
  return api.post(`/devices/${id}/location`, payload).then((res) => res.data);
}

export async function fetchDeviceByHid(hid: string) {
  return api.get(`/devices/network/hid/${hid}`).then((res) => res.data);
}

export default api;
