import { request } from "./client";
import type { GovernmentAddressMode } from "../../lib/governmentAddress";

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
}) {
  return request<ZoneReferenceValidateResult>({
    method: "POST",
    url: "/zones/generate-reference",
    data: payload ?? { zone_type: "communal_id" },
  });
}
