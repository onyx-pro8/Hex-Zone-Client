import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronUp, RefreshCw, Wrench } from "lucide-react";
import { useRecentServices } from "../../hooks/useRecentServices";
import { formatTopicPath } from "../../lib/servicePaTopics";
import type { Message } from "../../services/api/messages";

const COLLAPSED_COUNT = 3;

function serviceTitle(row: Message): string {
  const subject = row.subject?.trim();
  if (subject) return subject;
  const body = row.message?.trim();
  if (body) return body.length > 120 ? `${body.slice(0, 117)}…` : body;
  return "Service request";
}

function serviceMeta(row: Message): string {
  return (
    row.topic_label?.trim() ||
    formatTopicPath(row.topic, row.subtopic) ||
    row.relevant_zone_label?.trim() ||
    row.relevant_zone_network_id?.trim() ||
    row.zone_id ||
    "Zone"
  );
}

type Props = {
  zoneId: string;
};

export function RecentServicesDashboardSection({ zoneId }: Props) {
  const navigate = useNavigate();
  const normalizedZoneId = zoneId.trim();
  const { services, loading, error, refresh } = useRecentServices(normalizedZoneId);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setExpanded(false);
  }, [normalizedZoneId]);

  if (!normalizedZoneId) return null;

  const canToggle = services.length > COLLAPSED_COUNT;
  const visibleRows = expanded ? services : services.slice(0, COLLAPSED_COUNT);
  const hiddenCount = services.length - visibleRows.length;

  return (
    <section className="border-b border-[#DCE6F2] bg-[#FBEFD8]/40 px-4 py-4 sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-[#E0992A]" aria-hidden />
            <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-[#0F2C5C]">
              Recent services
            </h2>
          </div>
          <p className="mt-1 max-w-2xl text-xs text-[#8694AC]">
            Latest SERVICE broadcasts for this zone. Members publish these from Messages.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => navigate("/messages?type=SERVICE")}
            className="rounded-lg border border-[#F0DBB0] bg-[#FBEFD8] px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#E0992A] transition hover:brightness-95"
          >
            View all
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-[#DCE6F2] bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#566784] transition hover:border-[#2F80ED]/40 hover:text-[#2F80ED] disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <p className="mx-auto mt-3 max-w-7xl text-xs text-[#E0992A]">{error}</p>
      ) : null}

      <div className="mx-auto mt-4 grid max-w-7xl gap-3 lg:grid-cols-2">
        {services.length === 0 && !loading ? (
          <p className="text-sm text-[#8694AC]">
            No service messages yet. Publish one from Messages → SERVICES.
          </p>
        ) : null}
        {visibleRows.map((row) => (
          <article
            key={row.id}
            className="rounded-2xl border border-[#F0DBB0] bg-white p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#F0DBB0]/60 pb-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[#0F2C5C]">{serviceTitle(row)}</p>
                <p className="mt-0.5 text-[11px] text-[#8694AC]">
                  {row.created_at
                    ? new Date(row.created_at).toLocaleString()
                    : "Just now"}
                </p>
              </div>
              <span className="rounded-full bg-[#FBEFD8] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#E0992A] ring-1 ring-[#F0DBB0]">
                {serviceMeta(row)}
              </span>
            </div>
            {row.message && row.message !== row.subject ? (
              <p className="mt-3 text-sm leading-relaxed text-[#566784]">{row.message}</p>
            ) : null}
            <button
              type="button"
              onClick={() =>
                navigate(`/messages?type=SERVICE&message=${encodeURIComponent(row.id)}`)
              }
              className="mt-3 text-xs font-semibold text-[#2F80ED] hover:underline"
            >
              Open in Messages
            </button>
          </article>
        ))}
      </div>

      {canToggle ? (
        <div className="mx-auto mt-3 flex max-w-7xl justify-center">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-[#566784] transition hover:text-[#2F80ED]"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-4 w-4" />
                Show fewer
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4" />
                Show {hiddenCount} more
              </>
            )}
          </button>
        </div>
      ) : null}
    </section>
  );
}
