import { useEffect, useMemo, useState } from "react";
import { Smartphone } from "lucide-react";
import { MessageList } from "../components/messages/MessageList";
import { MessageDetail } from "../components/messages/MessageDetail";
import { MessageBlocksPanel } from "../components/messages/MessageBlocksPanel";
import { useMessageFeed } from "../hooks/useMessageFeed";
import { sendMessage, type MessageVisibility } from "../services/api/messages";
import { getOwners, type OwnerListItem } from "../services/api/auth";
import { getMembers, type Member } from "../services/api/members";
import { getZones } from "../services/api/zones";
import { useAuth } from "../hooks/useAuth";
import {
  getMessageTypeCategory,
  getMessageScopeForType,
  groupMessageTypesForUI,
  isAccessGuestChannelType,
  isPrivateMessageType,
  toMessageTypeLabel,
  type MessageCategory,
  type MessageType,
} from "../lib/messageTypes";
import type { GuestRequestRow } from "../lib/guestRealtime";
import { listGuestRequestsForZone } from "../services/api/accessPermissions";

export default function Messages() {
  const { user } = useAuth();
  const userZoneId = user?.zoneId ?? user?.zone_id;
  const ownerId = Number(user?.id);
  const [zoneFilter, setZoneFilter] = useState("all");
  const [scopeFilter, setScopeFilter] = useState<"all" | MessageVisibility>("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | MessageCategory>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | MessageType>("all");
  const [dateFilter, setDateFilter] = useState("");
  const [search, setSearch] = useState("");
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);

  const [composeType, setComposeType] = useState<MessageType>("SERVICE");
  const [composeReceiverId, setComposeReceiverId] = useState("");
  const [composeText, setComposeText] = useState("");
  const [composeStatus, setComposeStatus] = useState("");
  const [dbZoneIds, setDbZoneIds] = useState<string[]>([]);
  const [zonesLoading, setZonesLoading] = useState(false);
  const [owners, setOwners] = useState<OwnerListItem[]>([]);
  const [ownersLoading, setOwnersLoading] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [guestRows, setGuestRows] = useState<GuestRequestRow[]>([]);
  const [guestsLoading, setGuestsLoading] = useState(false);
  const [guestListError, setGuestListError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setZonesLoading(true);
    void getZones()
      .then((result) => {
        if (!active) return;
        const zones = result.data ?? [];
        const ids = zones
          .map((zone) => String(zone.id ?? "").trim())
          .filter((id) => id.length > 0);
        setDbZoneIds(Array.from(new Set(ids)));
      })
      .finally(() => {
        if (active) setZonesLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setOwnersLoading(true);
    void Promise.all([getOwners({ skip: 0, limit: 500 }), getMembers()])
      .then(([ownersResult, membersResult]) => {
        if (!active) return;
        setOwners(ownersResult.data ?? []);
        setMembers(membersResult.data ?? []);
      })
      .finally(() => {
        if (active) setOwnersLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const messageZoneIds = useMemo(() => {
    if (dbZoneIds.length > 0) return dbZoneIds;
    return userZoneId ? [String(userZoneId)] : [];
  }, [dbZoneIds, userZoneId]);
  const { messages, zones, loading, error, refreshInbox } = useMessageFeed(messageZoneIds);
  const allZoneIds = useMemo(
    () => Array.from(new Set([...dbZoneIds, ...zones])),
    [dbZoneIds, zones],
  );
  const composeZoneId = useMemo(
    () => (userZoneId == null ? null : String(userZoneId).trim()),
    [userZoneId],
  );

  const effectiveZoneForGuests = useMemo(() => {
    const z = composeZoneId?.trim();
    if (z) return z;
    if (zoneFilter !== "all" && zoneFilter.trim()) return zoneFilter.trim();
    return dbZoneIds[0]?.trim() ?? "";
  }, [composeZoneId, zoneFilter, dbZoneIds]);

  useEffect(() => {
    const z = effectiveZoneForGuests.trim();
    if (!z) {
      setGuestRows([]);
      setGuestListError(null);
      return;
    }
    let active = true;
    setGuestsLoading(true);
    setGuestListError(null);
    void listGuestRequestsForZone(z).then((res) => {
      if (!active) return;
      setGuestsLoading(false);
      if (res.error) {
        setGuestListError(res.error);
        setGuestRows([]);
        return;
      }
      setGuestRows(res.data);
    });
    return () => {
      active = false;
    };
  }, [effectiveZoneForGuests]);

  useEffect(() => {
    const z = effectiveZoneForGuests.trim();
    if (!z) return;
    const intervalId = window.setInterval(() => {
      void listGuestRequestsForZone(z).then((res) => {
        if (res.error) return;
        setGuestRows(res.data);
      });
    }, 18_000);
    return () => window.clearInterval(intervalId);
  }, [effectiveZoneForGuests]);

  const accessZonePermissionCount = useMemo(
    () => messages.reduce((acc, m) => acc + (m.type === "PERMISSION" ? 1 : 0), 0),
    [messages],
  );
  const showMessagesIntegrationBanner =
    import.meta.env.VITE_SHOW_MESSAGES_INTEGRATION_BANNER === "true";

  useEffect(() => {
    setComposeReceiverId("");
  }, [composeType]);
  const selectableReceivers = useMemo(() => {
    const readOwnerZoneId = (row: OwnerListItem): string => {
      const loose = row as OwnerListItem & {
        zoneId?: string | number | null;
        zone?: { id?: string | number | null } | null;
      };
      const raw = loose.zone_id ?? loose.zoneId ?? loose.zone?.id;
      return raw == null ? "" : String(raw).trim();
    };

    const fromOwners = owners
      .filter((row) => {
        const notSelf = Number(row.id) !== ownerId;
        if (!notSelf) return false;
        if (!composeZoneId) return true;
        const ownerZoneId = readOwnerZoneId(row);
        // Keep owners with unknown zone visible to avoid an empty picker
        // when the backend omits zone metadata.
        if (!ownerZoneId) return true;
        return ownerZoneId === composeZoneId;
      })
      .map((row) => {
        const name =
          `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() ||
          row.email ||
          "Owner";
        const zoneId = readOwnerZoneId(row);
        return {
          id: Number(row.id),
          name,
          zoneId,
        };
      });
    if (fromOwners.length > 0) return fromOwners;

    const candidates = members
      .map((row) => {
        const id = Number(row.account_owner_id ?? row.id);
        if (!Number.isFinite(id) || id <= 0) return null;
        const name =
          `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() ||
          row.name ||
          row.email ||
          "Member";
        const zoneId = String(row.zone_id ?? "").trim();
        return { id, name, zoneId };
      })
      .filter((row): row is { id: number; name: string; zoneId: string } => Boolean(row));

    const deduped = Array.from(
      new Map(candidates.map((row) => [row.id, row])).values(),
    );
    return deduped.filter((row) => {
      const notSelf = Number(row.id) !== ownerId;
      if (!notSelf) return false;
      if (!composeZoneId) return true;
      if (!row.zoneId) return true;
      return row.zoneId === composeZoneId;
    });
  }, [owners, members, composeZoneId, ownerId]);

  /** Defaults (all zones / all scope / category / type) intentionally include CHAT: meta is Access + private from MESSAGE_TYPE_META. */
  const filteredMessages = useMemo(() => {
    return messages.filter((message) => {
      if (zoneFilter !== "all" && message.zone_id !== zoneFilter) return false;
      if (scopeFilter !== "all" && message.scope !== scopeFilter) {
        return false;
      }
      if (categoryFilter !== "all" && message.category !== categoryFilter) {
        return false;
      }
      if (typeFilter !== "all" && message.type !== typeFilter) {
        return false;
      }
      if (dateFilter) {
        const ymd = new Date(message.created_at).toISOString().slice(0, 10);
        if (ymd !== dateFilter) return false;
      }
      const q = search.trim().toLowerCase();
      if (!q) return true;
      const guestSenderMatch =
        message.guest_sender_id != null &&
        (message.guest_sender_id.toLowerCase().includes(q) ||
          (q.length > 0 && "guest".startsWith(q)));
      const guestIdMatch =
        message.guest_id != null &&
        typeof message.guest_id === "string" &&
        message.guest_id.toLowerCase().includes(q);
      return (
        message.message.toLowerCase().includes(q) ||
        message.zone_id.toLowerCase().includes(q) ||
        String(message.sender_id).includes(q) ||
        String(message.receiver_id ?? "").includes(q) ||
        guestSenderMatch ||
        guestIdMatch
      );
    });
  }, [messages, zoneFilter, scopeFilter, categoryFilter, typeFilter, dateFilter, search]);

  const sortedFilteredMessages = useMemo(
    () =>
      [...filteredMessages].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [filteredMessages],
  );

  const activeMessage =
    filteredMessages.find((msg) => msg.id === activeMessageId) ?? null;

  const handleSend = async () => {
    if (!composeType) {
      setComposeStatus("Message Type is required.");
      return;
    }
    if (!composeText.trim()) return;
    const accessGuest = isAccessGuestChannelType(composeType);
    if (accessGuest) {
      if (!composeReceiverId.trim()) {
        setComposeStatus("Pick a guest for CHAT.");
        return;
      }
    } else if (isPrivateMessageType(composeType) && !composeReceiverId) {
      setComposeStatus("Receiver ID is required for private messages.");
      return;
    }
    const parsedReceiverId = Number(composeReceiverId);
    if (
      !accessGuest &&
      isPrivateMessageType(composeType) &&
      (!Number.isFinite(parsedReceiverId) || parsedReceiverId <= 0)
    ) {
      setComposeStatus("Receiver ID must be a valid owner id.");
      return;
    }
    setComposeStatus("Sending...");
    const result = await sendMessage({
      message: composeText.trim(),
      type: composeType,
      ...(composeZoneId ? { zone_id: composeZoneId } : {}),
      ...(accessGuest && composeReceiverId.trim()
        ? { guest_id: composeReceiverId.trim() }
        : {}),
      ...(!accessGuest && isPrivateMessageType(composeType)
        ? { receiver_id: parsedReceiverId }
        : {}),
    });
    setComposeStatus(result.error ? "Send failed." : "Sent.");
    if (!result.error) {
      setComposeText("");
      if (isPrivateMessageType(composeType)) setComposeReceiverId("");
    }
  };

  const selectableGuests = useMemo(
    () => guestRows.filter((r) => r.status !== "REJECTED"),
    [guestRows],
  );

  const groupedTypeOptions = useMemo(() => groupMessageTypesForUI(), []);
  const composeTypeOptions = useMemo(
    () =>
      groupedTypeOptions
        .map((group) => ({
          ...group,
          options: group.options.filter((option) => option.type !== "PERMISSION"),
        }))
        .filter((group) => group.options.length > 0),
    [groupedTypeOptions],
  );
  const [composeTypeNotice, setComposeTypeNotice] = useState<string | null>(null);

  useEffect(() => {
    if (composeType !== "PERMISSION") return;
    setComposeType("CHAT");
    setComposeTypeNotice(
      "PERMISSION events are automatic from guest access workflow; switched to CHAT.",
    );
  }, [composeType]);
  const composeScope = getMessageScopeForType(composeType);
  const composeCategory = getMessageTypeCategory(composeType);

  return (
    <section className="space-y-6 p-8">
      <div className="flex items-center gap-3 rounded-2xl border border-slate-800/80 bg-slate-950/90 px-4 py-3">
        <Smartphone
          className="h-5 w-5 shrink-0 text-orange-400"
          strokeWidth={2}
          aria-hidden
        />
        <p className="text-sm text-slate-300">
          <span className="font-medium text-slate-200">Live message feed.</span>{" "}
          <span className="text-slate-500">WebSocket with polling fallback.</span>
        </p>
      </div>

      <details className="rounded-2xl border border-slate-700/85 bg-slate-950/75 text-sm text-slate-300">
        <summary className="cursor-pointer select-none px-4 py-2.5 [&::-webkit-details-marker]:hidden">
          <span className="font-medium text-slate-100">Access info</span>
          <span className="mt-1 block text-xs text-slate-500">
            {accessZonePermissionCount > 0
              ? "This inbox batch includes PERMISSION rows; expand only if you need integration notes."
              : "Quiet summary — expand for details or enable verbose banner via env."}
          </span>
        </summary>
        <div className="space-y-3 border-t border-slate-800/80 px-4 py-3 text-xs leading-relaxed text-slate-400">
          {showMessagesIntegrationBanner ? (
            <>
              <p>
                Access Zone permission traffic belongs in each owner&apos;s stream from{" "}
                <span className="font-mono text-[11px] text-slate-200">
                  GET {import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, "") || "…"}
                  /messages/
                </span>{" "}
                (query <span className="font-mono text-[11px] text-slate-200">owner_id</span>, same as chat).{" "}
                <span className="font-medium text-slate-200">Permission traffic requires the backend to mirror</span>{" "}
                PERMISSION rows into member <span className="font-mono text-[11px] text-slate-200">/messages/</span>;
                this UI does not fabricate PERMISSION envelopes. Fallback: monitor the{" "}
                <strong className="font-medium text-slate-100">Guest access requests</strong> panel below (polls the
                guest-requests list for the resolved zone—status only, not a substitute for full message history).
              </p>
              {accessZonePermissionCount === 0 ? (
                <p className="text-slate-500">
                  No PERMISSION type entries in your current inbox batch—if approvals still feel silent, confirm
                  mirroring or use the Access panel while the API team aligns. CHAT from guests must also be mirrored
                  into <span className="font-mono text-slate-300">/messages/</span> for admins to see the same thread as
                  the guest app.
                </p>
              ) : null}
            </>
          ) : (
            <p>
              CHAT and PERMISSION lines appear here when the API includes them in{" "}
              <span className="font-mono text-slate-300">GET /messages/</span> for your owner. The{" "}
              <span className="font-medium text-slate-200">Guest access requests</span> block below is a lightweight
              status poll, not the full history. Set{" "}
              <span className="font-mono text-slate-300">VITE_SHOW_MESSAGES_INTEGRATION_BANNER=true</span> for verbose
              contract notes.
            </p>
          )}
        </div>
      </details>

      <div className="grid gap-4 rounded-[2rem] border border-slate-800/80 bg-slate-950/80 p-5 lg:grid-cols-6">
        <select
          value={zoneFilter}
          onChange={(e) => setZoneFilter(e.target.value)}
          className="rounded-md border border-[#00E5D1]/45 bg-slate-950/90 px-3 py-2.5 text-sm text-slate-100"
        >
          <option value="all">All zones</option>
          {allZoneIds.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
        <select
          value={scopeFilter}
          onChange={(e) => setScopeFilter(e.target.value as "all" | MessageVisibility)}
          className="rounded-md border border-[#00E5D1]/45 bg-slate-950/90 px-3 py-2.5 text-sm text-slate-100"
        >
          <option value="all">All Scope</option>
          <option value="public">Public</option>
          <option value="private">Private</option>
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as "all" | MessageCategory)}
          className="rounded-md border border-[#00E5D1]/45 bg-slate-950/90 px-3 py-2.5 text-sm text-slate-100"
        >
          <option value="all">All Category</option>
          <option value="Alarm">Alarm</option>
          <option value="Alert">Alert</option>
          <option value="Access">Access</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as "all" | MessageType)}
          className="rounded-md border border-[#00E5D1]/45 bg-slate-950/90 px-3 py-2.5 text-sm text-slate-100"
        >
          <option value="all">All Message Types</option>
          {groupedTypeOptions.map((group) => (
            <optgroup key={group.category} label={group.category}>
              {group.options.map((option) => (
                <option key={option.type} value={option.type}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <input
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="rounded-md border border-slate-700 bg-slate-950/90 px-3 py-2.5 text-sm text-slate-100"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search text or zone..."
          className="lg:col-span-2 rounded-md border border-slate-700 bg-slate-950/90 px-3 py-2.5 text-sm text-slate-100"
        />
      </div>

      <details className="rounded-2xl border border-slate-800/80 bg-slate-950/70 px-4 py-3 text-sm text-slate-300">
        <summary className="cursor-pointer select-none font-medium text-slate-100">
          Guest access requests (zone:{" "}
          <span className="font-mono text-[#00E5D1]">{effectiveZoneForGuests || "—"}</span>
          ){guestsLoading ? <span className="ml-2 text-xs font-normal text-slate-500">loading…</span> : null}
        </summary>
        {guestListError ? (
          <p className="mt-2 text-xs text-amber-200">
            {guestListError} Configure <span className="font-mono">VITE_ADMIN_GUEST_REQUESTS_LIST_URL</span> when your
            path differs from the contract default.
          </p>
        ) : (
          <div className="mt-3 max-h-[220px] overflow-auto rounded-lg border border-slate-800/80 bg-slate-950/90">
            {guestRows.length === 0 ? (
              <p className="p-4 text-xs text-slate-500">
                No rows for this zone. Incoming guest QR flows should appear once the backend exposes guest-requests for the
                member API.
              </p>
            ) : (
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-slate-950/95 text-[10px] uppercase tracking-[0.12em] text-slate-500">
                  <tr>
                    <th className="border-b border-slate-800 p-2">Guest</th>
                    <th className="border-b border-slate-800 p-2">Id</th>
                    <th className="border-b border-slate-800 p-2">Expect</th>
                    <th className="border-b border-slate-800 p-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {guestRows.map((r) => (
                    <tr key={r.id} className="border-b border-slate-800/60 text-slate-200 last:border-b-0">
                      <td className="p-2">{r.guestName ?? "—"}</td>
                      <td className="max-w-[140px] break-all p-2 font-mono text-[11px] text-slate-400">{r.id}</td>
                      <td className="p-2 capitalize text-slate-400">{r.expectation}</td>
                      <td className="p-2 font-medium text-[#00E5D1]">{r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        <p className="mt-2 text-[11px] text-slate-500">
          Refresh: on zone change, plus background poll every ~18s. Compose CHAT via guest ids from this list when
          shown.
        </p>
      </details>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-3">
          {error ? (
            <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
          ) : null}
          {loading ? (
            <p className="text-sm text-slate-500">Syncing messages…</p>
          ) : null}
          <MessageList
            messages={sortedFilteredMessages}
            activeId={activeMessageId}
            onSelect={setActiveMessageId}
          />
        </div>
        <div className="space-y-4">
          <MessageDetail message={activeMessage} />
          {Number.isFinite(ownerId) && ownerId > 0 ? (
            <MessageBlocksPanel
              currentOwnerId={ownerId}
              onBlocksChanged={() => void refreshInbox()}
            />
          ) : null}
          <section className="space-y-3 rounded-2xl border border-slate-800/80 bg-slate-950/80 p-5">
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-slate-500">
              Compose
            </p>
            <label className="block text-xs font-medium text-slate-400">Message Type</label>
            <select
              value={composeType}
              onChange={(e) => {
                setComposeTypeNotice(null);
                setComposeType(e.target.value as MessageType);
              }}
              className="w-full rounded-md border border-slate-700 bg-slate-950/90 px-3 py-2.5 text-sm text-slate-100"
            >
              {composeTypeOptions.map((group) => (
                <optgroup key={group.category} label={group.category}>
                  {group.options.map((option) => (
                    <option key={option.type} value={option.type}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-300">
              <p>
                Category: <span className="font-medium">{composeCategory}</span>
              </p>
              <p>
                Scope: <span className="font-medium capitalize">{composeScope}</span>
              </p>
              <p className="col-span-2 text-slate-500">Scope is determined by selected type.</p>
            </div>
            {composeTypeNotice ? (
              <p className="text-xs text-amber-200">{composeTypeNotice}</p>
            ) : null}
            {isAccessGuestChannelType(composeType) && (
              <>
                <p className="text-xs text-slate-500">
                  CHAT here goes to <span className="font-medium text-slate-300">guests</span> in this zone only (not
                  member-to-member). Zone for list:{" "}
                  <span className="font-mono text-slate-400">
                    {effectiveZoneForGuests || "—"}
                  </span>
                </p>
                <select
                  value={composeReceiverId}
                  onChange={(e) => setComposeReceiverId(e.target.value)}
                  className="w-full rounded-md border border-slate-700 bg-slate-950/90 px-3 py-2.5 text-sm text-slate-100"
                >
                  <option value="">
                    {guestsLoading ? "Loading guests…" : "Pick a guest (guest id)"}
                  </option>
                  {selectableGuests.map((row) => (
                    <option key={`guest-${row.id}`} value={row.id}>
                      {row.guestName?.trim() || "Guest"} — {row.id.slice(0, 12)}
                      {row.id.length > 12 ? "…" : ""} ({row.expectation}, {row.status})
                    </option>
                  ))}
                </select>
                {guestListError ? (
                  <p className="text-xs text-amber-200">
                    Guest list: {guestListError} (set{" "}
                    <span className="font-mono">VITE_ADMIN_GUEST_REQUESTS_LIST_URL</span> if your API path differs).
                  </p>
                ) : null}
                {!guestsLoading && !guestListError && selectableGuests.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No guests in this zone yet, or approvals are still pending. You can also open the zone on the
                    Dashboard to review guest requests.
                  </p>
                ) : null}
              </>
            )}
            {!isAccessGuestChannelType(composeType) && isPrivateMessageType(composeType) && (
              <>
                <select
                  value={composeReceiverId}
                  onChange={(e) => setComposeReceiverId(e.target.value)}
                  className="w-full rounded-md border border-slate-700 bg-slate-950/90 px-3 py-2.5 text-sm text-slate-100"
                >
                  <option value="">
                    {ownersLoading ? "Loading owner IDs..." : "Pick receiver owner ID"}
                  </option>
                  {selectableReceivers.map((row) => {
                    return (
                      <option key={`owner-${row.id}`} value={String(row.id)}>
                        {row.id} - {row.name}
                      </option>
                    );
                  })}
                </select>
              </>
            )}
            <textarea
              rows={4}
              value={composeText}
              onChange={(e) => setComposeText(e.target.value)}
              placeholder="Type your message..."
              className="w-full rounded-md border border-slate-700 bg-slate-950/90 px-3 py-2.5 text-sm text-slate-100"
            />
            <button
              type="button"
              onClick={handleSend}
              className="w-full rounded-md bg-[#00E5D1] px-4 py-2.5 text-sm font-bold text-[#0B0E11]"
            >
              Send Message
            </button>
            <p className="text-xs text-slate-500">
              Sending as owner <span className="font-mono">{ownerId || "?"}</span>
            </p>
            <p className="text-xs text-slate-500">
              {zonesLoading
                ? "Loading zone IDs from database..."
                : `Zone IDs loaded: ${allZoneIds.length}`}
            </p>
            {isAccessGuestChannelType(composeType) && (
              <p className="text-xs text-slate-500">
                {guestsLoading
                  ? "Loading guest list…"
                  : `Guests available: ${selectableGuests.length}`}
              </p>
            )}
            {!isAccessGuestChannelType(composeType) && isPrivateMessageType(composeType) && (
              <p className="text-xs text-slate-500">
                {ownersLoading
                  ? "Loading owner IDs from database..."
                  : `Owner IDs in your zone (${composeZoneId ?? "none"}): ${selectableReceivers.length}`}
              </p>
            )}
            <p className="text-xs text-slate-500">
              Selected type: {toMessageTypeLabel(composeType)}
            </p>
            {composeStatus && <p className="text-xs text-slate-500">{composeStatus}</p>}
          </section>
        </div>
      </div>
    </section>
  );
}
