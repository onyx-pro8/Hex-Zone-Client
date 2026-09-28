import { useState } from "react";
import { Loader2, Send, CheckCircle2 } from "lucide-react";
import { createMessageFeatureAccessSchedule } from "../../services/api/messageFeature";

type Props = { zoneId: string; isAdmin: boolean };

const QUICK_WINDOWS: { label: string; hours: number }[] = [
  { label: "Next 1 h", hours: 1 },
  { label: "Next 4 h", hours: 4 },
  { label: "Next 24 h", hours: 24 },
];

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isoNow(offsetHours = 0): Date {
  const d = new Date();
  d.setHours(d.getHours() + offsetHours);
  return d;
}

export function GuestScheduleRequestForm({ zoneId, isAdmin }: Props) {
  const [guestName, setGuestName] = useState("");
  const [eventId, setEventId] = useState("");
  const [guestId, setGuestId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [notifyAssist, setNotifyAssist] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const applyQuickWindow = (hours: number) => {
    setStartsAt(toLocalInput(isoNow(0)));
    setEndsAt(toLocalInput(isoNow(hours)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (!zoneId.trim()) {
      setError("No network ID found on your account.");
      return;
    }
    setSubmitting(true);
    const res = await createMessageFeatureAccessSchedule({
      zone_id: zoneId,
      guest_name: guestName.trim() || undefined,
      event_id: eventId.trim() || undefined,
      guest_id: guestId.trim() || undefined,
      starts_at: startsAt.trim() ? new Date(startsAt).toISOString() : undefined,
      ends_at: endsAt.trim() ? new Date(endsAt).toISOString() : undefined,
      notify_member_assist: notifyAssist,
    });
    setSubmitting(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    const status = String(res.data?.status ?? "").toUpperCase();
    setSuccess(
      status === "PENDING"
        ? "Schedule submitted — waiting for admin approval."
        : "Schedule approved and active.",
    );
    setGuestName("");
    setEventId("");
    setGuestId("");
    setStartsAt("");
    setEndsAt("");
    setNotifyAssist(false);
  };

  const inputCls =
    "w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm text-[#0F2C5C] placeholder:text-[#8694AC] focus:border-[#2F80ED]/60 focus:outline-none focus:ring-1 focus:ring-[#2F80ED]/25";
  const labelCls =
    "mb-1 block text-[11px] font-bold uppercase tracking-[0.15em] text-[#566784]";

  return (
    <div className="mx-auto max-w-7xl">
      <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-[#0F2C5C]">
        New schedule request
      </h2>
      <p className="mt-1 max-w-2xl text-xs text-[#8694AC]">
        {isAdmin
          ? "Expected guest windows. Saving as an administrator activates the schedule immediately."
          : "Submissions stay pending until a network administrator accepts them."}
      </p>

      {success && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-[#2FA24A]/30 bg-[#E3F4E8] px-3 py-2.5 text-xs text-[#2FA24A]">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-[#E23B4E]/30 bg-[#FCE7EA] px-3 py-2 text-xs text-[#E23B4E]">
          {error}
        </div>
      )}

      <form onSubmit={(e) => void handleSubmit(e)} className="mt-5 space-y-4">
        <div>
          <label className={labelCls} htmlFor="gs-guest-name">
            Guest name
          </label>
          <input
            id="gs-guest-name"
            type="text"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            placeholder="Optional"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="gs-event-id">
            Event ID
          </label>
          <input
            id="gs-event-id"
            type="text"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            placeholder="EVT-1234"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="gs-guest-id">
            Guest ID
          </label>
          <input
            id="gs-guest-id"
            type="text"
            value={guestId}
            onChange={(e) => setGuestId(e.target.value)}
            placeholder="Optional opaque guest UUID"
            className={inputCls}
          />
        </div>
        <div>
          <span className={labelCls}>Window</span>
          <div className="mb-2 flex flex-wrap gap-2">
            {QUICK_WINDOWS.map((w) => (
              <button
                key={w.hours}
                type="button"
                onClick={() => applyQuickWindow(w.hours)}
                className="rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-1.5 text-xs font-semibold text-[#566784] hover:border-[#2F80ED]/40 hover:text-[#2F80ED]"
              >
                {w.label}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="gs-starts">
                Starts at
              </label>
              <input
                id="gs-starts"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="gs-ends">
                Ends at
              </label>
              <input
                id="gs-ends"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
        </div>
        <label className="flex items-center justify-between gap-3 text-sm text-[#0F2C5C]">
          Notify zone members on arrival
          <input
            type="checkbox"
            checked={notifyAssist}
            onChange={(e) => setNotifyAssist(e.target.checked)}
            className="h-4 w-4 accent-[#2F80ED]"
          />
        </label>
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center gap-2 rounded-lg bg-[#2F80ED] px-4 py-2.5 text-xs font-bold uppercase tracking-[0.12em] text-white transition hover:brightness-110 disabled:opacity-60"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          {isAdmin ? "Save schedule" : "Submit for approval"}
        </button>
      </form>
    </div>
  );
}
