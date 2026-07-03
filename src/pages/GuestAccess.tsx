import {
  FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import { consumeGuestAuthExpiredNoticeFlash } from "../lib/guestSessionAuthRedirect";
import {
  CheckCircle,
  Loader2,
  MapPin,
  ShieldAlert,
  QrCode,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { resolveGuestBrowserDeviceId } from "../lib/guestDeviceId";
import {
  mapGuestAccessErrorCode,
  pollGuestAccessSession,
  submitAnonymousGuestPermission,
} from "../services/api/accessPermissions";
import {
  exchangeGuestSession,
  persistGuestSessionAfterExchange,
} from "../services/api/guestSession";

type Phase =
  | { id: "form" }
  | { id: "expected"; message: string }
  | {
      id: "waiting";
      guestId: string;
      /** Zone passed as `zone_id` when polling `/api/access/session/…` (URL `zid` or permission echo). */
      pollZoneId: string;
      serverMessage: string;
      pollMessage?: string;
    }
  | {
      id: "approved";
      message?: string;
      guestId: string;
      pollZoneId: string;
      exchange_code?: string;
      exchange_expires_at?: string;
      /** Poll errors while waiting for `exchange_code` from backend. */
      pollMessage?: string;
    }
  | { id: "rejected"; message?: string };

const POLL_MS = 3500;

const SESSION_WAIT_KEY = "zoneweaver_guest_access_wait";

type StoredWaitPayload = {
  v: 1;
  gt: string;
  zid: string;
  guestId: string;
  serverMessage: string;
  /** Required for session poll when `gt`-only links omit URL `zid`. */
  pollZoneId?: string;
};

function readStoredWait(gt: string, zid: string): StoredWaitPayload | null {
  try {
    const raw = sessionStorage.getItem(SESSION_WAIT_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as StoredWaitPayload;
    if (p.v !== 1 || typeof p.guestId !== "string" || !p.guestId.trim()) {
      return null;
    }
    if ((p.gt ?? "") !== gt || (p.zid ?? "") !== zid) {
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

function writeStoredWait(payload: Omit<StoredWaitPayload, "v"> & { v?: 1 }) {
  const pid = payload.pollZoneId?.trim();
  const full: StoredWaitPayload = {
    v: 1,
    gt: payload.gt ?? "",
    zid: payload.zid ?? "",
    guestId: payload.guestId,
    serverMessage: payload.serverMessage ?? "",
    ...(pid ? { pollZoneId: pid } : {}),
  };
  sessionStorage.setItem(SESSION_WAIT_KEY, JSON.stringify(full));
}

function resolvedPollZoneId(stored: StoredWaitPayload): string {
  const fromField = stored.pollZoneId?.trim();
  if (fromField) return fromField;
  return (stored.zid ?? "").trim();
}

function clearStoredWait() {
  try {
    sessionStorage.removeItem(SESSION_WAIT_KEY);
  } catch {
    /* ignore */
  }
}

function formatError(err: { errorCode?: string; message: string }): string {
  return mapGuestAccessErrorCode(err.errorCode, err.message);
}

/** Avoid showing the same line twice when submit + poll return identical `message`. */
function pollMessageIfDistinct(
  primary: string | undefined,
  poll: string | undefined,
): string | undefined {
  const p = poll?.trim();
  if (!p) return undefined;
  const base = primary?.trim();
  if (base && p === base) return undefined;
  return p;
}

export default function GuestAccess() {
  const navigate = useNavigate();
  const [authExpiredNotice, setAuthExpiredNotice] = useState(false);
  const [searchParams] = useSearchParams();
  const zid = String(searchParams.get("zid") ?? "").trim();
  const nid = String(searchParams.get("nid") ?? "").trim();
  const gt = String(searchParams.get("gt") ?? "").trim();
  const eidFromQuery = String(searchParams.get("eid") ?? "").trim();
  const sigFromQuery = String(searchParams.get("sig") ?? "").trim();
  const hasInvite = Boolean(gt || zid || nid);

  const [guestName, setGuestName] = useState("");
  const [eventId, setEventId] = useState(eidFromQuery);
  const [deviceId, setDeviceId] = useState("");
  const [useAutoDeviceId, setUseAutoDeviceId] = useState(true);
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [locating, setLocating] = useState(false);

  const [phase, setPhase] = useState<Phase>({ id: "form" });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [exchangeBusy, setExchangeBusy] = useState(false);
  const [exchangeError, setExchangeError] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (consumeGuestAuthExpiredNoticeFlash()) {
      setAuthExpiredNotice(true);
    }
  }, []);

  useEffect(() => {
    setEventId(eidFromQuery);
  }, [eidFromQuery]);

  useLayoutEffect(() => {
    if (!hasInvite) return;
    const stored = readStoredWait(gt, zid);
    if (stored) {
      const pollZoneId = resolvedPollZoneId(stored);
      setPhase({
        id: "waiting",
        guestId: stored.guestId.trim(),
        pollZoneId,
        serverMessage: stored.serverMessage || "Waiting for approval…",
      });
    } else {
      setPhase((p) => (p.id === "waiting" ? { id: "form" } : p));
    }
  }, [hasInvite, gt, zid]);

  useEffect(() => {
    const shouldPoll =
      phase.id === "waiting" ||
      (phase.id === "approved" && !phase.exchange_code?.trim());
    if (!shouldPoll) return;

    const guestId =
      phase.id === "waiting"
        ? phase.guestId.trim()
        : phase.id === "approved"
          ? phase.guestId.trim()
          : "";
    if (!guestId) return;

    let alive = true;
    const pollZoneId =
      phase.id === "waiting"
        ? phase.pollZoneId.trim()
        : phase.id === "approved"
          ? phase.pollZoneId.trim()
          : "";

    const tick = async () => {
      const res = await pollGuestAccessSession(guestId, pollZoneId);
      if (!alive) return;
      if (res.error) {
        setPhase((p) =>
          p.id === "waiting"
            ? { ...p, pollMessage: res.error ?? undefined }
            : p.id === "approved" && !p.exchange_code
              ? { ...p, pollMessage: res.error ?? undefined }
              : p,
        );
        return;
      }
      if (res.status === "APPROVED") {
        clearStoredWait();
        setPhase((p) => {
          if (p.id === "waiting") {
            return {
              id: "approved",
              message: res.message,
              guestId: p.guestId,
              pollZoneId: p.pollZoneId,
              ...(res.exchange_code ? { exchange_code: res.exchange_code } : {}),
              ...(res.exchange_expires_at
                ? { exchange_expires_at: res.exchange_expires_at }
                : {}),
            };
          }
          if (p.id === "approved" && !p.exchange_code && res.exchange_code) {
            return {
              ...p,
              exchange_code: res.exchange_code,
              ...(res.exchange_expires_at
                ? { exchange_expires_at: res.exchange_expires_at }
                : {}),
            };
          }
          return p;
        });
        if (res.exchange_code) return;
        setPhase((p) =>
          p.id === "approved" && !p.exchange_code?.trim()
            ? {
                ...p,
                pollMessage:
                  "The server approved this visit but did not send a sign-in code (exchange_code). The guest app needs that field on the session response, or on the first permission response. Ask your host to update the API.",
              }
            : p,
        );
        return;
      }
      if (res.status === "REJECTED") {
        clearStoredWait();
        setPhase({ id: "rejected", message: res.message });
        return;
      }
      if (res.message) {
        setPhase((p) =>
          p.id === "waiting"
            ? { ...p, pollMessage: res.message }
            : p.id === "approved" && !p.exchange_code
              ? { ...p, pollMessage: res.message }
              : p,
        );
      }
    };

    void tick();
    const handle = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(handle);
    };
  }, [
    phase.id,
    phase.id === "waiting" ? phase.guestId : "",
    phase.id === "waiting" ? phase.pollZoneId : "",
    phase.id === "approved" && !phase.exchange_code?.trim() ? phase.guestId : "",
    phase.id === "approved" && !phase.exchange_code?.trim() ? phase.pollZoneId : "",
    phase.id === "approved" ? (phase.exchange_code ?? "").trim() : "",
  ]);

  const runGuestSessionExchange = useCallback(
    async (
      guestId: string,
      pollZoneId: string,
      exchangeCode: string,
      isCancelled?: () => boolean,
    ) => {
      const gid = guestId.trim();
      const z = pollZoneId.trim();
      const code = exchangeCode.trim();
      if (!gid || !z || !code) return false;
      setExchangeBusy(true);
      setExchangeError(null);
      const effectiveDevice = useAutoDeviceId
        ? resolveGuestBrowserDeviceId()
        : deviceId.trim() || undefined;
      const ex = await exchangeGuestSession({
        guest_id: gid,
        zone_id: z,
        exchange_code: code,
        ...(effectiveDevice ? { device_id: effectiveDevice } : {}),
      });
      if (isCancelled?.()) {
        setExchangeBusy(false);
        return false;
      }
      setExchangeBusy(false);
      if (ex.error || !ex.data) {
        setExchangeError(
          ex.error ??
            (ex.status === 404
              ? "Guest session API is not available yet (404). Ask your host to update the server."
              : "Could not start guest session."),
        );
        return false;
      }
      persistGuestSessionAfterExchange(ex.data, z);
      navigate("/guest/dashboard", { replace: true });
      return true;
    },
    [deviceId, navigate, useAutoDeviceId],
  );

  useEffect(() => {
    if (phase.id !== "approved") return;
    const code = phase.exchange_code?.trim();
    if (!code) return;
    const gid = phase.guestId.trim();
    const z = phase.pollZoneId.trim();
    if (!gid || !z) return;

    let cancelled = false;
    void runGuestSessionExchange(gid, z, code, () => cancelled);

    return () => {
      cancelled = true;
    };
  }, [
    phase.id,
    phase.id === "approved" ? phase.guestId : "",
    phase.id === "approved" ? phase.pollZoneId : "",
    phase.id === "approved" ? (phase.exchange_code ?? "").trim() : "",
    runGuestSessionExchange,
  ]);

  const captureLocation = () => {
    if (!navigator.geolocation) {
      setFormError("Location is not available in this browser.");
      return;
    }
    setLocating(true);
    setFormError(null);
    navigator.geolocation.getCurrentPosition(
      (next) => {
        setPosition({
          lat: next.coords.latitude,
          lng: next.coords.longitude,
        });
        setLocating(false);
      },
      () => {
        setLocating(false);
        setFormError("Could not read your location. You can still continue.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!gt && !zid && !nid) {
      setFormError("This link is missing a guest token or network id.");
      return;
    }
    const name = guestName.trim();
    if (!name) {
      setFormError("Please enter your name.");
      return;
    }
    setSubmitting(true);
    setFormError(null);

    const effectiveDevice = useAutoDeviceId
      ? resolveGuestBrowserDeviceId()
      : deviceId.trim() || undefined;

    const body: Parameters<typeof submitAnonymousGuestPermission>[0] = {
      guest_name: name,
      ...(gt ? { guest_qr_token: gt } : {}),
      ...(zid ? { zone_id: zid } : {}),
      ...(nid ? { network_id: nid } : {}),
      ...(eventId.trim() ? { event_id: eventId.trim() } : {}),
      ...(effectiveDevice ? { device_id: effectiveDevice } : {}),
      ...(position
        ? { location: { lat: position.lat, lng: position.lng } }
        : {}),
      ...(sigFromQuery ? { sig: sigFromQuery } : {}),
    };

    const result = await submitAnonymousGuestPermission(body);
    setSubmitting(false);

    if (!result.ok) {
      setFormError(formatError(result));
      return;
    }

    if (result.status === "EXPECTED") {
      const expectedGuestId = result.guestId?.trim();
      const expectedPollZone = (result.zoneId ?? zid ?? nid).trim();
      if (expectedGuestId && expectedPollZone) {
        clearStoredWait();
        setPhase({
          id: "approved",
          message: result.message || "You are expected — access granted.",
          guestId: expectedGuestId,
          pollZoneId: expectedPollZone,
          ...(result.exchange_code?.trim()
            ? { exchange_code: result.exchange_code.trim() }
            : {}),
          ...(result.exchange_expires_at?.trim()
            ? { exchange_expires_at: result.exchange_expires_at.trim() }
            : {}),
        });
      } else {
        setPhase({ id: "expected", message: result.message });
      }
      return;
    }

    const gid = result.guestId?.trim();
    if (!gid) {
      setFormError(
        "This visit requires approval, but the server did not return a guest session id for polling. Please contact your host.",
      );
      return;
    }
    const pollZoneId = (result.zoneId ?? zid ?? nid).trim();
    writeStoredWait({
      gt,
      zid,
      guestId: gid,
      pollZoneId,
      serverMessage: result.message ?? "Waiting for approval…",
    });
    setPhase({
      id: "waiting",
      guestId: gid,
      pollZoneId,
      serverMessage: result.message || "Waiting for approval…",
    });
  };

  const reset = () => {
    clearStoredWait();
    setPhase({ id: "form" });
    setFormError(null);
    setExchangeError(null);
    setExchangeBusy(false);
  };

  const handleContinueToGuestApp = async () => {
    if (phase.id !== "approved" || !phase.exchange_code?.trim()) return;
    await runGuestSessionExchange(
      phase.guestId.trim(),
      phase.pollZoneId.trim(),
      phase.exchange_code.trim(),
    );
  };

  if (!hasInvite) {
    return (
      <section className="mx-auto max-w-lg space-y-4 rounded-3xl border border-[#DCE6F2] bg-white p-6">
        {authExpiredNotice ? (
          <p
            role="status"
            className="rounded-md border border-[#E0992A]/30 bg-[#FBEFD8] px-3 py-2 text-sm text-[#E0992A]"
          >
            Your access was revoked or expired. Sign in again.
          </p>
        ) : null}
        <p className="inline-flex items-center gap-2 rounded-full bg-[#FBEFD8] px-3 py-1 text-xs font-semibold text-[#E0992A]">
          <QrCode className="h-4 w-4" /> Guest access
        </p>
        <h1 className="text-xl font-semibold text-[#0F2C5C]">Invalid link</h1>
        <p className="text-sm text-[#8694AC]">
          Ask your host for a guest link that includes an invitation token (
          <span className="font-mono text-[#566784]">gt</span>) or a network id (
          <span className="font-mono text-[#566784]">zid</span>).
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-lg space-y-5 rounded-3xl border border-[#DCE6F2] bg-white p-6">
      <header className="space-y-2">
        <p className="inline-flex items-center gap-2 rounded-full bg-[#EDF3FB] px-3 py-1 text-xs font-semibold tracking-[0.14em] text-[#2F80ED]">
          <QrCode className="h-4 w-4" /> Guest access
        </p>
        <h1 className="text-2xl font-semibold text-[#0F2C5C]">Check in</h1>
        <p className="text-sm text-[#8694AC]">
          {gt ? (
            <>
              Invitation link{" "}
              <span className="font-mono text-[#8694AC]">(gt)</span>
            </>
          ) : null}
          {gt && zid ? <span className="text-[#8694AC]"> · </span> : null}
          {zid ? (
            <>
              Zone{" "}
              <span className="font-mono text-[#2F80ED]" title={zid}>
                {zid.length > 36 ? `${zid.slice(0, 18)}…` : zid}
              </span>
            </>
          ) : null}
        </p>
      </header>

      {authExpiredNotice ? (
        <p
          role="status"
          className="rounded-md border border-[#E0992A]/30 bg-[#FBEFD8] px-3 py-2 text-sm text-[#E0992A]"
        >
          Your access was revoked or expired. Sign in again.
        </p>
      ) : null}

      {phase.id === "form" && (
        <form onSubmit={(ev) => void handleSubmit(ev)} className="space-y-4">
          <div>
            <label
              htmlFor="ga-name"
              className="mb-1 block text-xs uppercase tracking-[0.16em] text-[#8694AC]"
            >
              Your name (required)
            </label>
            <input
              id="ga-name"
              value={guestName}
              onChange={(ev) => setGuestName(ev.target.value)}
              autoComplete="name"
              className="w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm text-[#0F2C5C]"
              required
            />
          </div>

          <div>
            <label
              htmlFor="ga-event"
              className="mb-1 block text-xs uppercase tracking-[0.16em] text-[#8694AC]"
            >
              Event id (optional)
            </label>
            <input
              id="ga-event"
              value={eventId}
              onChange={(ev) => setEventId(ev.target.value)}
              disabled={Boolean(eidFromQuery)}
              className="w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm text-[#0F2C5C] disabled:opacity-70"
              placeholder={eidFromQuery ? "Set from link" : "e.g. EVT-2026-GALA"}
            />
          </div>

          <div className="rounded-md border border-[#DCE6F2] bg-[#F7FAFE] p-3 text-xs text-[#8694AC]">
            <label className="flex cursor-pointer items-center gap-2 text-[#566784]">
              <input
                type="checkbox"
                checked={useAutoDeviceId}
                onChange={(ev) => setUseAutoDeviceId(ev.target.checked)}
                className="rounded border-[#DCE6F2]"
              />
              Attach anonymous device fingerprint (recommended)
            </label>
            {!useAutoDeviceId ? (
              <input
                value={deviceId}
                onChange={(ev) => setDeviceId(ev.target.value)}
                placeholder="Custom device id"
                className="mt-2 w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-2 py-1.5 font-mono text-[#566784]"
              />
            ) : null}
          </div>

          <div className="rounded-md border border-[#DCE6F2] bg-[#F7FAFE] p-3 text-xs text-[#8694AC]">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="font-semibold uppercase tracking-[0.16em] text-[#566784]">
                Location (optional)
              </p>
              <button
                type="button"
                onClick={captureLocation}
                disabled={locating}
                className="inline-flex items-center gap-1 rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-2 py-1 text-xs text-[#566784] disabled:opacity-60"
              >
                {locating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <MapPin className="h-3.5 w-3.5" />
                )}
                {locating ? "Reading…" : "Use current location"}
              </button>
            </div>
            {position ? (
              <p className="font-mono text-[11px] text-[#566784]">
                {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
              </p>
            ) : (
              <p>No location sent.</p>
            )}
          </div>

          {formError ? (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
              {formError}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-[#2F80ED] px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Submitting…" : "Request access"}
          </button>
        </form>
      )}

      {phase.id === "expected" && (
        <output className="block space-y-3 rounded-xl border border-[#2FA24A]/30 bg-[#E3F4E8] px-4 py-4 text-[#2FA24A]">
          <p className="flex items-center gap-2 text-lg font-semibold">
            <CheckCircle className="h-5 w-5 text-[#2FA24A]" /> You are expected
          </p>
          <p className="text-sm leading-relaxed text-[#2FA24A]">
            {phase.message}
          </p>
          <button
            type="button"
            onClick={reset}
            className="text-xs font-medium uppercase tracking-[0.14em] text-[#2FA24A] hover:underline"
          >
            Check in another guest
          </button>
        </output>
      )}

      {phase.id === "waiting" && (
        <output className="block space-y-3 rounded-xl border border-[#E0992A]/30 bg-[#FBEFD8] px-4 py-4">
          <p className="flex items-center gap-2 text-lg font-semibold text-[#E0992A]">
            <ShieldAlert className="h-5 w-5 text-[#E0992A]" /> Waiting for
            approval
          </p>
          <p className="text-sm text-[#566784]">{phase.serverMessage}</p>
          {(() => {
            const line = pollMessageIfDistinct(phase.serverMessage, phase.pollMessage);
            return line ? <p className="text-sm text-[#8694AC]">{line}</p> : null;
          })()}
          <div className="flex items-center gap-2 text-sm text-[#8694AC]">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Checking status…
          </div>
          <p className="break-all font-mono text-[10px] text-[#8694AC]">
            Reference: {phase.guestId}
          </p>
          <button
            type="button"
            onClick={reset}
            className="text-xs text-[#8694AC] underline hover:text-[#566784]"
          >
            Cancel and start over
          </button>
        </output>
      )}

      {phase.id === "approved" && (
        <div className="space-y-3 rounded-xl border border-[#2FA24A]/30 bg-[#E3F4E8] px-4 py-4 text-[#2FA24A]">
          <p className="text-lg font-semibold">Approved</p>
          {phase.message ? (
            <p className="text-sm leading-relaxed">{phase.message}</p>
          ) : (
            <p className="text-sm">Your host approved this visit.</p>
          )}

          {!phase.exchange_code?.trim() ? (
            <div className="space-y-2 rounded-lg border border-[#2FA24A]/30 bg-[#E3F4E8] px-3 py-3 text-sm text-[#2FA24A]">
              <p className="flex items-center gap-2 font-medium text-[#2FA24A]">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Finishing sign-in…
              </p>
              <p className="text-[#2FA24A]">
                Your visit is verified. This page will open the guest app as soon as the server
                provides a sign-in code. Keep it open for a few seconds.
              </p>
              {(() => {
                const line = pollMessageIfDistinct(phase.message, phase.pollMessage);
                return line ? (
                  <p className="font-mono text-[11px] text-[#2FA24A]">{line}</p>
                ) : null;
              })()}
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              {exchangeBusy ? (
                <p className="flex items-center gap-2 font-medium text-[#2FA24A]">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Opening guest dashboard…
                </p>
              ) : null}
              {phase.exchange_expires_at && !exchangeBusy ? (
                <p className="text-[#2FA24A]">
                  Sign-in code expires:{" "}
                  <span className="font-mono text-[#2FA24A]">
                    {new Date(phase.exchange_expires_at).toLocaleString()}
                  </span>
                </p>
              ) : null}
              {exchangeError ? (
                <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">
                  {exchangeError}
                </p>
              ) : null}
              <button
                type="button"
                disabled={exchangeBusy}
                onClick={() => void handleContinueToGuestApp()}
                className="w-full rounded-md bg-[#2F80ED] px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {exchangeBusy ? "Signing in…" : "Continue to guest dashboard"}
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={reset}
            className="text-xs font-medium uppercase tracking-[0.14em] text-[#2FA24A] hover:underline"
          >
            Dismiss / start over
          </button>
        </div>
      )}

      {phase.id === "rejected" && (
        <div className="space-y-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-4 text-rose-700">
          <p className="text-lg font-semibold">Not approved</p>
          {phase.message ? (
            <p className="text-sm">{phase.message}</p>
          ) : (
            <p className="text-sm">Your request was declined.</p>
          )}
          <button
            type="button"
            onClick={reset}
            className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-bold text-white"
          >
            Try again
          </button>
        </div>
      )}

    </section>
  );
}
