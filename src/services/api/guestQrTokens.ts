import {
  absoluteUrlFromPathWithQuery,
  buildGuestAccessUrlWithToken,
  ensureGuestAccessUrlIncludesZidWhenGtOnly,
} from "../../lib/guestAccessUrls";
import type { PrimaryGuestQrTokenResponse } from "./accessPermissions";
import { apiClient, request } from "./client";

export function guestNetworkQrPath(): string {
  const raw = String(import.meta.env.VITE_GUEST_NETWORK_QR_PATH ?? "").trim();
  return raw.length > 0 ? raw : "/api/access/qr-tokens/network";
}

export function guestNetworkQrRotatePath(): string {
  const raw = String(import.meta.env.VITE_GUEST_NETWORK_QR_ROTATE_PATH ?? "").trim();
  return raw.length > 0 ? raw : "/api/access/qr-tokens/network/rotate";
}

export async function fetchNetworkAccessQrToken(zoneId: string) {
  const res = await request<unknown>({
    method: "GET",
    url: guestNetworkQrPath(),
    params: { zone_id: zoneId.trim() },
  });
  return {
    ...res,
    data: normalizePrimaryQrToken(res.data),
  };
}

export async function rotateNetworkAccessQrToken(zoneId: string) {
  const res = await request<unknown>({
    method: "POST",
    url: guestNetworkQrRotatePath(),
    params: { zone_id: zoneId.trim() },
    data: {},
  });
  return {
    ...res,
    data: normalizePrimaryQrToken(res.data),
  };
}

export function guestQrTokensBasePath(): string {
  const raw = String(import.meta.env.VITE_GUEST_QR_TOKENS_BASE_PATH ?? "").trim();
  return raw.length > 0 ? raw : "/api/access/qr-tokens";
}

export function guestPrimaryQrPath(): string {
  const raw = String(import.meta.env.VITE_GUEST_PRIMARY_QR_PATH ?? "").trim();
  return raw.length > 0 ? raw : "/api/access/qr-tokens/primary";
}

export function guestPrimaryQrRotatePath(): string {
  const raw = String(import.meta.env.VITE_GUEST_PRIMARY_QR_ROTATE_PATH ?? "").trim();
  return raw.length > 0 ? raw : "/api/access/qr-tokens/primary/rotate";
}

function normalizePrimaryQrToken(raw: unknown): PrimaryGuestQrTokenResponse | null {
  const body =
    raw && typeof raw === "object" && "status" in raw && "data" in raw
      ? (raw as { data: unknown }).data
      : raw;
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const row = body as Record<string, unknown>;
  const zone_id = String(row.zone_id ?? "").trim();
  if (!zone_id) return null;
  return {
    zone_id,
    url: row.url == null ? null : String(row.url),
    path_with_query: row.path_with_query == null ? null : String(row.path_with_query),
    token_suffix: row.token_suffix == null ? null : String(row.token_suffix),
  };
}

export async function fetchPrimaryGuestQrToken(zoneId: string) {
  const res = await request<unknown>({
    method: "GET",
    url: guestPrimaryQrPath(),
    params: { zone_id: zoneId.trim() },
  });
  return {
    ...res,
    data: normalizePrimaryQrToken(res.data),
  };
}

export async function rotatePrimaryGuestQrToken(zoneId: string) {
  const res = await request<unknown>({
    method: "POST",
    url: guestPrimaryQrRotatePath(),
    params: { zone_id: zoneId.trim() },
    data: {},
  });
  return {
    ...res,
    data: normalizePrimaryQrToken(res.data),
  };
}

export type CreateGuestQrTokenPayload = {
  zone_id: string;
  /** Send either this or `expires_at`, not both. */
  expires_in_hours?: number;
  expires_at?: string;
  event_id?: string;
  label?: string;
  /** Omit for unlimited uses. */
  max_uses?: number;
};

export type GuestQrTokenCreated = {
  id: number;
  token: string;
  /** May be omitted; use `resolveGuestQrCreatedDisplayUrl`. */
  url?: string | null;
  path_with_query?: string;
  zone_id: string;
  event_id?: string | null;
  label?: string | null;
  expires_at?: string | null;
  revoked_at?: string | null;
  max_uses?: number | null;
  use_count?: number;
  created_at?: string;
  last_used_at?: string | null;
  created_by_owner_id?: number;
  token_suffix?: string;
};

/** Safe display / QR value: `url`, else `path_with_query` + origin, else `/access?gt=` + token (+`zid` when known). */
export function resolveGuestQrCreatedDisplayUrl(
  created: GuestQrTokenCreated,
  appOrigin: string,
): string {
  const zone = String(created.zone_id ?? "").trim();
  const patch = (u: string) =>
    zone ? ensureGuestAccessUrlIncludesZidWhenGtOnly(u, zone) : u;

  const direct = String(created.url ?? "").trim();
  if (direct) return patch(direct);
  const pq = String(created.path_with_query ?? "").trim();
  if (pq) return patch(absoluteUrlFromPathWithQuery(appOrigin, pq));
  const tok = String(created.token ?? "").trim();
  if (tok) {
    try {
      return buildGuestAccessUrlWithToken(appOrigin, tok, zone || undefined);
    } catch {
      return "";
    }
  }
  return "";
}

/** List row: no full secret token. */
export type GuestQrTokenListItem = {
  id: number;
  zone_id: string;
  event_id?: string | null;
  label?: string | null;
  expires_at?: string | null;
  revoked_at?: string | null;
  max_uses?: number | null;
  use_count?: number;
  created_at?: string;
  last_used_at?: string | null;
  created_by_owner_id?: number;
  token_suffix?: string;
};

export async function createGuestQrToken(payload: CreateGuestQrTokenPayload) {
  return request<GuestQrTokenCreated>({
    method: "POST",
    url: guestQrTokensBasePath(),
    data: payload,
  });
}

export async function listGuestQrTokens(params: {
  zone_id: string;
  include_revoked?: boolean;
  limit?: number;
}) {
  return request<GuestQrTokenListItem[]>({
    method: "GET",
    url: guestQrTokensBasePath(),
    params: {
      zone_id: params.zone_id,
      include_revoked: params.include_revoked ?? false,
      limit: params.limit ?? 50,
    },
  });
}

export async function revokeGuestQrToken(tokenId: number, zoneId: string) {
  return request<GuestQrTokenListItem>({
    method: "POST",
    url: `${guestQrTokensBasePath()}/${tokenId}/revoke`,
    params: { zone_id: zoneId.trim() },
  });
}

export async function getGuestQrTokenLink(tokenId: number, zoneId: string) {
  return request<{
    id: number;
    url?: string | null;
    path_with_query?: string;
  }>({
    method: "GET",
    url: `${guestQrTokensBasePath()}/${tokenId}/link`,
    params: { zone_id: zoneId.trim() },
  });
}

export async function fetchGuestQrTokenPngBlob(
  tokenId: number,
  zoneId: string,
): Promise<{ blob: Blob | null; error: string | null }> {
  try {
    const res = await apiClient.get<Blob>(
      `${guestQrTokensBasePath()}/${tokenId}/qr.png`,
      {
        params: { zone_id: zoneId.trim() },
        responseType: "blob",
      },
    );
    const blob = res.data;
    if (blob instanceof Blob && blob.size > 0) {
      return { blob, error: null };
    }
    return { blob: null, error: "Empty image response" };
  } catch (e: unknown) {
    const msg =
      e && typeof e === "object" && "message" in e
        ? String((e as { message: string }).message)
        : "Failed to download QR image";
    return { blob: null, error: msg };
  }
}
