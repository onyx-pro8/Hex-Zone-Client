import { request } from "./client";

export type ZoneType =
  | "polygon"
  | "circle"
  | "grid"
  | "dynamic"
  | "proximity"
  | "object"
  | "geofence"
  | "custom_1"
  | "custom_2";

export type Zone = {
  id: string;
  name: string;
  type: ZoneType;
  geometry: Record<string, unknown>;
  config: Record<string, unknown>;
};

export async function getZones() {
  return request<Zone[]>({ method: "GET", url: "/zones" });
}

export async function createZone(payload: Omit<Zone, "id">) {
  return request<Zone>({ method: "POST", url: "/zones", data: payload });
}

export async function updateZone(id: string, payload: Partial<Omit<Zone, "id">>) {
  return request<Zone>({ method: "PUT", url: `/zones/${id}`, data: payload });
}

export async function deleteZone(id: string) {
  return request<{ success: boolean }>({ method: "DELETE", url: `/zones/${id}` });
}
