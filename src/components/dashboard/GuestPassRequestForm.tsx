import { useState } from "react";
import { Loader2, Send, CheckCircle2 } from "lucide-react";
import { createGuestPass } from "../../services/api/guestPasses";

type Props = { zoneId: string };

function tomorrowLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function GuestPassRequestForm({ zoneId }: Props) {
  const [eventId, setEventId] = useState("");
  const [guestName, setGuestName] = useState("");
  const [notes, setNotes] = useState("");
  const [expiresAt, setExpiresAt] = useState(tomorrowLocal);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successEventId, setSuccessEventId] = useState("");

  const validate = (): string | null => {
    if (!eventId.trim()) return "Event ID is required.";
    if (!expiresAt) return "Expiry date is required.";
    if (new Date(expiresAt) <= new Date()) return "Expiry must be in the future.";
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessEventId("");
    const validationErr = validate();
    if (validationErr) {
      setError(validationErr);
      return;
    }
    setSubmitting(true);
    const res = await createGuestPass({
      zone_id: zoneId,
      event_id: eventId.trim(),
      ...(guestName.trim() ? { guest_name: guestName.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      expires_at: new Date(expiresAt).toISOString(),
    });
    setSubmitting(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    const createdId = res.data?.event_id ?? eventId.trim();
    setSuccessEventId(createdId);
    setEventId("");
    setGuestName("");
    setNotes("");
    setExpiresAt(tomorrowLocal());
  };

  const inputCls =
    "w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm text-[#0F2C5C] placeholder:text-[#8694AC] focus:border-[#2F80ED]/60 focus:outline-none focus:ring-1 focus:ring-[#2F80ED]/25";
  const labelCls =
    "mb-1 block text-[11px] font-bold uppercase tracking-[0.15em] text-[#566784]";

  return (
    <div className="mx-auto max-w-7xl">
      <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-[#0F2C5C]">
        Request guest pass
      </h2>
      <p className="mt-1 max-w-2xl text-xs text-[#8694AC]">
        Create a guest pass with an Event ID that you share with your guest.
        When they arrive, they enter this ID to gain pre-approved access.
      </p>

      {successEventId && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-[#2FA24A]/30 bg-[#E3F4E8] px-3 py-2.5 text-xs text-[#2FA24A]">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#2FA24A]" />
          <span>
            Guest pass created! Share this Event ID with your guest:{" "}
            <span className="font-mono font-semibold text-[#2F80ED]">
              {successEventId}
            </span>
          </span>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-[#E23B4E]/30 bg-[#FCE7EA] px-3 py-2 text-xs text-[#E23B4E]">
          {error}
        </div>
      )}

      <form onSubmit={(e) => void handleSubmit(e)} className="mt-5 space-y-4">
        <div>
          <label className={labelCls} htmlFor="gp-event-id">
            Event ID <span className="text-[#E23B4E]">*</span>
          </label>
          <input
            id="gp-event-id"
            type="text"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            placeholder="EVT-2026-GALA"
            className={inputCls}
          />
        </div>

        <div>
          <label className={labelCls} htmlFor="gp-guest-name">
            Guest name
          </label>
          <input
            id="gp-guest-name"
            type="text"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            placeholder="Jone Doe"
            className={inputCls}
          />
        </div>

        <div>
          <label className={labelCls} htmlFor="gp-notes">
            Notes
          </label>
          <textarea
            id="gp-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Birthday party guest"
            rows={2}
            className={inputCls + " resize-none"}
          />
        </div>

        <div>
          <label className={labelCls} htmlFor="gp-expires">
            Expires at <span className="text-[#E23B4E]">*</span>
          </label>
          <input
            id="gp-expires"
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className={inputCls}
          />
        </div>

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
          Request Guest Pass
        </button>
      </form>
    </div>
  );
}
