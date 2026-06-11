import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, Loader2, Trash2 } from "lucide-react";
import {
  createMessageFeatureBlock,
  deleteMessageFeatureBlock,
  listMessageFeatureBlocks,
  type MessageFeatureBlock,
  type MessageFeatureType,
} from "../../services/api/messageFeature";
import { getMembers, type Member } from "../../services/api/members";
import {
  blockedMemberIdsFromRules,
  blockedMessageTypesFromRules,
} from "../../lib/messageBlocks";
import { MESSAGE_TYPES, toMessageTypeLabel, type MessageType } from "../../lib/messageTypes";

const BLOCKABLE_TYPES = MESSAGE_TYPES.filter((t) => t !== "PERMISSION") as MessageFeatureType[];

function describeBlock(row: MessageFeatureBlock, membersById: Map<number, Member>): string {
  const typeLabel = row.blocked_message_type
    ? toMessageTypeLabel(row.blocked_message_type as MessageType)
    : null;
  const member = row.blocked_owner_id != null ? membersById.get(row.blocked_owner_id) : null;
  const memberLabel = member
    ? `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim() || member.email || `#${row.blocked_owner_id}`
    : row.blocked_owner_id != null
      ? `Member #${row.blocked_owner_id}`
      : null;

  if (memberLabel && typeLabel) return `Block ${typeLabel} from ${memberLabel}`;
  if (typeLabel) return `Block all ${typeLabel} messages`;
  if (memberLabel) return `Block all messages from ${memberLabel}`;
  return "Block rule";
}

export function MessageBlocksPanel({
  currentOwnerId,
  onBlocksChanged,
}: {
  currentOwnerId: number;
  /** Called after a block is added or removed so the inbox can refresh immediately. */
  onBlocksChanged?: () => void;
}) {
  const [blocks, setBlocks] = useState<MessageFeatureBlock[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [blockType, setBlockType] = useState<MessageFeatureType>("SENSOR");
  const [blockMemberId, setBlockMemberId] = useState("");

  const membersById = useMemo(() => {
    const map = new Map<number, Member>();
    for (const m of members) {
      if (m.id != null) map.set(Number(m.id), m);
    }
    return map;
  }, [members]);

  const blockedMemberIds = useMemo(() => blockedMemberIdsFromRules(blocks), [blocks]);
  const blockedTypes = useMemo(() => blockedMessageTypesFromRules(blocks), [blocks]);

  const selectableMembers = useMemo(
    () =>
      members.filter((m) => {
        const id = Number(m.id);
        return (
          Number.isFinite(id) &&
          id > 0 &&
          id !== currentOwnerId &&
          !blockedMemberIds.has(id)
        );
      }),
    [members, currentOwnerId, blockedMemberIds],
  );

  const selectableTypes = useMemo(
    () => BLOCKABLE_TYPES.filter((t) => !blockedTypes.has(t)),
    [blockedTypes],
  );

  useEffect(() => {
    if (blockMemberId && blockedMemberIds.has(Number(blockMemberId))) {
      setBlockMemberId("");
    }
  }, [blockMemberId, blockedMemberIds]);

  useEffect(() => {
    if (blockedTypes.has(blockType) && selectableTypes.length > 0) {
      setBlockType(selectableTypes[0]);
    }
  }, [blockType, blockedTypes, selectableTypes]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [blocksResult, membersResult] = await Promise.all([
      listMessageFeatureBlocks(),
      getMembers(),
    ]);
    if (blocksResult.error) setError(blocksResult.error);
    else setBlocks(blocksResult.data ?? []);
    if (!membersResult.error) setMembers(membersResult.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleBlockType() {
    setBusy(true);
    setStatus(null);
    setError(null);
    const result = await createMessageFeatureBlock({ blocked_message_type: blockType });
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setStatus(`Blocked all ${toMessageTypeLabel(blockType as MessageType)} messages.`);
    await refresh();
    onBlocksChanged?.();
  }

  async function handleBlockMember() {
    const id = Number(blockMemberId);
    if (!Number.isFinite(id) || id <= 0) {
      setError("Select a member to block.");
      return;
    }
    setBusy(true);
    setStatus(null);
    setError(null);
    const result = await createMessageFeatureBlock({ blocked_owner_id: id });
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setStatus("Blocked all messages from that member.");
    setBlockMemberId("");
    await refresh();
    onBlocksChanged?.();
  }

  async function handleRemove(blockId: string) {
    setBusy(true);
    setError(null);
    const result = await deleteMessageFeatureBlock(blockId);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    await refresh();
    onBlocksChanged?.();
  }

  return (
    <section className="space-y-4 rounded-2xl border border-[#DCE6F2] bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Ban className="h-4 w-4 text-[#2F80ED]" aria-hidden />
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-[#8694AC]">
          Message blocks
        </p>
      </div>
      <p className="text-sm text-[#566784]">
        Block a message type from everyone in your zone, or block all messages from a specific member.
      </p>

      {error ? (
        <p className="rounded-lg border border-[#E23B4E]/30 bg-[#FCE7EA] px-3 py-2 text-sm text-[#E23B4E]">
          {error}
        </p>
      ) : null}
      {status ? <p className="text-sm text-[#2FA24A]">{status}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[#8694AC]">
            Block message type
          </label>
          <div className="flex flex-wrap gap-2">
            <select
              value={blockType}
              onChange={(e) => setBlockType(e.target.value as MessageFeatureType)}
              className="min-w-[160px] flex-1 rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm text-[#0F2C5C] outline-none focus:border-[#2F80ED]"
            >
              {selectableTypes.length === 0 ? (
                <option value="">All types blocked</option>
              ) : (
                selectableTypes.map((t) => (
                  <option key={t} value={t}>
                    {toMessageTypeLabel(t as MessageType)}
                  </option>
                ))
              )}
            </select>
            <button
              type="button"
              disabled={busy || selectableTypes.length === 0}
              onClick={() => void handleBlockType()}
              className="rounded-lg bg-[#2F80ED] px-4 py-2 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[#8694AC]">
            Block member
          </label>
          <div className="flex flex-wrap gap-2">
            <select
              value={blockMemberId}
              onChange={(e) => setBlockMemberId(e.target.value)}
              disabled={selectableMembers.length === 0}
              className="min-w-[160px] flex-1 rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm text-[#0F2C5C] outline-none focus:border-[#2F80ED] disabled:opacity-50"
            >
              <option value="">
                {selectableMembers.length === 0 ? "All members blocked" : "Select member…"}
              </option>
              {selectableMembers.map((m) => (
                <option key={m.id} value={String(m.id)}>
                  {`${m.first_name ?? ""} ${m.last_name ?? ""}`.trim() || m.email || `Member ${m.id}`}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || !blockMemberId}
              onClick={() => void handleBlockMember()}
              className="rounded-lg border border-[#C2D2E6] px-4 py-2 text-sm font-semibold text-[#0F2C5C] transition hover:border-[#2F80ED] disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#8694AC]">Active blocks</p>
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-[#566784]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : blocks.length === 0 ? (
          <p className="text-sm text-[#8694AC]">No block rules yet.</p>
        ) : (
          <ul className="space-y-2">
            {blocks.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2"
              >
                <span className="text-sm text-[#0F2C5C]">{describeBlock(row, membersById)}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleRemove(String(row.id))}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[#566784] transition hover:bg-[#FCE7EA] hover:text-[#E23B4E]"
                  title="Remove block"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}