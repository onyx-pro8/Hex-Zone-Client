import type { Message } from "../services/api/messages";

/**
 * Read a broadcast name embedded in an outgoing message payload. Senders attach
 * `broadcast_name` to `msg`/`raw_payload` so receivers can display a friendly
 * identity instead of a numeric owner id.
 */
function pickDisplayName(
  o: Record<string, unknown> | null,
  keys: string[],
): string | null {
  if (!o) return null;
  for (const key of keys) {
    const v = o[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export function readMessageBroadcastName(
  message: Pick<Message, "raw_payload">,
): string | null {
  const rp = message.raw_payload;
  if (!rp || typeof rp !== "object") return null;
  const keys = ["broadcast_name", "broadcastName", "guest_name", "guestName"];
  const top = pickDisplayName(rp as Record<string, unknown>, keys);
  if (top) return top;
  const msg = (rp as Record<string, unknown>).msg;
  if (msg && typeof msg === "object" && !Array.isArray(msg)) {
    return pickDisplayName(msg as Record<string, unknown>, keys);
  }
  return null;
}

export type BroadcastLabelOptions = {
  selfOwnerId?: number | null;
  selfBroadcastName?: string | null;
  resolveOwnerName?: (ownerId: number) => string | null | undefined;
};

/** Best-effort display name (sender's broadcast name) for an inbox row. */
export function messageBroadcastLabel(
  message: Message,
  options: BroadcastLabelOptions = {},
): string {
  if (
    options.selfOwnerId != null &&
    message.sender_id === options.selfOwnerId
  ) {
    return "ME";
  }
  const embedded = readMessageBroadcastName(message);
  if (embedded) return embedded;
  if (message.guest_sender_id != null) return "Guest";
  const resolved = options.resolveOwnerName?.(message.sender_id);
  if (resolved && resolved.trim()) return resolved.trim();
  return `Member ${message.sender_id}`;
}
