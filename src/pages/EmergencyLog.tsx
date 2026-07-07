import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, Siren } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import {
  listEmergencyEvents,
  type EmergencyEvent,
} from "../services/api/messageFeature";

type TypeFilter = "all" | "PANIC" | "NS_PANIC";

function typeLabel(type: string): string {
  return String(type || "").replace(/_/g, "-");
}

function isNsPanic(type: string): boolean {
  return String(type || "").toUpperCase().replace(/-/g, "_") === "NS_PANIC";
}

export default function EmergencyLog() {
  const { user } = useAuth();
  const isAdministrator =
    String(user?.role ?? "").toLowerCase() === "administrator";

  const [events, setEvents] = useState<EmergencyEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await listEmergencyEvents({
      limit: 200,
      type: typeFilter === "all" ? undefined : typeFilter,
    });
    if (result.error) {
      setError(result.error);
      setEvents([]);
    } else {
      setEvents(result.data ?? []);
    }
    setLoading(false);
  }, [typeFilter]);

  useEffect(() => {
    if (isAdministrator) void load();
  }, [isAdministrator, load]);

  if (!isAdministrator) {
    return (
      <section className="space-y-3">
        <h1 className="text-xl font-extrabold text-[#0F2C5C]">Emergency log</h1>
        <p className="rounded-xl border border-[#DCE6F2] bg-white px-4 py-3 text-sm text-[#566784]">
          Only administrators can view the emergency log.
        </p>
      </section>
    );
  }

  const filters: { id: TypeFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "PANIC", label: "PANIC" },
    { id: "NS_PANIC", label: "NS-PANIC" },
  ];

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#FCE7EA] text-[#E23B4E]">
            <Siren className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-extrabold text-[#0F2C5C]">
              Emergency log
            </h1>
            <p className="text-sm text-[#8694AC]">
              Forensic record of PANIC and NS-PANIC alarms.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-[#DCE6F2] bg-white px-3 py-2 text-sm font-semibold text-[#2F80ED] transition hover:bg-[#EDF3FB] disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setTypeFilter(f.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              typeFilter === f.id
                ? "bg-[#2F80ED] text-white"
                : "border border-[#DCE6F2] bg-white text-[#566784] hover:bg-[#EDF3FB]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="rounded-xl border border-[#F3C2CA] bg-[#FCE7EA] px-4 py-3 text-sm text-[#E23B4E]">
          {error}
        </p>
      ) : loading ? (
        <p className="rounded-xl border border-[#DCE6F2] bg-white px-4 py-3 text-sm text-[#566784]">
          Loading emergency events…
        </p>
      ) : events.length === 0 ? (
        <div className="rounded-xl border border-[#DCE6F2] bg-white px-4 py-10 text-center text-sm text-[#8694AC]">
          No emergency events recorded.
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((event) => {
            const nsPanic = isNsPanic(event.type);
            return (
              <article
                key={event.id}
                className={`rounded-2xl border bg-white p-4 shadow-sm ${
                  nsPanic ? "border-[#B5179E]/40" : "border-[#F3C2CA]"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-extrabold uppercase tracking-wide text-white ${
                      nsPanic ? "bg-[#B5179E]" : "bg-[#E23B4E]"
                    }`}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                    {typeLabel(event.type)}
                  </span>
                  <span className="text-xs text-[#8694AC]">
                    {new Date(event.createdAt).toLocaleString()}
                  </span>
                </div>
                {event.text ? (
                  <p className="mt-3 text-sm leading-relaxed text-[#0F2C5C]">
                    {event.text}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-[#566784]">
                  {event.senderId != null ? (
                    <span className="rounded-full bg-[#EDF3FB] px-2 py-1">
                      Sender {event.senderId}
                    </span>
                  ) : null}
                  {event.zoneId ? (
                    <span className="rounded-full bg-[#EDF3FB] px-2 py-1">
                      {event.zoneId}
                    </span>
                  ) : null}
                  <span className="rounded-full bg-[#EDF3FB] px-2 py-1">
                    Reached {event.recipientCount} member(s)
                  </span>
                  {event.latitude != null && event.longitude != null ? (
                    <a
                      className="rounded-full bg-[#EDF3FB] px-2 py-1 font-medium text-[#2F80ED] hover:underline"
                      href={`https://www.google.com/maps?q=${event.latitude},${event.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {event.latitude.toFixed(4)}, {event.longitude.toFixed(4)}
                    </a>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
