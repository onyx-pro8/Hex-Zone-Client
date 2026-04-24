import { useEffect, useMemo, useState } from "react";
import { Smartphone } from "lucide-react";
import { MessageList } from "../components/messages/MessageList";
import { MessageDetail } from "../components/messages/MessageDetail";
import { useMessageFeed } from "../hooks/useMessageFeed";
import { sendMessage, type MessageVisibility } from "../services/api/messages";
import { getOwners, type OwnerListItem } from "../services/api/auth";
import { getZones } from "../services/api/zones";
import { useAuth } from "../hooks/useAuth";

export default function Messages() {
  const { user } = useAuth();
  const userZoneId = user?.zoneId ?? user?.zone_id;
  const ownerId = Number(user?.id);
  const [zoneFilter, setZoneFilter] = useState("all");
  const [visibilityFilter, setVisibilityFilter] = useState<
    "all" | MessageVisibility
  >("all");
  const [dateFilter, setDateFilter] = useState("");
  const [search, setSearch] = useState("");
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);

  const [composeVisibility, setComposeVisibility] =
    useState<MessageVisibility>("public");
  const [composeReceiverId, setComposeReceiverId] = useState("");
  const [composeText, setComposeText] = useState("");
  const [composeStatus, setComposeStatus] = useState("");
  const [dbZoneIds, setDbZoneIds] = useState<string[]>([]);
  const [zonesLoading, setZonesLoading] = useState(false);
  const [owners, setOwners] = useState<OwnerListItem[]>([]);
  const [ownersLoading, setOwnersLoading] = useState(false);

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
    void getOwners({ skip: 0, limit: 500 })
      .then((result) => {
        if (!active) return;
        setOwners(result.data ?? []);
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
  const { messages, zones, loading, error } = useMessageFeed(messageZoneIds);
  const allZoneIds = useMemo(
    () => Array.from(new Set([...dbZoneIds, ...zones])),
    [dbZoneIds, zones],
  );
  const composeZoneId = useMemo(
    () => (userZoneId == null ? null : String(userZoneId).trim()),
    [userZoneId],
  );
  const selectableOwners = useMemo(() => {
    const readOwnerZoneId = (row: OwnerListItem): string => {
      const loose = row as OwnerListItem & {
        zoneId?: string | number | null;
        zone?: { id?: string | number | null } | null;
      };
      const raw = loose.zone_id ?? loose.zoneId ?? loose.zone?.id;
      return raw == null ? "" : String(raw).trim();
    };

    return owners.filter((row) => {
      const notSelf = Number(row.id) !== ownerId;
      if (!notSelf) return false;
      if (!composeZoneId) return true;
      const ownerZoneId = readOwnerZoneId(row);
      // Keep owners with unknown zone visible to avoid an empty picker
      // when the backend omits zone metadata.
      if (!ownerZoneId) return true;
      return ownerZoneId === composeZoneId;
    });
  }, [owners, composeZoneId, ownerId]);

  const filteredMessages = useMemo(() => {
    return messages.filter((message) => {
      if (zoneFilter !== "all" && message.zone_id !== zoneFilter) return false;
      if (
        visibilityFilter !== "all" &&
        message.visibility !== visibilityFilter
      ) {
        return false;
      }
      if (dateFilter) {
        const ymd = new Date(message.created_at).toISOString().slice(0, 10);
        if (ymd !== dateFilter) return false;
      }
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (
        message.message.toLowerCase().includes(q) ||
        message.zone_id.toLowerCase().includes(q) ||
        String(message.sender_id).includes(q) ||
        String(message.receiver_id ?? "").includes(q)
      );
    });
  }, [messages, zoneFilter, visibilityFilter, dateFilter, search]);

  const activeMessage =
    filteredMessages.find((msg) => msg.id === activeMessageId) ?? null;

  const handleSend = async () => {
    if (!composeText.trim()) return;
    if (composeVisibility === "private" && !composeReceiverId) {
      setComposeStatus("Receiver ID is required for private messages.");
      return;
    }
    const parsedReceiverId = Number(composeReceiverId);
    if (
      composeVisibility === "private" &&
      (!Number.isFinite(parsedReceiverId) || parsedReceiverId <= 0)
    ) {
      setComposeStatus("Receiver ID must be a valid owner id.");
      return;
    }
    setComposeStatus("Sending...");
    const result = await sendMessage({
      message: composeText.trim(),
      visibility: composeVisibility,
      ...(composeVisibility === "private"
        ? { receiver_id: parsedReceiverId }
        : {}),
    });
    setComposeStatus(result.error ? "Send failed." : "Sent.");
    if (!result.error) {
      setComposeText("");
      if (composeVisibility === "private") setComposeReceiverId("");
    }
  };

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

      <div className="grid gap-4 rounded-[2rem] border border-slate-800/80 bg-slate-950/80 p-5 lg:grid-cols-5">
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
          value={visibilityFilter}
          onChange={(e) =>
            setVisibilityFilter(e.target.value as "all" | MessageVisibility)
          }
          className="rounded-md border border-[#00E5D1]/45 bg-slate-950/90 px-3 py-2.5 text-sm text-slate-100"
        >
          <option value="all">All visibility</option>
          <option value="public">public</option>
          <option value="private">private</option>
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

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-3">
          {/* {error && (
            <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}
           <p className="text-sm text-slate-500">{loading ? "Syncing messages..." : ""}</p> */}
          <MessageList
            messages={filteredMessages}
            activeId={activeMessageId}
            onSelect={setActiveMessageId}
          />
        </div>
        <div className="space-y-4">
          <MessageDetail message={activeMessage} />
          <section className="space-y-3 rounded-2xl border border-slate-800/80 bg-slate-950/80 p-5">
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-slate-500">
              Compose
            </p>
            <select
              value={composeVisibility}
              onChange={(e) =>
                setComposeVisibility(e.target.value as MessageVisibility)
              }
              className="w-full rounded-md border border-slate-700 bg-slate-950/90 px-3 py-2.5 text-sm text-slate-100"
            >
              <option value="public">Public message</option>
              <option value="private">Private message</option>
            </select>
            {composeVisibility === "private" && (
              <>
                <select
                  value={composeReceiverId}
                  onChange={(e) => setComposeReceiverId(e.target.value)}
                  className="w-full rounded-md border border-slate-700 bg-slate-950/90 px-3 py-2.5 text-sm text-slate-100"
                >
                  <option value="">
                    {ownersLoading ? "Loading owner IDs..." : "Pick receiver owner ID"}
                  </option>
                  {selectableOwners.map((row) => {
                    const name =
                      `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() ||
                      row.email ||
                      "Owner";
                    return (
                      <option key={`owner-${row.id}`} value={String(row.id)}>
                        {row.id} - {name}
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
            {composeVisibility === "private" && (
              <p className="text-xs text-slate-500">
                {ownersLoading
                  ? "Loading owner IDs from database..."
                  : `Owner IDs in your zone (${composeZoneId ?? "none"}): ${selectableOwners.length}`}
              </p>
            )}
            {composeStatus && <p className="text-xs text-slate-500">{composeStatus}</p>}
          </section>
        </div>
      </div>
    </section>
  );
}
