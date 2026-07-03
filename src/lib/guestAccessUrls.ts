export type PublicGuestAccessParams = {
  zoneId: string;
  eventId?: string;
  /** Optional signed token for future server-verified QR flows. */
  sig?: string;
};

/**
 * Builds `https://…/access?gt=…` when you only have the raw guest token.
 */
export function buildGuestAccessUrlWithToken(
  origin: string,
  guestToken: string,
  zoneId?: string,
): string {
  const t = String(guestToken ?? "").trim();
  if (!t) throw new Error("Guest token is required.");
  const url = new URL("/access", origin.replace(/\/$/, ""));
  url.searchParams.set("gt", t);
  const z = String(zoneId ?? "").trim();
  if (z) url.searchParams.set("zid", z);
  return url.href;
}

/** When hosting issues `/access?gt=…` without `zid`, guests cannot poll session; add `zid` if known. */
export function ensureGuestAccessUrlIncludesZidWhenGtOnly(
  href: string,
  zoneId: string,
): string {
  const z = String(zoneId ?? "").trim();
  if (!z) return href;
  try {
    const u = new URL(href);
    if (!u.searchParams.get("gt")) return href;
    if (u.searchParams.get("zid")) return href;
    u.searchParams.set("zid", z);
    return u.href;
  } catch {
    return href;
  }
}

/** Use when the API returns `path_with_query` (e.g. `/access?gt=…`) and the app runs on `origin`. */
export function absoluteUrlFromPathWithQuery(
  origin: string,
  pathWithQuery: string,
): string {
  const raw = String(pathWithQuery ?? "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = origin.replace(/\/$/, "");
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  return `${base}${path}`;
}

/**
 * Deep link guests scan: `/access?zid=...&eid=...` (no login).
 * Prefer server-issued `gt` tokens when available.
 * Network access: `/access?nid=...` or `/access?gt=...&nid=...`.
 */
export function buildPublicGuestAccessUrl(
  origin: string,
  params: PublicGuestAccessParams,
): string {
  const z = String(params.zoneId ?? "").trim();
  if (!z) {
    throw new Error("Network id is required to build a guest access URL.");
  }
  const url = new URL("/access", origin.replace(/\/$/, ""));
  url.searchParams.set("zid", z);
  const eid = String(params.eventId ?? "").trim();
  if (eid) url.searchParams.set("eid", eid);
  const sig = String(params.sig ?? "").trim();
  if (sig) url.searchParams.set("sig", sig);
  return url.href;
}

/** Static network-id QR: `/access?nid=NETWORK_ID`. */
export function buildNetworkAccessUrl(origin: string, networkId: string): string {
  const nid = String(networkId ?? "").trim();
  if (!nid) throw new Error("Network id is required.");
  const url = new URL("/access", origin.replace(/\/$/, ""));
  url.searchParams.set("nid", nid);
  return url.href;
}

/** Issued network access token: `/access?gt=…&nid=…`. */
export function buildNetworkAccessUrlWithToken(
  origin: string,
  guestToken: string,
  networkId: string,
): string {
  const t = String(guestToken ?? "").trim();
  const nid = String(networkId ?? "").trim();
  if (!t) throw new Error("Guest token is required.");
  if (!nid) throw new Error("Network id is required.");
  const url = new URL("/access", origin.replace(/\/$/, ""));
  url.searchParams.set("gt", t);
  url.searchParams.set("nid", nid);
  return url.href;
}

export function parseNetworkIdFromAccessUrl(href: string): string | null {
  try {
    const u = new URL(href);
    const nid = u.searchParams.get("nid") ?? u.searchParams.get("network_id");
    return nid?.trim() || null;
  } catch {
    return null;
  }
}
