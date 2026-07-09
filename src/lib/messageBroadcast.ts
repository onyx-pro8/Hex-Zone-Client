import type { Message } from "../services/api/messages";

/**
 * Read a broadcast name embedded in an outgoing message payload. Senders attach
 * `broadcast_name` to `msg`/`raw_payload` so receivers can display a friendly
 * identity instead of a numeric owner id.
 */
export function readMessageBroadcastName(
  message: Pick<Message, "raw_payload">,
): string | null {
  const rp = message.raw_payload;
  if (!rp || typeof rp !== "object") return null;
  const pick = (o: Record<string, unknown> | null): string | null => {
    if (!o) return null;
    const v = o.broadcast_name ?? o.broadcastName;
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const top = pick(rp as Record<string, unknown>);
  if (top) return top;
  const msg = (rp as Record<string, unknown>).msg;
  if (msg && typeof msg === "object" && !Array.isArray(msg)) {
    return pick(msg as Record<string, unknown>);
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
  const embedded = readMessageBroadcastName(message);
  if (embedded) return embedded;
  if (message.guest_sender_id != null) return "Guest";
  if (
    options.selfOwnerId != null &&
    message.sender_id === options.selfOwnerId &&
    options.selfBroadcastName &&
    options.selfBroadcastName.trim()
  ) {
    return options.selfBroadcastName.trim();
  }
  const resolved = options.resolveOwnerName?.(message.sender_id);
  if (resolved && resolved.trim()) return resolved.trim();
  return `Member ${message.sender_id}`;
}
