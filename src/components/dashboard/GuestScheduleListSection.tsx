import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";
import {
  acceptMessageFeatureAccessSchedule,
  listMessageFeatureAccessSchedules,
  rejectMessageFeatureAccessSchedule,
  revokeMessageFeatureAccessSchedule,
  type MessageFeatureAccessSchedule,
  type MessageFeatureAccessScheduleStatus,
} from "../../services/api/messageFeature";

type Props = { zoneId: string; isAdmin: boolean };

function isEnded(item: MessageFeatureAccessSchedule): boolean {
  if (!item.ends_at) return false;
  const t = new Date(item.ends_at).getTime();
  return Number.isFinite(t) && t < Date.now();
}

function statusBadge(status: string) {
  switch (status) {
    case "PENDING":
      return "bg-[#FBEFD8] text-[#8A5A12] ring-1 ring-[#E0992A]/30";
    case "ACCEPTED":
      return "bg-[#E3F4E8] text-[#1F7A37] ring-1 ring-[#2FA24A]/30";
    case "ENDED":
      return "bg-[#FCE7EA] text-[#E23B4E] ring-1 ring-[#E23B4E]/30";
    case "REJECTED":
    case "REVOKED":
      return "bg-[#EDF3FB] text-[#8694AC] ring-1 ring-[#DCE6F2]";
    default:
      return "bg-[#EDF3FB] text-[#8694AC] ring-1 ring-[#DCE6F2]";
  }
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "open";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function GuestScheduleListSection({ zoneId, isAdmin }: Props) {
  const normalizedZoneId = zoneId.trim();
  const [rows, setRows] = useState<MessageFeatureAccessSchedule[]>([]);
  const [listError, setListError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const refresh = useCallback(async () => {
    if (!normalizedZoneId) return;
    setLoading(true);
    setListError("");
    const res = await listMessageFeatureAccessSchedules(normalizedZoneId);
    setLoading(false);
    if (res.error) {
      setListError(res.error);
      setRows([]);
      return;
    }
    setRows(Array.isArray(res.data) ? res.data : []);
  }, [normalizedZoneId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (
    action: "accept" | "reject" | "revoke",
    id: number | string,
  ) => {
    setBusyId(String(id));
    setActionError("");
    const fn =
      action === "accept"
        ? acceptMessageFeatureAccessSchedule
        : action === "reject"
          ? rejectMessageFeatureAccessSchedule
          : revokeMessageFeatureAccessSchedule;
    const res = await fn(id);
    setBusyId(null);
    if (res.error) {
      setActionError(res.error);
      return;
    }
    void refresh();
  };

  if (!normalizedZoneId) return null;

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-[#0F2C5C]">
            Guest schedules
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-[#8694AC]">
            Expected guest windows. Administrators accept, reject, or revoke.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-[#DCE6F2] px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#566784] transition hover:border-[#2F80ED]/40 hover:text-[#2F80ED] disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {listError && (
        <div className="mt-3 flex flex-wrap gap-2 rounded-lg border border-[#E0992A]/30 bg-[#FBEFD8] px-3 py-2 text-xs text-[#8A5A12]">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>{listError}</span>
        </div>
      )}
      {actionError && (
        <div className="mt-3 rounded-lg border border-[#E23B4E]/30 bg-[#FCE7EA] px-3 py-2 text-xs text-[#E23B4E]">
          {actionError}
        </div>
      )}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {rows.length === 0 && !loading && (
          <p className="text-sm text-[#8694AC]">No schedules yet.</p>
        )}
        {rows.map((item) => {
          const status = String(
            item.status || (item.active ? "ACCEPTED" : "PENDING"),
          ).toUpperCase() as MessageFeatureAccessScheduleStatus;
          const ended = isEnded(item);
          const display = ended && status === "ACCEPTED" ? "ENDED" : status;
          const title =
            item.guest_name?.trim() ||
            item.event_id ||
            (item.guest_id ? `Guest ${String(item.guest_id).slice(0, 10)}` : "Schedule");
          const busy = busyId === String(item.id);

          return (
            <article
              key={String(item.id)}
              className="rounded-2xl border border-[#DCE6F2] bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DCE6F2] pb-2">
                <p className="text-sm font-semibold text-[#0F2C5C]">{title}</p>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] ${statusBadge(display)}`}
                >
                  {display}
                </span>
              </div>
              <p className="mt-3 text-xs text-[#8694AC]">
                {formatDate(item.starts_at)} → {formatDate(item.ends_at)}
              </p>
              {item.event_id ? (
                <p className="mt-1 font-mono text-xs text-[#2F80ED]">{item.event_id}</p>
              ) : null}

              {isAdmin && status === "PENDING" ? (
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run("accept", item.id)}
                    className="rounded-lg bg-[#2F80ED] px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run("reject", item.id)}
                    className="rounded-lg bg-[#E23B4E] px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              ) : null}

              {isAdmin && status === "ACCEPTED" && !ended ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run("revoke", item.id)}
                  className="mt-4 rounded-lg border border-[#DCE6F2] px-3 py-2 text-xs font-bold text-[#566784] disabled:opacity-50"
                >
                  Revoke
                </button>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
