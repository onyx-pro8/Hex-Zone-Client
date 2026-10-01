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
  /** True while a network-access request is still pending and chat is admin-only. */
  pending_approval?: boolean;
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
  try {
    window.dispatchEvent(new Event("hexzone-guest-meta"));
  } catch {
    /* ignore */
  }
}

/** Store the pre-approval network chat JWT and open the existing guest Messages screen. */
export function persistPendingNetworkGuestChat(opts: {
  access_token: string;
  guest_id: string;
  zone_id: string;
  display_name: string;
}): void {
  const zoneId = opts.zone_id.trim();
  persistGuestAccessToken(opts.access_token);
  persistGuestSessionMeta({
    guest_id: opts.guest_id.trim(),
    zone_id: zoneId,
    display_name: opts.display_name.trim() || "Guest",
    zone_ids: zoneId ? [zoneId] : [],
    allowed_message_types: ["CHAT"],
    pending_approval: true,
  });
}

export function clearGuestAccessSession(): void {
  try {
    sessionStorage.removeItem(GUEST_ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(GUEST_SESSION_META_KEY);
  } catch {
    /* ignore */
  }
}
