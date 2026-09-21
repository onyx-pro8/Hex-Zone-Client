import { request } from "./client";
import type { GovernmentAddressMode } from "../../lib/governmentAddress";

export type CommunalZoneSummary = {
  id: number;
  zone_id: string;
  name: string;
  type: string;
  owner_id: number;
  owner_name?: string | null;
  communal_id?: string | null;
  is_public?: boolean;
};

export type ZoneReferenceValidateResult = {
  valid: boolean;
  zone_type: string;
  reference_id: string;
  display_name?: string | null;
  geometry: Record<string, unknown>;
  config: Record<string, unknown>;
  h3_cells: string[];
  source?: string | null;
  message?: string | null;
  exists?: boolean | null;
  zones?: CommunalZoneSummary[];
};

export type ZoneReferenceValidatePayload =
  | {
      zone_type: "communal_id";
      reference_id: string;
    }
  | {
      zone_type: "government_local_code";
      reference_id?: string;
      address_mode?: GovernmentAddressMode;
      postal_code?: string;
      city?: string;
      country?: string;
      street?: string;
      street_number?: string;
    };

export async function validateZoneReference(
  payload: ZoneReferenceValidatePayload,
) {
  return request<ZoneReferenceValidateResult>({
    method: "POST",
    url: "/zones/validate-reference",
    data: payload,
  });
}

export async function generateZoneReference(payload?: {
  zone_type?: "communal_id";
  reference_id?: string;
  persist?: boolean;
}) {
  return request<ZoneReferenceValidateResult>({
    method: "POST",
    url: "/zones/generate-reference",
    data: {
      zone_type: payload?.zone_type ?? "communal_id",
      ...(payload?.reference_id
        ? { reference_id: payload.reference_id }
        : {}),
      persist: payload?.persist ?? true,
    },
  });
}

export type PublicZoneRow = {
  id: number;
  zone_id: string;
  owner_id: number;
  creator_id?: number | null;
  owner_name?: string | null;
  name: string;
  type: string;
  geometry: Record<string, unknown>;
  config: Record<string, unknown>;
  is_primary?: boolean;
};

export async function listPublicZones(params?: {
  skip?: number;
  limit?: number;
}) {
  return request<PublicZoneRow[]>({
    method: "GET",
    url: "/zones/public",
    params: {
      skip: params?.skip ?? 0,
      limit: params?.limit ?? 200,
    },
  });
}

export type CommunalIdRow = {
  reference_id: string;
  creator_id?: number | null;
  creator_name?: string | null;
  network_id: string;
  zone_count: number;
  created_at?: string | null;
};

export async function listCommunalIds() {
  return request<CommunalIdRow[]>({
    method: "GET",
    url: "/zones/communal-ids",
  });
}

/** Zones tagged with a Communal ID (often other networks) — map overlay only. */
export async function listZonesForCommunalId(referenceId: string) {
  const id = referenceId.trim();
  return request<
    Array<{
      id: number | string;
      zone_id?: string;
      name?: string;
      type?: string;
      zone_type?: string;
      owner_id?: number | string;
      creator_id?: number | string;
      owner_name?: string | null;
      geometry?: Record<string, unknown>;
      config?: Record<string, unknown>;
      h3_cells?: string[];
      geo_fence_polygon?: unknown;
      is_primary?: boolean;
      shared_via_communal?: boolean;
    }>
  >({
    method: "GET",
    url: `/zones/communal-ids/${encodeURIComponent(id)}/zones`,
  });
}

export async function assignCommunalId(payload: {
  communal_id: string;
  zone_ids: number[];
  is_public?: boolean;
}) {
  return request<{
    communal_id: string;
    updated: PublicZoneRow[];
    message: string;
  }>({
    method: "POST",
    url: "/zones/assign-communal",
    data: payload,
  });
}
