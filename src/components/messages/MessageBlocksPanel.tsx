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
    <section className="space-y-4 rounded-2xl border border-slate-800/80 bg-slate-950/80 p-5">
      <div className="flex items-center gap-2">
        <Ban className="h-4 w-4 text-[#00E5D1]" aria-hidden />
        <p className="text-xs font-medium uppercase tracking-[0.25em] text-slate-500">
          Message blocks
        </p>
      </div>
      <p className="text-sm text-slate-400">
        Block a message type from everyone in your zone, or block all messages from a specific member.
      </p>

      {error ? (
        <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}
      {status ? <p className="text-sm text-[#00E5D1]">{status}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
          <label className="block text-xs font-medium uppercase tracking-wider text-slate-500">
            Block message type
          </label>
          <div className="flex flex-wrap gap-2">
            <select
              value={blockType}
              onChange={(e) => setBlockType(e.target.value as MessageFeatureType)}
              className="min-w-[160px] flex-1 rounded-md border border-slate-700 bg-slate-950/90 px-3 py-2 text-sm text-slate-100"
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
              className="rounded-md bg-[#00E5D1] px-4 py-2 text-sm font-bold text-[#0B0E11] disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-medium uppercase tracking-wider text-slate-500">
            Block member
          </label>
          <div className="flex flex-wrap gap-2">
            <select
              value={blockMemberId}
              onChange={(e) => setBlockMemberId(e.target.value)}
              disabled={selectableMembers.length === 0}
              className="min-w-[160px] flex-1 rounded-md border border-slate-700 bg-slate-950/90 px-3 py-2 text-sm text-slate-100 disabled:opacity-50"
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
              className="rounded-md border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-100 hover:border-[#00E5D1]/50 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Active blocks</p>
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : blocks.length === 0 ? (
          <p className="text-sm text-slate-500">No block rules yet.</p>
        ) : (
          <ul className="space-y-2">
            {blocks.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-800/80 bg-slate-900/50 px-3 py-2"
              >
                <span className="text-sm text-slate-200">{describeBlock(row, membersById)}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleRemove(String(row.id))}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-red-300"
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