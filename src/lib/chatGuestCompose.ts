/** CHAT compose recipient rules: pending → approved → rejected (each oldest→latest). */

export type ChatComposeGuestStatus = "PENDING" | "APPROVED" | "REJECTED" | "ARRIVED";

export type ChatComposeGuest = {
  id: string;
  name: string;
  status: ChatComposeGuestStatus;
  expectation?: "expected" | "unexpected";
  created_at?: string;
};

/** FIFO waiting statuses: true PENDING ahead of ARRIVED. */
function statusRank(status: ChatComposeGuestStatus): number {
  switch (status) {
    case "PENDING":
      return 0;
    case "ARRIVED":
      return 1;
    case "APPROVED":
      return 2;
    case "REJECTED":
      return 3;
    default:
      return 99;
  }
}

function createdAtMs(value: string | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

function compareChatComposeGuests(a: ChatComposeGuest, b: ChatComposeGuest): number {
  const byStatus = statusRank(a.status) - statusRank(b.status);
  if (byStatus !== 0) return byStatus;
  const byTime = createdAtMs(a.created_at) - createdAtMs(b.created_at);
  if (byTime !== 0) return byTime;
  return a.id.localeCompare(b.id);
}

/** Guests selectable in member CHAT compose (not Guest Management). */
export function filterChatComposeGuests<T extends ChatComposeGuest>(rows: T[]): T[] {
  return rows
    .filter(
      (g) =>
        g.status === "PENDING" ||
        g.status === "ARRIVED" ||
        g.status === "APPROVED" ||
        g.status === "REJECTED",
    )
    .sort(compareChatComposeGuests);
}

/** Prefer oldest PENDING guest; else oldest ARRIVED; else first in sorted list. */
export function defaultChatComposeGuestId(guests: ChatComposeGuest[]): string {
  const pending = guests.filter((g) => g.status === "PENDING");
  if (pending.length > 0) return pending[0]!.id;
  const arrived = guests.filter((g) => g.status === "ARRIVED");
  if (arrived.length > 0) return arrived[0]!.id;
  return guests[0]?.id ?? "";
}

export function isAdminGuestPeer(peer: {
  role?: string;
  can_receive_chat?: boolean;
}): boolean {
  const role = String(peer.role ?? "").trim().toLowerCase();
  if (!role) return true;
  return role.includes("admin");
}
