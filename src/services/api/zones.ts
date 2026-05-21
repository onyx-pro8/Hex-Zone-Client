import { request } from "./client";

export type ZoneType =
  | "polygon"
  | "circle"
  | "grid"
  | "dynamic"
  | "proximity"
  | "object"
  | "geofence"
  | "communal_id"
  | "government_local_code"
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

/**
 * Dynamic-zone live preview. The server scans active members of the caller's
 * zone, picks the tightest cluster of `target_user_count` nearest users whose
 * smallest enclosing circle fits within `[min_radius_meters, max_radius_meters]`,
 * and returns the resolved center + radius. No client-supplied center.
 */
export type DynamicZonePreviewPayload = {
  target_user_count: number;
  min_radius_meters: number;
  max_radius_meters: number;
  /** Include the caller's own location in the candidate population. Defaults to true. */
  include_self?: boolean;
};

export type DynamicZonePreviewResult = {
  infeasible: boolean;
  reason: string | null;
  /** Server-derived center for the resolved cluster (null when infeasible). */
  center: { latitude: number; longitude: number } | null;
  resolved_radius_meters: number | null;
  /** Smallest enclosing circle radius for the chosen cluster, before min/max clamp. */
  tight_radius_meters: number | null;
  matched_user_count: number;
  matched_owner_ids: number[];
  population_size: number;
  target_user_count: number;
  min_radius_meters: number;
  max_radius_meters: number;
};

export async function previewDynamicZone(payload: DynamicZonePreviewPayload) {
  return request<DynamicZonePreviewResult>({
    method: "POST",
    url: "/zones/dynamic/preview",
    data: payload,
  });
}
