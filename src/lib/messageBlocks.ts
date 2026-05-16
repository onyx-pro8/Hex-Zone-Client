import type { Message } from "../services/api/messages";
import { GUEST_LOGICAL_SENDER_ID } from "../services/api/messages";
import type { MessageFeatureBlock } from "../services/api/messageFeature";

function coerceOwnerId(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

/** Member-only block rows (block all types from that owner). */
export function blockedMemberIdsFromRules(blocks: MessageFeatureBlock[]): Set<number> {
  const ids = new Set<number>();
  for (const row of blocks) {
    const memberId = coerceOwnerId(row.blocked_owner_id);
    if (memberId == null) continue;
    if (row.blocked_message_type) continue;
    ids.add(memberId);
  }
  return ids;
}

/** Type-only block rows (block that type from all senders). */
export function blockedMessageTypesFromRules(blocks: MessageFeatureBlock[]): Set<string> {
  const types = new Set<string>();
  for (const row of blocks) {
    if (!row.blocked_message_type) continue;
    if (row.blocked_owner_id != null) continue;
    types.add(String(row.blocked_message_type).toUpperCase());
  }
  return types;
}

/**
 * Same semantics as the server: any rule row whose member and type dimensions match hides the message.
 */
export function isMessageHiddenByBlocks(
  message: Pick<Message, "sender_id" | "type" | "guest_sender_id">,
  blocks: MessageFeatureBlock[],
): boolean {
  if (blocks.length === 0) return false;

  const senderId =
    message.guest_sender_id != null || message.sender_id === GUEST_LOGICAL_SENDER_ID
      ? null
      : coerceOwnerId(message.sender_id);
  const msgType = String(message.type ?? "").toUpperCase();

  for (const row of blocks) {
    const blockedMember = coerceOwnerId(row.blocked_owner_id);
    const blockedType = row.blocked_message_type
      ? String(row.blocked_message_type).toUpperCase()
      : null;

    const memberMatch = blockedMember == null || (senderId != null && blockedMember === senderId);
    const typeMatch = blockedType == null || blockedType === msgType;
    if (memberMatch && typeMatch) return true;
  }
  return false;
}

export function filterMessagesForBlocks<T extends Pick<Message, "sender_id" | "type" | "guest_sender_id">>(
  messages: T[],
  blocks: MessageFeatureBlock[],
): T[] {
  if (blocks.length === 0) return messages;
  return messages.filter((m) => !isMessageHiddenByBlocks(m, blocks));
}
