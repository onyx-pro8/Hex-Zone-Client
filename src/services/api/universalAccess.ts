import { request } from "./client";

export type UniversalAccessRequestRow = {
  id: number;
  member_id: number;
  member_name: string;
  email: string;
  address: string;
  country: string;
  region: string;
  city: string;
  place: string;
  note: string;
  status: "pending" | "approved" | "rejected" | string;
  reject_reason: string;
  network_id: string;
  network_admin_name: string;
  created_at: string | null;
  code: string | null;
  credential_id: number | null;
  enabled: boolean | null;
  photo_id?: string;
};

export async function getUniversalAccessRequest(id: number) {
  return request<UniversalAccessRequestRow>({
    method: "GET",
    url: `/universal-access/requests/${id}`,
  });
}

export async function listUniversalAccessRequests() {
  return request<UniversalAccessRequestRow[]>({
    method: "GET",
    url: "/universal-access/requests",
  });
}

export async function createUniversalAccessRequest(payload: {
  member_id: number;
  address: string;
  photo_id: string;
  country: string;
  region: string;
  city: string;
  note?: string;
}) {
  return request<UniversalAccessRequestRow>({
    method: "POST",
    url: "/universal-access/requests",
    data: payload,
  });
}

export async function approveUniversalAccessRequest(id: number) {
  return request<UniversalAccessRequestRow>({
    method: "POST",
    url: `/universal-access/requests/${id}/approve`,
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
