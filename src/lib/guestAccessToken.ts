import { resetGuestSession401RedirectGuard } from "./guestSessionAuthRedirect";

/** Guest JWT for `/api/guest/*` — never mix with `zoneweaver_token` (member). */

export const GUEST_ACCESS_TOKEN_KEY = "zoneweaver_guest_access_token";

const GUEST_SESSION_META_KEY = "zoneweaver_guest_session_meta";

export type GuestSessionMeta = {
  guest_id: string;
  zone_id: string;
  display_name: string;
  zone_ids: string[];
  allowed_message_types: string[];
  network_geo_messaging?: boolean;
};

function readMeta(): GuestSessionMeta | null {
  try {
    const raw = sessionStorage.getItem(GUEST_SESSION_META_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as GuestSessionMeta;
    if (!p || typeof p.guest_id !== "string") return null;
    return p;
  } catch {
    return null;
  }
}

export function getGuestAccessToken(): string | null {
  try {
    const t = sessionStorage.getItem(GUEST_ACCESS_TOKEN_KEY);
    return t && t.trim() ? t.trim() : null;
  } catch {
    return null;
  }
}

export function getGuestSessionMeta(): GuestSessionMeta | null {
  return readMeta();
}

export function persistGuestAccessToken(token: string): void {
  sessionStorage.setItem(GUEST_ACCESS_TOKEN_KEY, token.trim());
  resetGuestSession401RedirectGuard();
}

export function persistGuestSessionMeta(meta: GuestSessionMeta): void {
  sessionStorage.setItem(GUEST_SESSION_META_KEY, JSON.stringify(meta));
}

export function clearGuestAccessSession(): void {
  try {
    sessionStorage.removeItem(GUEST_ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(GUEST_SESSION_META_KEY);
  } catch {
    /* ignore */
  }
}
