import { request } from "./client";

export type UniversalAccessZone = {
  id: number;
  name: string;
  zone_type: string;
  is_primary?: boolean;
  communal?: boolean;
  network_id?: string;
  owner_id?: number;
};

export type UniversalAccessInvitee = {
  id: number;
  name: string;
  email: string;
  network_id?: string;
};

export type UniversalAccessViewerActions = {
  can_approve: boolean;
  can_reject: boolean;
  can_edit_docs: boolean;
  can_remove: boolean;
  can_view_detail: boolean;
};

export type UniversalAccessRequestRow = {
  id: number;
  request_kind: "invite" | "place_access" | string;
  key_type?: "private" | "public" | string;
  member_id: number;
  member_name: string;
  first_name?: string;
  last_name?: string;
  email: string;
  address?: string;
  country?: string;
  region?: string;
  city?: string;
  place: string;
  zone_ids: number[];
  zones: UniversalAccessZone[];
  note: string;
  status: "pending" | "approved" | "rejected" | string;
  reject_reason: string;
  network_id: string;
  network_admin_name: string;
  network_admin_email?: string;
  created_at: string | null;
  code: string | null;
  credential_id: number | null;
  enabled: boolean | null;
  photo_id?: string;
  business_document?: string;
  viewer_role?: string;
  viewer_actions?: UniversalAccessViewerActions;
};

export type UniversalAccessTargetNetwork = {
  network_id: string;
  admin_id: number;
  admin_email: string;
  admin_name: string;
  zones: UniversalAccessZone[];
};

export type UniversalAccessKeyRow = {
  credential_id: number;
  code: string;
  key_type: string;
  zone_ids: number[];
  zones: UniversalAccessZone[];
  enabled?: boolean;
  created_at?: string | null;
  activated_at?: string | null;
};

export async function listShareableUniversalZones() {
  return request<UniversalAccessZone[]>({
    method: "GET",
    url: "/universal-access/shareable-zones",
  });
}

export async function searchUniversalAccessInvitees(query: string) {
  return request<UniversalAccessInvitee[]>({
    method: "GET",
    url: "/universal-access/invitees",
    params: { q: query },
  });
}

export async function searchUniversalAccessTargets(query: string) {
  return request<UniversalAccessTargetNetwork[]>({
    method: "GET",
    url: "/universal-access/targets",
    params: { q: query },
  });
}

export async function getUniversalAccessTarget(networkId: string) {
  return request<UniversalAccessTargetNetwork>({
    method: "GET",
    url: `/universal-access/targets/${encodeURIComponent(networkId)}`,
  });
}

export async function listUniversalAccessRequests() {
  return request<UniversalAccessRequestRow[]>({
    method: "GET",
    url: "/universal-access/requests",
  });
}

export async function getUniversalAccessRequest(id: number) {
  return request<UniversalAccessRequestRow>({
    method: "GET",
    url: `/universal-access/requests/${id}`,
  });
}

export async function createInviteUniversalAccessRequest(payload: {
  key_type: "private" | "public";
  invitee_email?: string;
  zone_ids: number[];
  note?: string;
}) {
  return request<UniversalAccessRequestRow>({
    method: "POST",
    url: "/universal-access/requests/invite",
    data: payload,
  });
}

export async function createPlaceAccessUniversalRequest(payload: {
  network_id: string;
  zone_ids: number[];
  photo_id: string;
  business_document: string;
  note?: string;
}) {
  return request<UniversalAccessRequestRow>({
    method: "POST",
    url: "/universal-access/requests/place-access",
    data: payload,
  });
}

export async function updateUniversalAccessDocs(
  id: number,
  payload: { photo_id: string; business_document: string },
) {
  return request<UniversalAccessRequestRow>({
    method: "PATCH",
    url: `/universal-access/requests/${id}/docs`,
    data: payload,
  });
}

export async function deleteUniversalAccessRequest(id: number) {
  return request<{ ok: boolean; id: number }>({
    method: "DELETE",
    url: `/universal-access/requests/${id}`,
  });
}

export async function approveUniversalAccessRequest(id: number, zoneIds?: number[]) {
  return request<UniversalAccessRequestRow>({
    method: "POST",
    url: `/universal-access/requests/${id}/approve`,
    data: { zone_ids: zoneIds ?? [] },
  });
}

export async function rejectUniversalAccessRequest(id: number, reason: string) {
  return request<UniversalAccessRequestRow>({
    method: "POST",
    url: `/universal-access/requests/${id}/reject`,
    data: { reason },
  });
}

export async function setUniversalAccessEnabled(credentialId: number, enabled: boolean) {
  return request<UniversalAccessRequestRow>({
    method: "POST",
    url: `/universal-access/credentials/${credentialId}/enabled`,
    data: { enabled },
  });
}

export async function listPrivateUniversalAccessKeys() {
  return request<UniversalAccessKeyRow[]>({
    method: "GET",
    url: "/universal-access/keys/private",
  });
}

export async function searchPublicUniversalAccessKeys(query: string) {
  return request<UniversalAccessKeyRow[]>({
    method: "GET",
    url: "/universal-access/keys/public",
    params: { q: query },
  });
}

export async function listActivatedUniversalAccessKeys() {
  return request<UniversalAccessKeyRow[]>({
    method: "GET",
    url: "/universal-access/keys/activated",
  });
}

export async function activatePublicUniversalAccessKey(code: string) {
  return request<UniversalAccessKeyRow>({
    method: "POST",
    url: "/universal-access/keys/activate",
    data: { code },
  });
}

export async function deactivatePublicUniversalAccessKey(credentialId: number) {
  return request<UniversalAccessKeyRow>({
    method: "DELETE",
    url: `/universal-access/keys/activated/${credentialId}`,
  });
}
