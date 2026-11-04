import { request, type ApiResult } from "./client";

export type GuestPassStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "REVOKED";

export type GuestPass = {
  id: string;
  zone_id: string;
  event_id: string;
  guest_name: string | null;
  notes: string | null;
  status: GuestPassStatus;
  requested_by: number;
  requested_by_name?: string;
  reviewed_by: number | null;
  used_by_guest_id: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
  is_expired?: boolean;
};

export type CreateGuestPassBody = {
  zone_id: string;
  event_id: string;
  guest_name?: string;
  notes?: string;
  expires_at: string;
};

const EMPTY_LIST: ApiResult<GuestPass[]> = { data: [], error: null, loading: false };
const MISSING_PARAM: ApiResult<GuestPass> = { data: null, error: "Missing required parameter.", loading: false };

export async function createGuestPass(
  body: CreateGuestPassBody,
): Promise<ApiResult<GuestPass>> {
  if (!body.zone_id.trim() || !body.event_id.trim()) return MISSING_PARAM;
  return request<GuestPass>({
    method: "POST",
    url: "/api/access/guest-passes",
    data: body,
  });
}

export async function listGuestPasses(
  zoneId: string,
  statusFilter?: string,
): Promise<ApiResult<GuestPass[]>> {
  const zid = zoneId.trim();
  if (!zid) return EMPTY_LIST;
  const params: Record<string, string> = { zone_id: zid };
  if (statusFilter && statusFilter !== "ALL") {
    params.status = statusFilter;
  }
  const result = await request<unknown>({
    method: "GET",
    url: "/api/access/guest-passes",
    params,
  });
  if (result.error) return { data: [], error: result.error, loading: false };

  const raw = result.data;
  let list: GuestPass[];
  if (Array.isArray(raw)) {
    list = raw as GuestPass[];
  } else if (
    raw &&
    typeof raw === "object" &&
    Array.isArray((raw as Record<string, unknown>).items)
  ) {
    list = (raw as { items: GuestPass[] }).items;
  } else {
    list = [];
  }
  return { data: list, error: null, loading: false };
}

export async function acceptGuestPass(
  passId: string,
  zoneId: string,
): Promise<ApiResult<GuestPass>> {
  const pid = passId.trim();
  const zid = zoneId.trim();
  if (!pid || !zid) return MISSING_PARAM;
  return request<GuestPass>({
    method: "POST",
    url: `/api/access/guest-passes/${encodeURIComponent(pid)}/accept`,
    data: { zone_id: zid },
  });
}

export async function rejectGuestPass(
  passId: string,
  zoneId: string,
): Promise<ApiResult<GuestPass>> {
  const pid = passId.trim();
  const zid = zoneId.trim();
  if (!pid || !zid) return MISSING_PARAM;
  return request<GuestPass>({
    method: "POST",
    url: `/api/access/guest-passes/${encodeURIComponent(pid)}/reject`,
    data: { zone_id: zid },
  });
}

export async function revokeGuestPass(
  passId: string,
  zoneId: string,
): Promise<ApiResult<GuestPass>> {
  const pid = passId.trim();
  const zid = zoneId.trim();
  if (!pid || !zid) return MISSING_PARAM;
  return request<GuestPass>({
    method: "POST",
    url: `/api/access/guest-passes/${encodeURIComponent(pid)}/revoke`,
    data: { zone_id: zid },
  });
}

export async function deleteGuestPass(
  passId: string,
): Promise<ApiResult<{ id: string; zone_id: string; event_id: string; deleted: boolean }>> {
  const pid = passId.trim();
  if (!pid) {
    return { data: null, error: "Missing required parameter.", loading: false };
  }
  return request({
    method: "DELETE",
    url: `/api/access/guest-passes/${encodeURIComponent(pid)}`,
  });
}

export async function clearExpiredGuestPasses(
  zoneId: string,
): Promise<ApiResult<{ deleted_ids: string[]; deleted_count: number }>> {
  const zid = zoneId.trim();
  if (!zid) {
    return { data: null, error: "Missing required parameter.", loading: false };
  }
  return request({
    method: "POST",
    url: "/api/access/guest-passes/clear-expired",
    data: { zone_id: zid },
  });
}
