import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  ShieldAlert,
  X,
  Ban,
} from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { useWebSocket } from "../../hooks/useWebSocket";
import {
  acceptGuestPass,
  listGuestPasses,
  rejectGuestPass,
  revokeGuestPass,
  type GuestPass,
  type GuestPassStatus,
} from "../../services/api/guestPasses";

type Props = { zoneId: string; isAdmin: boolean };

const COLLAPSED_COUNT = 3;

function statusBadge(status: GuestPassStatus) {
  switch (status) {
    case "PENDING":
      return "bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/30";
    case "ACCEPTED":
      return "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/30";
    case "REJECTED":
      return "bg-rose-500/15 text-rose-200 ring-1 ring-rose-500/30";
    case "REVOKED":
      return "bg-slate-700/40 text-slate-400 ring-1 ring-slate-600/50";
  }
}

function isExpired(pass: GuestPass): boolean {
  if (pass.is_expired) return true;
  return new Date(pass.expires_at) < new Date();
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function GuestPassListSection({ zoneId, isAdmin }: Props) {
  const { token } = useAuth();
  const normalizedZoneId = zoneId.trim();

  const [passes, setPasses] = useState<GuestPass[]>([]);
  const [listError, setListError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [expanded, setExpanded] = useState(false);

  const { lastMessage } = useWebSocket({
    token,
    zoneIds: normalizedZoneId ? [normalizedZoneId] : [],
  });

  const refresh = useCallback(async () => {
    if (!normalizedZoneId) return;
    setLoading(true);
    setListError("");
    const res = await listGuestPasses(normalizedZoneId);
    setLoading(false);
    if (res.error) {
      setListError(res.error);
      return;
    }
    setPasses(res.data ?? []);
  }, [normalizedZoneId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setExpanded(false);
  }, [normalizedZoneId]);

  useEffect(() => {
    const handle = window.setInterval(() => void refresh(), 25_000);
    return () => window.clearInterval(handle);
  }, [refresh]);

  useEffect(() => {
    if (!lastMessage) return;
    try {
      const parsed =
        typeof lastMessage === "string" ? JSON.parse(lastMessage) : lastMessage;
      if (parsed?.type === "PERMISSION_MESSAGE" && parsed?.data?.guest_pass) {
        void refresh();
      }
    } catch {
      /* ignore non-JSON messages */
    }
  }, [lastMessage, refresh]);

  const runAction = async (
    action: (id: string, zid: string) => ReturnType<typeof acceptGuestPass>,
    passId: string,
  ) => {
    setBusyId(passId);
    setActionError("");
    const res = await action(passId, normalizedZoneId);
    setBusyId(null);
    if (res.error) {
      setActionError(res.error);
      return;
    }
    void refresh();
  };

  if (!normalizedZoneId) return null;

  const canToggle = passes.length > COLLAPSED_COUNT;
  const visible = expanded ? passes : passes.slice(0, COLLAPSED_COUNT);
  const hiddenCount = passes.length - visible.length;

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-white">
            Guest pass requests
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-slate-500">
            All guest passes for this zone. Accept, reject, or revoke as needed.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-700/80 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-300 transition hover:border-[#00E5D1]/40 hover:text-[#00E5D1] disabled:opacity-60"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
          />
          Refresh
        </button>
      </div>

      {listError && (
        <div className="mt-3 flex flex-wrap gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>{listError}</span>
        </div>
      )}

      {actionError && (
        <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
          {actionError}
        </div>
      )}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {passes.length === 0 && !loading && (
          <p className="text-sm text-slate-500">No guest pass requests yet.</p>
        )}

        {visible.map((pass) => {
          const expired = isExpired(pass);
          const showAcceptReject =
            pass.status === "PENDING" && !expired && isAdmin;
          const showRevoke = pass.status === "ACCEPTED" && !expired && isAdmin;

          return (
            <article
              key={pass.id}
              className="rounded-2xl border border-slate-800/90 bg-[#151a20]/95 p-4 shadow-inner"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
                <div>
                  <p className="font-mono text-sm font-semibold text-[#00E5D1]">
                    {pass.event_id}
                  </p>
                  {pass.guest_name && (
                    <p className="text-xs text-slate-300">{pass.guest_name}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em]">
                  <span
                    className={`rounded-full px-2 py-0.5 ${statusBadge(pass.status)}`}
                  >
                    {pass.status}
                  </span>
                  {expired && (
                    <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-rose-300 ring-1 ring-rose-500/30">
                      Expired
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-3 space-y-1 text-xs text-slate-400">
                {pass.notes && <p className="text-slate-300">{pass.notes}</p>}
                {pass.requested_by_name && (
                  <p>
                    Requested by:{" "}
                    <span className="text-slate-200">
                      {pass.requested_by_name}
                    </span>
                  </p>
                )}
                <p>
                  Expires:{" "}
                  <span className="font-mono text-slate-300">
                    {formatDate(pass.expires_at)}
                  </span>
                </p>
                {pass.used_by_guest_id && (
                  <p className="text-amber-300">Already used</p>
                )}
              </div>

              <div className="mt-3 font-mono text-[10px] text-slate-600">
                Ref · {pass.id}
              </div>

              {showAcceptReject && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busyId === pass.id}
                    onClick={() => void runAction(acceptGuestPass, pass.id)}
                    className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-500/90 px-3 py-2 text-xs font-bold text-emerald-950 transition hover:brightness-110 disabled:opacity-50 sm:flex-none"
                  >
                    <Check className="h-3.5 w-3.5" /> Accept
                  </button>
                  <button
                    type="button"
                    disabled={busyId === pass.id}
                    onClick={() => void runAction(rejectGuestPass, pass.id)}
                    className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-rose-500/90 px-3 py-2 text-xs font-bold text-rose-50 transition hover:brightness-110 disabled:opacity-50 sm:flex-none"
                  >
                    <X className="h-3.5 w-3.5" /> Reject
                  </button>
                </div>
              )}

              {showRevoke && (
                <div className="mt-4">
                  <button
                    type="button"
                    disabled={busyId === pass.id}
                    onClick={() => void runAction(revokeGuestPass, pass.id)}
                    className="inline-flex items-center gap-1 rounded-lg bg-amber-500/90 px-3 py-2 text-xs font-bold text-amber-950 transition hover:brightness-110 disabled:opacity-50"
                  >
                    <Ban className="h-3.5 w-3.5" /> Revoke
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {canToggle && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-300 transition hover:border-[#00E5D1]/40 hover:text-[#00E5D1]"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" /> Show less
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" /> Show more ({hiddenCount}
                )
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
