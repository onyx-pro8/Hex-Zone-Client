import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  mergeGuestRealtimeIntoRow,
  parseGuestArrivalSocketEvent,
  type GuestRequestRow,
} from "../../lib/guestRealtime";
import { useAuth } from "../../hooks/useAuth";
import { useWebSocket } from "../../hooks/useWebSocket";
import {
  approveGuestPermissionRequestRemote,
  createGuestChatThreadPlaceholder,
  denyGuestPermissionRequestRemote,
  listGuestRequestsForZone,
} from "../../services/api/accessPermissions";
import { Check, ChevronDown, ChevronUp, MessageCircle, RefreshCw, ShieldAlert, X } from "lucide-react";

/** Visible cards while collapsed; “Show more” when there are additional rows above this count. */
const GUEST_REQUESTS_COLLAPSED_COUNT = 2;

function statusLabel(status: GuestRequestRow["status"]): string {
  switch (status) {
    case "APPROVED":
      return "Approved";
    case "REJECTED":
      return "Rejected";
    case "PENDING":
      return "Pending";
    default:
      return "Arrived";
  }
}

function expectationLabel(row: GuestRequestRow): string {
  return row.expectation === "unexpected" ? "Unexpected" : "Expected";
}

type Props = {
  zoneId: string;
};

export function GuestRequestsDashboardSection({ zoneId }: Props) {
  const navigate = useNavigate();
  const { token } = useAuth();
  const normalizedZoneId = zoneId.trim();
  const [rows, setRows] = useState<GuestRequestRow[]>([]);
  const [listError, setListError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [chatNote, setChatNote] = useState("");
  const [listExpanded, setListExpanded] = useState(false);

  const { lastMessage } = useWebSocket({
    token,
    zoneIds: normalizedZoneId ? [normalizedZoneId] : [],
  });

  const refresh = useCallback(async () => {
    if (!normalizedZoneId) return;
    setLoading(true);
    setListError("");
    const res = await listGuestRequestsForZone(normalizedZoneId);
    setLoading(false);
    if (res.error) {
      setListError(res.error);
      return;
    }
    setListError("");
    setRows(res.data);
  }, [normalizedZoneId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setListExpanded(false);
  }, [normalizedZoneId]);

  useEffect(() => {
    const handle = window.setInterval(() => void refresh(), 25_000);
    return () => window.clearInterval(handle);
  }, [refresh]);

  useEffect(() => {
    if (!lastMessage) return;
    const evt = parseGuestArrivalSocketEvent(lastMessage);
    if (!evt) return;
    setRows((prev) => {
      const evtId = String(
        evt.data.request_id ??
          evt.data.guest_id ??
          evt.data.id ??
          evt.data.permission_request_id ??
          "",
      ).trim();
      if (evtId) {
        const idx = prev.findIndex((r) => r.id === evtId);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = mergeGuestRealtimeIntoRow(copy[idx], evt);
          return copy;
        }
      }
      if (evt.type === "guest_arrived") {
        const syntheticId =
          evtId ||
          `ws-${String(evt.data.hid ?? "hid")}-${String(evt.data.guest_name ?? "guest")}`;
        if (prev.some((r) => r.id === syntheticId)) return prev;
        const expectation: GuestRequestRow["expectation"] =
          evt.data.expected === true ||
          String(evt.data.expectation ?? "")
            .toLowerCase()
            .includes("expected")
            ? "expected"
            : "unexpected";
        const nextRow: GuestRequestRow = {
          id: syntheticId,
          zoneId: normalizedZoneId,
          guestName:
            typeof evt.data.guest_name === "string" ? evt.data.guest_name : "Guest",
          hid: typeof evt.data.hid === "string" ? evt.data.hid : undefined,
          createdAt:
            typeof evt.data.time === "string"
              ? evt.data.time
              : new Date().toISOString(),
          expectation,
          status: "ARRIVED",
        };
        return [nextRow, ...prev];
      }
      return prev;
    });
  }, [lastMessage, normalizedZoneId]);

  const runApprove = async (requestId: string) => {
    setBusyId(requestId);
    const res = await approveGuestPermissionRequestRemote(
      requestId,
      normalizedZoneId,
    );
    setBusyId(null);
    if (res.error) {
      setListError(res.error);
      return;
    }
    void refresh();
  };

  const runReject = async (requestId: string) => {
    setBusyId(requestId);
    const res = await denyGuestPermissionRequestRemote(
      requestId,
      normalizedZoneId,
    );
    setBusyId(null);
    if (res.error) {
      setListError(res.error);
      return;
    }
    void refresh();
  };

  const runChat = async (requestId: string) => {
    setBusyId(requestId);
    setChatNote("");
    const res = await createGuestChatThreadPlaceholder(requestId);
    setBusyId(null);
    if (res.error) {
      setChatNote(`${res.error} — opening Messages anyway.`);
      navigate("/messages");
      return;
    }
    const threadId = String(res.data?.id ?? res.data?.thread_id ?? "").trim();
    setChatNote(
      threadId
        ? `Chat thread ${threadId} — opened in Messages.`
        : "Continue the admin ↔ guest thread in Messages.",
    );
    navigate(threadId ? `/messages?thread=${encodeURIComponent(threadId)}` : "/messages");
  };

  if (!normalizedZoneId) return null;

  const canToggleList = rows.length > GUEST_REQUESTS_COLLAPSED_COUNT;
  const visibleRows = listExpanded ? rows : rows.slice(0, GUEST_REQUESTS_COLLAPSED_COUNT);
  const hiddenCount = rows.length - visibleRows.length;

  return (
    <section className="border-b border-[#DCE6F2] bg-[#F7FAFE] px-4 py-4 sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-[#0F2C5C]">
            Guest requests
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-[#8694AC]">
            Expected vs unexpected arrivals for this zone. Realtime events:{" "}
            <span className="font-mono text-[#566784]">guest_arrived</span>,{" "}
            <span className="font-mono text-[#566784]">guest_expected</span>,{" "}
            <span className="font-mono text-[#566784]">guest_unexpected</span>,{" "}
            <span className="font-mono text-[#566784]">guest_approved</span>,{" "}
            <span className="font-mono text-[#566784]">guest_rejected</span>.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-[#DCE6F2] px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#566784] transition hover:border-[#2F80ED]/40 hover:text-[#2F80ED] disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh list
        </button>
      </div>

      {listError ? (
        <div className="mx-auto mt-3 flex max-w-7xl flex-wrap gap-2 rounded-lg border border-[#E0992A]/30 bg-[#FBEFD8] px-3 py-2 text-xs text-[#8A5A12]">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>
            Guest list API error: {listError}. Default path is{" "}
            <span className="font-mono">GET /api/access/guest-requests?zone_id=…</span>; set{" "}
            <span className="font-mono">VITE_ADMIN_GUEST_REQUESTS_LIST_URL</span> if yours differs.
          </span>
        </div>
      ) : null}

      {chatNote ? (
        <p className="mx-auto mt-2 max-w-7xl text-xs text-[#2F80ED]">{chatNote}</p>
      ) : null}

      <div className="mx-auto mt-4 grid max-w-7xl gap-3 lg:grid-cols-2">
        {rows.length === 0 && !loading ? (
          <p className="text-sm text-[#8694AC]">
            No queued guest rows yet — arrivals will populate over WebSocket (
            <span className="font-mono">guest_arrived</span>) or appear after backend list ships.
          </p>
        ) : null}
        {visibleRows.map((row) => {
          const pendingUnexpected =
            row.expectation === "unexpected" &&
            (row.status === "PENDING" || row.status === "ARRIVED");
          return (
            <article
              key={row.id}
              className="rounded-2xl border border-[#DCE6F2] bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DCE6F2] pb-2">
                <div>
                  <p className="text-sm font-semibold text-[#0F2C5C]">
                    {row.guestName ?? "Guest"}
                  </p>
                  <p className="text-[11px] text-[#8694AC]">
                    {row.createdAt ? new Date(row.createdAt).toLocaleString() : "Just now"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.14em]">
                  <span
                    className={`rounded-full px-2 py-0.5 ${
                      row.expectation === "unexpected"
                        ? "bg-[#FCE7EA] text-[#9A2533] ring-1 ring-[#E23B4E]/30"
                        : "bg-[#E3F4E8] text-[#1F7A37] ring-1 ring-[#2FA24A]/30"
                    }`}
                  >
                    {expectationLabel(row)}
                  </span>
                  <span className="rounded-full bg-[#EDF3FB] px-2 py-0.5 text-[#566784] ring-1 ring-[#DCE6F2]">
                    {statusLabel(row.status)}
                  </span>
                </div>
              </div>

              <div className="mt-3 space-y-1 font-mono text-[10px] text-[#8694AC]">
                {row.hid ? <p>HID · {row.hid}</p> : null}
                <p className="break-all">Ref · {row.id}</p>
              </div>

              {pendingUnexpected ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => void runApprove(row.id)}
                    className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-[#2FA24A] px-3 py-2 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-50 sm:flex-none"
                  >
                    <Check className="h-3.5 w-3.5" /> Approve
                  </button>
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => void runReject(row.id)}
                    className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-[#E23B4E] px-3 py-2 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-50 sm:flex-none"
                  >
                    <X className="h-3.5 w-3.5" /> Reject
                  </button>
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => void runChat(row.id)}
                    className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-[#DCE6F2] px-3 py-2 text-xs font-semibold text-[#566784] transition hover:border-[#2F80ED]/40 hover:text-[#2F80ED] disabled:opacity-50 sm:flex-none"
                  >
                    <MessageCircle className="h-3.5 w-3.5" /> Chat
                  </button>
                </div>
              ) : row.status === "APPROVED" ? (
                <div className="mt-4 space-y-2">
                  <p className="text-[11px] text-[#8694AC]">
                    Guest approved — open Chat to continue messaging with them in Messages.
                  </p>
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => void runChat(row.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-[#DCE6F2] px-3 py-2 text-xs font-semibold text-[#566784] transition hover:border-[#2F80ED]/40 hover:text-[#2F80ED] disabled:opacity-50"
                  >
                    <MessageCircle className="h-3.5 w-3.5" /> Chat
                  </button>
                </div>
              ) : (
                <p className="mt-3 text-[11px] text-[#8694AC]">
                  {row.expectation === "expected"
                    ? "Expected guest — monitor zone activity; use Chat if you need coordination."
                    : row.status === "REJECTED"
                      ? "Guest declined — they were notified to contact you."
                      : "Awaiting classification or additional signals from the server."}
                </p>
              )}
            </article>
          );
        })}
      </div>

      {canToggleList ? (
        <div className="mx-auto mt-3 flex max-w-7xl justify-center">
          <button
            type="button"
            onClick={() => setListExpanded((v) => !v)}
            className="inline-flex items-center gap-2 rounded-lg border border-[#DCE6F2] px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#566784] transition hover:border-[#2F80ED]/40 hover:text-[#2F80ED]"
          >
            {listExpanded ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" /> Show less
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" /> Show more ({hiddenCount})
              </>
            )}
          </button>
        </div>
      ) : null}
    </section>
  );
}
