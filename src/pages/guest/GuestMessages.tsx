import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, RefreshCw, Send } from "lucide-react";
import { getGuestSessionMeta } from "../../lib/guestAccessToken";
import {
  fetchGuestMe,
  fetchGuestPeers,
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

const POLL_MS = 4000;
const THREAD_LIMIT = 80;

export default function GuestMessages() {
  const [searchParams] = useSearchParams();
  const zoneFromQuery = String(searchParams.get("zone") ?? "").trim();
  const stored = useMemo(() => getGuestSessionMeta(), []);

  const [allowedTypes, setAllowedTypes] = useState<string[]>(
    stored?.allowed_message_types ?? ["CHAT"],
  );
  const [zones, setZones] = useState<string[]>(stored?.zone_ids ?? []);
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

  useEffect(() => {
    let alive = true;
    (async () => {
      const m = await fetchGuestMe();
      if (!alive || m.error || !m.data) return;
      setAllowedTypes(
        m.data.allowed_message_types?.length ? m.data.allowed_message_types : ["CHAT"],
      );
      const zs = m.data.zone_ids?.length ? m.data.zone_ids : [];
      setZones(zs);
      setZoneId((prev) => {
        if (prev && zs.includes(prev)) return prev;
        if (zoneFromQuery && zs.includes(zoneFromQuery)) return zoneFromQuery;
        return zs[0] ?? prev;
      });
    })();
    return () => {
      alive = false;
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
            <ul className="mt-2 flex-1 space-y-2 overflow-y-auto text-sm">
              {messages.map((m) => {
                const t = String(m.type ?? "").toUpperCase();
                const isPermission = t === "PERMISSION";
                const zoneBroadcast =
                  isPermission && isPermissionZonePendingBroadcastVisibility(m.permission_visibility);
                const privateAudit = isPermission && isPermissionDirectVisibility(m.permission_visibility);
                return (
                  <li
                    key={m.id}
                    className={`rounded-md border px-3 py-2 ${
                      zoneBroadcast
                        ? "border-[#E0992A]/30 bg-[#FBEFD8]"
                        : isPermission
                          ? "border-[#E0992A]/30 bg-[#FBEFD8]"
                          : "border-[#DCE6F2] bg-[#F7FAFE]"
                    }`}
                  >
                    <p className="text-[10px] uppercase tracking-wider text-[#8694AC]">
                      {t}
                      {m.created_at ? ` · ${m.created_at}` : ""}
                      {zoneBroadcast ? (
                        <span
                          className="ml-2 font-medium text-[#E0992A]"
                          title="Unscheduled guest waiting for approval"
                        >
                          · Zone alert
                        </span>
                      ) : null}
                      {privateAudit ? (
                        <span className="ml-2 text-[#8694AC]" title="Private staff audit">
                          · Private
                        </span>
                      ) : null}
                      {isPermission ? (
                        <span className="ml-2 text-[#E0992A]"> · read-only in thread</span>
                      ) : null}
                    </p>
                    <p className={isPermission ? "text-[#E0992A]" : "text-[#566784]"}>{m.text ?? "—"}</p>
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
