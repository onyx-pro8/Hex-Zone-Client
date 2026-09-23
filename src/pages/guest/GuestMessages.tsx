import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, RefreshCw, Send } from "lucide-react";
import {
  getGuestAccessToken,
  getGuestSessionMeta,
} from "../../lib/guestAccessToken";
import {
  fetchGuestMe,
  fetchGuestPeers,
  isOwnGuestChatMessage,
  listGuestThreadMessages,
  sendGuestMessage,
  type GuestApiMessage,
  type GuestPeer,
} from "../../services/api/guestMessages";
import { guestApiBasePath } from "../../services/api/guestSession";
import { mapGuestAccessErrorCode } from "../../services/api/accessPermissions";
import {
  isPermissionDirectVisibility,
  isPermissionZonePendingBroadcastVisibility,
} from "../../lib/permissionVisibility";
import { useGuestRealtime } from "../../hooks/useGuestRealtime";

const POLL_MS = 4000;
const THREAD_LIMIT = 80;
const CLUSTER_WINDOW_MS = 5 * 60 * 1000;

function inboxDayKey(value: string | null | undefined): string {
  if (!value) return "";
  const t = new Date(value);
  if (!Number.isFinite(t.getTime())) return "";
  return `${t.getFullYear()}-${t.getMonth() + 1}-${t.getDate()}`;
}

function startOfLocalDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

function formatInboxDayLabel(value: string | null | undefined): string {
  if (!value) return "";
  const t = new Date(value);
  if (!Number.isFinite(t.getTime())) return "";
  const diffDays = Math.round((startOfLocalDay(new Date()) - startOfLocalDay(t)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return t.toLocaleDateString(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
}

function guestSenderKey(message: GuestApiMessage): string {
  if (isOwnGuestChatMessage(message)) return "guest:self";
  if (message.from_kind === "zone_broadcast") return "zone:broadcast";
  const owner = (message.from_owner_id ?? "").trim();
  if (owner) return `owner:${owner}`;
  return `row:${message.id}`;
}

function guestMessagesFormCluster(
  a: GuestApiMessage | undefined,
  b: GuestApiMessage | undefined,
): boolean {
  if (!a || !b) return false;
  const aSys = String(a.type ?? "").toUpperCase() === "PERMISSION";
  const bSys = String(b.type ?? "").toUpperCase() === "PERMISSION";
  if (aSys || bSys) return false;
  if (guestSenderKey(a) !== guestSenderKey(b)) return false;
  if (inboxDayKey(a.created_at) !== inboxDayKey(b.created_at)) return false;
  const ta = new Date(a.created_at ?? "").getTime();
  const tb = new Date(b.created_at ?? "").getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false;
  return Math.abs(ta - tb) <= CLUSTER_WINDOW_MS;
}

function guestBubbleCluster(
  prev: GuestApiMessage | undefined,
  item: GuestApiMessage,
  next: GuestApiMessage | undefined,
): "single" | "start" | "middle" | "end" {
  const withPrev = guestMessagesFormCluster(prev, item);
  const withNext = guestMessagesFormCluster(item, next);
  if (withPrev && withNext) return "middle";
  if (withPrev) return "end";
  if (withNext) return "start";
  return "single";
}

type GuestClusterRow = {
  message: GuestApiMessage;
  cluster: "single" | "start" | "middle" | "end";
  dayLabel: string | null;
};

function groupGuestClusters(messages: GuestApiMessage[]): GuestClusterRow[][] {
  const groups: GuestClusterRow[][] = [];
  messages.forEach((message, index) => {
    const prev = messages[index - 1];
    const next = messages[index + 1];
    const cluster = guestBubbleCluster(prev, message, next);
    const dayLabel =
      !prev || inboxDayKey(prev.created_at) !== inboxDayKey(message.created_at)
        ? formatInboxDayLabel(message.created_at)
        : null;
    const row: GuestClusterRow = { message, cluster, dayLabel };
    if (cluster === "middle" || cluster === "end") {
      groups[groups.length - 1]?.push(row);
      return;
    }
    groups.push([row]);
  });
  return groups;
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

export default function GuestMessages() {
  const [searchParams] = useSearchParams();
  const zoneFromQuery = String(searchParams.get("zone") ?? "").trim();
  const stored = useMemo(() => getGuestSessionMeta(), []);

  const [allowedTypes, setAllowedTypes] = useState<string[]>(
    stored?.allowed_message_types ?? ["CHAT"],
  );
  const [zones, setZones] = useState<string[]>(stored?.zone_ids ?? []);
  const [guestDisplayName, setGuestDisplayName] = useState(
    stored?.display_name?.trim() || "",
  );
  const [zoneId, setZoneId] = useState(
    zoneFromQuery || stored?.zone_id || stored?.zone_ids?.[0] || "",
  );
  const [peers, setPeers] = useState<GuestPeer[]>([]);
  const [peersError, setPeersError] = useState<string | null>(null);
  const [peerId, setPeerId] = useState("");
  const [messages, setMessages] = useState<GuestApiMessage[]>([]);
  const [msgError, setMsgError] = useState<string | null>(null);
  const [loadingPeers, setLoadingPeers] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("");
  const guestToken = useMemo(() => getGuestAccessToken(), []);

  const peerPresenceSeed = useMemo(() => {
    const map: Record<number, boolean> = {};
    for (const p of peers) {
      const id = Number(p.owner_id);
      if (!Number.isFinite(id) || id <= 0) continue;
      if (typeof p.online === "boolean") map[id] = p.online;
    }
    return map;
  }, [peers]);

  const { isPeerOnline, lastMessage: guestWsMessage } = useGuestRealtime({
    token: guestToken,
    zoneIds: zones.length ? zones : zoneId ? [zoneId] : [],
    enabled: !!guestToken,
    seedPresence: peerPresenceSeed,
  });

  useEffect(() => {
    let alive = true;
    const applyMe = async () => {
      const m = await fetchGuestMe();
      if (!alive || m.error || !m.data) return;
      setAllowedTypes(
        m.data.allowed_message_types?.length ? m.data.allowed_message_types : ["CHAT"],
      );
      if (m.data.display_name?.trim()) {
        setGuestDisplayName(m.data.display_name.trim());
      }
      const zs = m.data.zone_ids?.length ? m.data.zone_ids : [];
      setZones(zs);
      setZoneId((prev) => {
        if (prev && zs.includes(prev)) return prev;
        if (zoneFromQuery && zs.includes(zoneFromQuery)) return zoneFromQuery;
        return zs[0] ?? prev;
      });
    };
    void applyMe();
    const heartbeat = window.setInterval(() => void applyMe(), 20000);
    return () => {
      alive = false;
      window.clearInterval(heartbeat);
    };
  }, [zoneFromQuery]);

  const guestCanChat = useMemo(() => {
    if (!allowedTypes.length) return true;
    return allowedTypes.map((x) => x.toUpperCase()).includes("CHAT");
  }, [allowedTypes]);

  const loadPeers = useCallback(async () => {
    const z = zoneId.trim();
    if (!z) {
      setPeers([]);
      return;
    }
    setLoadingPeers(true);
    setPeersError(null);
    const res = await fetchGuestPeers(z);
    setLoadingPeers(false);
    if (res.error) {
      setPeersError(res.error);
      setPeers([]);
      return;
    }
    setPeers(res.data);
  }, [zoneId]);

  useEffect(() => {
    void loadPeers();
  }, [loadPeers]);

  const loadThread = useCallback(async () => {
    const z = zoneId.trim();
    const p = peerId.trim();
    if (!z || !p) {
      setMessages([]);
      return;
    }
    setLoadingThread(true);
    setMsgError(null);
    const res = await listGuestThreadMessages({
      zone_id: z,
      with_owner_id: p,
      limit: THREAD_LIMIT,
    });
    setLoadingThread(false);
    if (res.error) {
      setMsgError(res.error);
      setMessages([]);
      return;
    }
    setMessages(res.data);
  }, [zoneId, peerId]);

  useEffect(() => {
    void loadThread();
  }, [loadThread]);

  useEffect(() => {
    if (!guestWsMessage) return;
    try {
      const parsed = JSON.parse(guestWsMessage) as { type?: string };
      if (parsed.type === "guest_zone_message" || parsed.type === "NEW_MESSAGE") {
        void loadThread();
      }
    } catch {
      /* ignore */
    }
  }, [guestWsMessage, loadThread]);

  useEffect(() => {
    if (!peerId.trim()) return;
    const h = window.setInterval(() => void loadThread(), POLL_MS);
    return () => window.clearInterval(h);
  }, [peerId, loadThread]);

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    const z = zoneId.trim();
    const to = peerId.trim();
    const body = text.trim();
    if (!z || !to || !body) return;
    if (!guestCanChat) {
      setMsgError("Guests can send CHAT only");
      return;
    }
    setSending(true);
    setMsgError(null);
    const res = await sendGuestMessage({
      zone_id: z,
      type: "CHAT",
      text: body,
      to_owner_id: to,
    });
    setSending(false);
    if (res.error) {
      if (/GUEST_NOT_AUTHORIZED_FOR_ZONE/.test(res.error)) {
        setZoneId("");
      }
      const codeMatch = res.error.match(/\b([A-Z_]{3,})\b/);
      const mapped = mapGuestAccessErrorCode(codeMatch?.[1], res.error);
      setMsgError(mapped);
      return;
    }
    setText("");
    void loadThread();
  };

  const peersPathHint =
    zoneId.trim().length > 0
      ? `${guestApiBasePath()}/zones/${encodeURIComponent(zoneId.trim())}/peers`
      : "";
  const noHostsHint =
    zoneId.trim().length > 0
      ? `No members available — backend GET ${guestApiBasePath()}/zones/${encodeURIComponent(zoneId.trim())}/peers must return network members.`
      : "";

  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-[#0F2C5C]">Guest messages</h1>
        <p className="text-sm text-[#8694AC]">
          Guests can send CHAT only. Permission events are automatic. Messaging is network-level — pick any
          member or administrator on this network.
        </p>
        <div className="mt-3 rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-xs text-[#8694AC]">
          Access messaging uses your network id. Choose a zone (network), then pick a{" "}
          <span className="font-medium text-[#566784]">member or administrator</span> to chat with. Location
          and map zones do not limit who you can message. If the list stays empty after the backend ships{" "}
          <span className="font-mono text-[#8694AC]">{peersPathHint || "…/peers"}</span>, ask your backend team
          to return zone staff as documented in{" "}
          <code className="rounded bg-[#EDF3FB] px-1 text-[10px]">docs/BACKEND_ACCESS_ZONE_FULL_CONTRACT.md</code>{" "}
          (give them the whole file).
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(260px,360px)_minmax(0,1fr)]">
        <div className="space-y-3 rounded-xl border border-[#DCE6F2] bg-white p-4">
          <label className="block text-xs font-semibold uppercase tracking-[0.16em] text-[#8694AC]">
            Zone
          </label>
          <select
            value={zoneId}
            onChange={(ev) => {
              setZoneId(ev.target.value);
              setPeerId("");
            }}
            className="w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm text-[#0F2C5C]"
          >
            {(zones.length ? zones : zoneId ? [zoneId] : [""]).map((z) => (
              <option key={z || "empty"} value={z}>
                {z || "—"}
              </option>
            ))}
          </select>
          {loadingPeers ? (
            <p className="flex items-center gap-2 text-xs text-[#8694AC]">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading peers…
            </p>
          ) : null}
          {peersError ? (
            <p className="text-xs text-rose-600">{peersError}</p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="block text-xs font-semibold uppercase tracking-[0.16em] text-[#8694AC]">
              Members in this network
            </label>
            <button
              type="button"
              disabled={loadingPeers || !zoneId.trim()}
              onClick={() => void loadPeers()}
              className="inline-flex items-center gap-1 rounded-md border border-[#DCE6F2] px-2 py-1 text-[11px] text-[#566784] hover:border-[#2F80ED]/50 disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${loadingPeers ? "animate-spin" : ""}`} />
              Refresh peers
            </button>
          </div>

          {peers.length > 0 ? (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
              {peers.map((p) => {
                const selected = peerId === p.owner_id;
                return (
                  <li key={p.owner_id}>
                    <button
                      type="button"
                      onClick={() => setPeerId(p.owner_id)}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition ${
                        selected
                          ? "border-[#2F80ED]/45 bg-[#EDF3FB] text-[#0F2C5C]"
                          : "border-[#DCE6F2] bg-[#F7FAFE] text-[#566784] hover:border-[#2F80ED]/50"
                      }`}
                    >
                      <p className="font-medium text-[#0F2C5C]">{p.display_name || "Host"}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-[#8694AC]">{p.owner_id}</p>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}

          <select
            value={peerId}
            onChange={(ev) => setPeerId(ev.target.value)}
            className="w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm text-[#0F2C5C]"
          >
            <option value="">Select a peer…</option>
            {peers.map((p) => (
              <option key={p.owner_id} value={p.owner_id}>
                {p.display_name ? `${p.display_name} (${p.owner_id})` : p.owner_id}
              </option>
            ))}
          </select>
          {!loadingPeers && !peersError && zoneId.trim() && peers.length === 0 ? (
            <div className="space-y-1 rounded-md border border-[#E0992A]/30 bg-[#FBEFD8] px-3 py-2 text-xs text-[#E0992A]">
              <p>{noHostsHint}</p>
              <p className="text-[11px] text-[#E0992A]">
                Full contract:{" "}
                <span className="font-mono text-[#E0992A]">docs/BACKEND_ACCESS_ZONE_FULL_CONTRACT.md</span> (section 4.3).
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex min-h-[280px] flex-col rounded-xl border border-[#DCE6F2] bg-white p-4">
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8694AC]">
            Thread
          </h2>
          {!peerId ? (
            <p className="mt-4 text-sm text-[#8694AC]">Choose a peer to load messages.</p>
          ) : loadingThread && !messages.length ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-[#8694AC]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : (
            <ul className="mt-2 flex-1 space-y-0 overflow-y-auto text-sm">
              {groupGuestClusters(messages).map((group) => {
                const first = group[0];
                if (!first) return null;
                const firstMine = isOwnGuestChatMessage(first.message);
                const peerName =
                  peers.find((p) => p.owner_id === peerId)?.display_name?.trim() ||
                  first.message.from_owner_id ||
                  "Host";
                return (
                  <li key={first.message.id} className="mb-1.5 space-y-2">
                    {first.dayLabel ? (
                      <p className="text-center text-[11px] font-bold text-[#8694AC]">
                        {first.dayLabel}
                      </p>
                    ) : null}
                    {String(first.message.type ?? "").toUpperCase() === "PERMISSION" ? (
                      <div className="w-full px-1">
                        <div className="w-full rounded-2xl border border-[#E0992A] bg-[#FBEFD8] px-3 py-2.5 text-center">
                          <p className="text-sm font-semibold text-[#E0992A]">
                            {first.message.text ?? "—"}
                          </p>
                          <div className="mt-2 flex items-center justify-between gap-2 text-[10px]">
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                              <span className="rounded-full bg-[#FBEFD8] px-2 py-0.5 font-semibold uppercase text-[#E0992A]">
                                PERMISSION
                              </span>
                              <span className="rounded-full bg-[#EDF3FB] px-2 py-0.5 text-[#566784]">
                                {first.message.zone_id || zoneId || "—"}
                              </span>
                            </div>
                            {first.message.created_at ? (
                              <p className="shrink-0 font-semibold text-[#C48A2A]">
                                {new Date(first.message.created_at).toLocaleTimeString(undefined, {
                                  hour: "numeric",
                                  minute: "2-digit",
                                })}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : (
                    <div className={`flex ${firstMine ? "justify-end" : "justify-start"}`}>
                      <div className="flex w-fit max-w-[80%] flex-col gap-1.5">
                        {group.map(({ message: m, cluster }) => {
                const t = String(m.type ?? "").toUpperCase();
                const isPermission = t === "PERMISSION";
                const isMine = isOwnGuestChatMessage(m);
                const zoneBroadcast =
                  isPermission && isPermissionZonePendingBroadcastVisibility(m.permission_visibility);
                const privateAudit = isPermission && isPermissionDirectVisibility(m.permission_visibility);
                const showHeader = cluster === "single" || cluster === "start";
                const showBadges = cluster === "single" || cluster === "end";
                const radiusClass = showHeader
                  ? showBadges
                    ? "rounded-2xl"
                    : "rounded-t-2xl rounded-b-none"
                  : showBadges
                    ? "rounded-b-2xl rounded-t-none"
                    : "rounded-none";
                const senderName = isMine ? "ME" : peerName;
                const senderOnline =
                  isMine ||
                  isPeerOnline(m.from_owner_id ?? peerId);
                return (
                    <div
                      key={m.id}
                      className={`block w-full border px-2 py-1.5 ${radiusClass} ${
                        isMine
                          ? "border-white/40 bg-[#2F80ED]"
                          : zoneBroadcast
                            ? "border-[#E0992A]/50 bg-[#FBEFD8]"
                            : isPermission
                              ? "border-[#E0992A]/50 bg-[#FBEFD8]"
                              : "border-[#C2D2E6] bg-[#F7FAFE]"
                      }`}
                    >
                      {showHeader ? (
                      <div
                        className={`flex w-full items-center justify-between gap-3 ${
                          isMine ? "flex-row-reverse" : "flex-row"
                        }`}
                      >
                        <div
                          className={`flex min-w-0 items-center gap-2 ${
                            isMine ? "flex-row-reverse" : "flex-row"
                          }`}
                        >
                          <span
                            className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#C8DFFF] text-[11px] font-extrabold text-[#1B5BB5]"
                            aria-hidden
                          >
                            {initialsFromName(isMine ? guestDisplayName || "Guest" : senderName)}
                            <span
                              className={`absolute bottom-0 h-2.5 w-2.5 rounded-full border-2 border-white ${
                                isMine ? "left-0" : "right-0"
                              } ${senderOnline ? "bg-green-500" : "bg-red-500"}`}
                            />
                          </span>
                          <div className="min-w-0">
                            <p
                              className={`text-sm font-extrabold ${
                                isMine ? "text-right text-white" : "text-left text-[#0F2C5C]"
                              }`}
                            >
                              {senderName}
                            </p>
                            <p
                              className={`mt-0.5 text-[11px] ${
                                isMine ? "text-right text-white/70" : "text-left text-[#8694AC]"
                              }`}
                            >
                              {m.zone_id || zoneId || "—"}
                            </p>
                          </div>
                        </div>
                        {m.created_at ? (
                          <p
                            className={`shrink-0 text-[10px] font-semibold ${
                              isMine ? "text-white/70" : "text-[#8694AC]"
                            }`}
                          >
                            {new Date(m.created_at).toLocaleTimeString(undefined, {
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </p>
                        ) : null}
                      </div>
                      ) : null}
                      <p
                        className={`${showHeader ? "mt-1.5" : ""} text-left ${
                          isPermission ? "text-[#E0992A]" : isMine ? "text-white" : "text-[#566784]"
                        }`}
                      >
                        {m.text ?? "—"}
                      </p>
                      {showBadges ? (
                      <div className="mt-1.5 w-0 min-w-full">
                        <div className="flex w-max flex-nowrap items-center gap-1.5 text-[10px]">
                        <span
                          className={`rounded-full px-2 py-0.5 font-semibold uppercase ${
                            isPermission
                              ? "bg-[#FBEFD8] text-[#E0992A]"
                              : isMine
                                ? "bg-white/15 text-white"
                                : "bg-[#EDF3FB] text-[#2F80ED]"
                          }`}
                        >
                          {t}
                        </span>
                        {isPermission ? (
                          <span className="rounded-full bg-[#FBEFD8] px-2 py-0.5 font-semibold text-[#E0992A]">
                            read-only
                          </span>
                        ) : null}
                        {zoneBroadcast ? (
                          <span className="rounded-full bg-[#FBEFD8] px-2 py-0.5 font-medium text-[#E0992A]">
                            Zone alert
                          </span>
                        ) : null}
                        {privateAudit ? (
                          <span className="rounded-full bg-[#EDF3FB] px-2 py-0.5 text-[#566784]">
                            Private
                          </span>
                        ) : null}
                        {m.zone_id ? (
                          <span
                            className={`rounded-full px-2 py-0.5 ${
                              isMine ? "bg-white/15 text-white" : "bg-[#EDF3FB] text-[#566784]"
                            }`}
                          >
                            {m.zone_id}
                          </span>
                        ) : null}
                        <span
                          className={`rounded-full px-2 py-0.5 ${
                            isMine ? "bg-white/15 text-white" : "bg-[#EDF3FB] text-[#566784]"
                          }`}
                        >
                          No location
                        </span>
                        </div>
                      </div>
                      ) : null}
                    </div>
                );
                        })}
                      </div>
                    </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {msgError ? <p className="mt-2 text-xs text-rose-600">{msgError}</p> : null}
        </div>
      </div>

      {peerId ? (
        <form onSubmit={(ev) => void handleSend(ev)} className="space-y-3 rounded-xl border border-[#DCE6F2] bg-white p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] flex-1">
              <label className="mb-1 block text-xs uppercase text-[#8694AC]">Message</label>
              <input
                value={text}
                onChange={(ev) => setText(ev.target.value)}
                placeholder="Write a message…"
                className="w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm text-[#0F2C5C]"
              />
            </div>
            <button
              type="submit"
              disabled={sending || !text.trim() || !guestCanChat}
              className="inline-flex items-center gap-2 rounded-md bg-[#2F80ED] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Send
            </button>
          </div>
          <p className="text-xs text-[#8694AC]">Sending as CHAT.</p>
        </form>
      ) : null}
    </section>
  );
}
