export type GuestCallState = "idle" | "queued" | "ringing" | "connected";

export type GuestCallRole = "guest" | "admin";

export type GuestCallSession = {
  callId: string;
  zoneId: string;
  guestId: string;
  guestName: string;
  adminOwnerId: number;
  callerRole: GuestCallRole;
  fullscreen: boolean;
  accessRejectEscalation: boolean;
  state: GuestCallState;
  /** ISO timestamp when accepted; drives the live timer. */
  acceptedAt: string | null;
  /** True when this device initiated the invite. */
  isCaller: boolean;
  adminAvatarUrl: string | null;
  guestAvatarUrl: string | null;
  /** 1-based place while state is queued. */
  queuePosition?: number | null;
  /** When the server started ringing. */
  createdAt?: string | null;
  /** Unanswered ring limit. Connected calls are not limited by this. */
  ringTimeoutSeconds?: number | null;
};

export type GuestCallSocketEvent =
  | "CALL_INVITE"
  | "CALL_QUEUED"
  | "CALL_ACCEPT"
  | "CALL_REJECT"
  | "CALL_CANCEL"
  | "CALL_TIMEOUT"
  | "CALL_END"
  | "CALL_SIGNAL";

const CALL_TYPES = new Set<string>([
  "CALL_INVITE",
  "CALL_QUEUED",
  "CALL_ACCEPT",
  "CALL_REJECT",
  "CALL_CANCEL",
  "CALL_TIMEOUT",
  "CALL_END",
  "CALL_SIGNAL",
]);

export function parseGuestCallSocketMessage(
  raw: string | null | undefined,
): { type: GuestCallSocketEvent; data: Record<string, unknown> } | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const type = String(parsed.type ?? "").trim().toUpperCase();
    if (!CALL_TYPES.has(type)) return null;
    const data =
      parsed.data && typeof parsed.data === "object"
        ? (parsed.data as Record<string, unknown>)
        : parsed;
    return { type: type as GuestCallSocketEvent, data };
  } catch {
    return null;
  }
}

export function sessionFromCallPayload(
  data: Record<string, unknown>,
  options: { localRole: GuestCallRole },
): GuestCallSession | null {
  const { localRole } = options;
  const callId = String(data.call_id ?? "").trim();
  const guestId = String(data.guest_id ?? "").trim();
  const zoneId = String(data.zone_id ?? "").trim();
  if (!callId || !guestId || !zoneId) return null;
  const callerRoleRaw = String(data.caller_role ?? "").toLowerCase();
  const callerRole: GuestCallRole =
    callerRoleRaw === "guest" ? "guest" : "admin";
  const stateRaw = String(data.state ?? "ringing").toLowerCase();
  const state: GuestCallState =
    stateRaw === "connected" ? "connected" : stateRaw === "queued" ? "queued" : "ringing";
  const queuePosition = Number(data.queue_position);
  const adminOwnerId = Number(data.admin_owner_id);
  return {
    callId,
    zoneId,
    guestId,
    guestName: String(data.guest_name ?? "Guest").trim() || "Guest",
    adminOwnerId: Number.isFinite(adminOwnerId) ? adminOwnerId : 0,
    callerRole,
    fullscreen: Boolean(data.fullscreen),
    accessRejectEscalation: Boolean(data.access_reject_escalation),
    state,
    acceptedAt:
      typeof data.accepted_at === "string" && data.accepted_at.trim()
        ? data.accepted_at.trim()
        : null,
    isCaller: callerRole === localRole,
    adminAvatarUrl: readAvatar(data.admin_avatar_url),
    guestAvatarUrl: readAvatar(data.guest_avatar_url),
    queuePosition: Number.isFinite(queuePosition) ? queuePosition : null,
    createdAt:
      typeof data.created_at === "string" && data.created_at.trim()
        ? data.created_at.trim()
        : null,
    ringTimeoutSeconds: Number.isFinite(Number(data.ring_timeout_seconds))
      ? Number(data.ring_timeout_seconds)
      : null,
  };
}

function readAvatar(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw || null;
}

/** True when the visible call card should stay put (no hide/show flash). */
export function sameVisibleCall(
  prev: GuestCallSession | null,
  next: GuestCallSession,
): boolean {
  if (!prev) return false;
  return (
    prev.callId === next.callId &&
    prev.state === next.state &&
    prev.isCaller === next.isCaller &&
    prev.fullscreen === next.fullscreen &&
    prev.acceptedAt === next.acceptedAt &&
    prev.guestName === next.guestName &&
    prev.adminAvatarUrl === next.adminAvatarUrl &&
    prev.guestAvatarUrl === next.guestAvatarUrl &&
    (prev.queuePosition ?? null) === (next.queuePosition ?? null)
  );
}

export function formatCallDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function zoneIdsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
