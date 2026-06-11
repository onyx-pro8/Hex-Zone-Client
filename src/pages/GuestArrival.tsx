import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  MapPin,
  QrCode,
  RefreshCw,
  CheckCircle,
  ShieldAlert,
} from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  buildGuestArrivalPermissionPayload,
  type GuestArrivalPosition,
} from "../lib/guestArrival";
import { resolveGuestBrowserDeviceId } from "../lib/guestDeviceId";
import {
  normalizeGuestPermissionResponse,
  pollGuestAccessSession,
  pollGuestApprovalStatus,
  requestGuestScanAuthToken,
  resolveMappedDeviceApiKey,
  submitGuestArrivalPermission,
  type GuestApprovalStatus,
} from "../services/api/accessPermissions";
import {
  exchangeGuestSession,
  persistGuestSessionAfterExchange,
} from "../services/api/guestSession";

type FeedbackTone = "neutral" | "success" | "warning" | "error";

type ArrivalPhase =
  | { id: "form" }
  | {
      id: "expected_ok";
      proceedLine: string;
      waitLine?: string;
      eventHint?: string;
    }
  | {
      id: "unexpected_pending";
      requestId?: string;
      /** GET `/api/access/session/{guest_id}` when present (same contract as `/access`). */
      pollGuestId?: string;
      pollZoneId?: string;
    }
  | {
      id: "awaiting_approval";
      requestId?: string;
      pollGuestId?: string;
      pollZoneId?: string;
    }
  | {
      id: "guest_dashboard_signin";
      guestId: string;
      pollZoneId: string;
      instructions?: string;
      exchange_code?: string;
      exchange_expires_at?: string;
      pollMessage?: string;
    }
  | {
      id: "approved";
      instructions?: string;
    }
  | {
      id: "rejected";
    };

const DEVICE_HID_STORAGE_KEY = "zoneweaver_device_hid";
const GUEST_HID_STORAGE_KEY = "zoneweaver_guest_hid";
const DEVICE_KEY_INVALID_MESSAGE =
  "Device key is invalid for this environment. Please re-sync device credentials.";
const SCAN_AUTH_REAUTH_MESSAGE =
  "Scan session expired. Please sign in again and rescan the guest QR code.";
const SCAN_AUTH_MISSING_MESSAGE =
  "Client error: missing scan auth header. Please update the app and retry.";
const REAUTH_PROMPT_MESSAGE =
  "Your scan authorization could not be refreshed. Please scan the guest QR again.";

const SESSION_POLL_MS = 3500;

const SESSION_APPROVED_NO_EXCHANGE_COPY =
  "The server approved this visit but did not send a sign-in code (exchange_code). The guest app needs that field on the session response, or on the permission response. Ask your host to update the API.";

function buildBrowserDerivedHid(): string {
  const seed = `${navigator.userAgent}|${navigator.language}|${navigator.platform}`;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  const suffix = hash.toString(36).toUpperCase().slice(0, 10).padEnd(10, "X");
  return `WEB-${suffix}`;
}

function resolveBrowserHid(): string {
  const knownHid = String(
    localStorage.getItem(DEVICE_HID_STORAGE_KEY) ??
      localStorage.getItem(GUEST_HID_STORAGE_KEY) ??
      "",
  ).trim();
  if (knownHid) return knownHid;
  const derived = buildBrowserDerivedHid();
  localStorage.setItem(GUEST_HID_STORAGE_KEY, derived);
  return derived;
}

function includesScheduleNotFound(value?: string): boolean {
  return /schedule[_\s-]?not[_\s-]?found/i.test(String(value ?? ""));
}

function includesNetworkFailure(value?: string): boolean {
  return /network|timeout|failed to fetch|connection/i.test(String(value ?? ""));
}

function hintFromTexts(...parts: Array<string | undefined>): string {
  const t = parts.find((text) => String(text ?? "").trim().length > 0);
  return t?.trim() ?? "";
}

function pickProceedWait(
  decision: ReturnType<typeof normalizeGuestPermissionResponse>,
): { proceed: string; wait?: string } {
  const dm = hintFromTexts(decision.waitCopy).toLowerCase();
  const proactive =
    /\b(wait|hold|stay|stay put|outside|remain|blocked|freeze)\b/i.test(dm);
  const waitLine = proactive ? hintFromTexts(decision.waitCopy) : undefined;
  const proceedFallback = proactive ? "" : hintFromTexts(decision.waitCopy, decision.proceedCopy);
  const proceed = hintFromTexts(
    decision.proceedCopy,
    !proceedFallback ? decision.waitCopy : undefined,
    "Please proceed to check in with your host.",
  );
  return { proceed: proceed || "Please proceed.", wait: waitLine };
}

function arrivalSessionGuestId(
  decision: ReturnType<typeof normalizeGuestPermissionResponse>,
): string {
  return (decision.guestId ?? decision.requestId ?? "").trim();
}

function arrivalSessionZoneId(
  decision: ReturnType<typeof normalizeGuestPermissionResponse>,
  fallbackZone: string,
): string {
  return (decision.zoneId ?? fallbackZone).trim();
}

export default function GuestArrival() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const toParam = String(searchParams.get("to") ?? "").trim();
  const tokenParam = String(searchParams.get("token") ?? "").trim();

  const [guestName, setGuestName] = useState("");
  const [eventId, setEventId] = useState("");
  const [phase, setPhase] = useState<ArrivalPhase>({ id: "form" });
  const [hid] = useState(() => resolveBrowserHid());

  const [position, setPosition] = useState<GuestArrivalPosition | null>(null);
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<{ text: string; tone: FeedbackTone } | null>(null);
  const [exchangeBusy, setExchangeBusy] = useState(false);
  const [exchangeError, setExchangeError] = useState<string | null>(null);

  const [scannedZoneId, setScannedZoneId] = useState("");
  const [scannedToken, setScannedToken] = useState("");

  const prevZoneTokenPair = useRef<string>("");

  useEffect(() => {
    const key = `${toParam}:${tokenParam}`;
    if (!toParam || !tokenParam) return;
    setScannedZoneId(toParam);
    setScannedToken(tokenParam);
    if (prevZoneTokenPair.current && prevZoneTokenPair.current !== key) {
      setPhase({ id: "form" });
      setGuestName("");
      setEventId("");
      setLocalError(null);
      setPosition(null);
    }
    prevZoneTokenPair.current = key;
  }, [toParam, tokenParam]);

  useEffect(() => {
    if ((!toParam || !tokenParam) && phase.id === "form") {
      navigate("/guest-arrival/scan", { replace: true });
    }
  }, [navigate, toParam, tokenParam, phase.id]);

  const effectiveZoneId = scannedZoneId || toParam;
  const effectiveToken = scannedToken || tokenParam;

  const captureLocation = () => {
    if (!navigator.geolocation) {
      setLocalError({
        text: "Location is not available on this browser.",
        tone: "warning",
      });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (next) => {
        setPosition({
          latitude: next.coords.latitude,
          longitude: next.coords.longitude,
        });
        setLocating(false);
      },
      () => {
        setLocating(false);
        setLocalError({
          text: "We could not read your location. You can still continue.",
          tone: "warning",
        });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };

  const mapPollToPhase = (status: GuestApprovalStatus) => {
    if (status === "APPROVED") {
      setPhase({
        id: "approved",
        instructions: "Your host approved your visit. Follow their directions on site.",
      });
    } else if (status === "REJECTED") {
      setPhase({ id: "rejected" });
    }
  };

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
      const device = resolveGuestBrowserDeviceId();
      const ex = await exchangeGuestSession({
        guest_id: gid,
        zone_id: z,
        exchange_code: code,
        ...(device ? { device_id: device } : {}),
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
    [navigate],
  );

  useEffect(() => {
    if (phase.id !== "awaiting_approval" && phase.id !== "unexpected_pending") return;
    const requestId = phase.requestId?.trim();
    if (!requestId) return;
    let alive = true;
    const step = async () => {
      const res = await pollGuestApprovalStatus(requestId);
      if (!alive || !res.data) return;
      if (res.data.status === "REJECTED") {
        setPhase({ id: "rejected" });
        return;
      }
      if (res.data.status !== "APPROVED") return;
      const gid = phase.pollGuestId?.trim() || requestId;
      const z = phase.pollZoneId?.trim() || effectiveZoneId.trim();
      if (gid && z) {
        setPhase({
          id: "guest_dashboard_signin",
          guestId: gid,
          pollZoneId: z,
          instructions: "Your host approved your visit. Opening the guest app…",
        });
      } else {
        mapPollToPhase(res.data.status);
      }
    };
    void step();
    const handle = window.setInterval(() => void step(), 9000);
    return () => {
      alive = false;
      window.clearInterval(handle);
    };
  }, [
    phase.id,
    phase.id === "awaiting_approval" || phase.id === "unexpected_pending"
      ? phase.requestId ?? ""
      : "",
    phase.id === "awaiting_approval" || phase.id === "unexpected_pending"
      ? phase.pollGuestId ?? ""
      : "",
    phase.id === "awaiting_approval" || phase.id === "unexpected_pending"
      ? phase.pollZoneId ?? ""
      : "",
    effectiveZoneId,
  ]);

  useEffect(() => {
    const shouldPoll =
      phase.id === "guest_dashboard_signin" && !phase.exchange_code?.trim();
    if (!shouldPoll) return;
    const guestId = phase.guestId.trim();
    const pollZoneId = phase.pollZoneId.trim();
    if (!guestId || !pollZoneId) return;

    let alive = true;
    const tick = async () => {
      const res = await pollGuestAccessSession(guestId, pollZoneId);
      if (!alive) return;
      if (res.error) {
        setPhase((p) =>
          p.id === "guest_dashboard_signin" && !p.exchange_code?.trim()
            ? { ...p, pollMessage: res.error ?? undefined }
            : p,
        );
        return;
      }
      if (res.status === "APPROVED") {
        setPhase((p) => {
          if (p.id !== "guest_dashboard_signin") return p;
          if (res.exchange_code) {
            return {
              ...p,
              exchange_code: res.exchange_code,
              ...(res.exchange_expires_at
                ? { exchange_expires_at: res.exchange_expires_at }
                : {}),
            };
          }
          return {
            ...p,
            pollMessage: SESSION_APPROVED_NO_EXCHANGE_COPY,
          };
        });
        return;
      }
      if (res.status === "REJECTED") {
        setPhase({ id: "rejected" });
        return;
      }
      if (res.message) {
        setPhase((p) =>
          p.id === "guest_dashboard_signin" && !p.exchange_code?.trim()
            ? { ...p, pollMessage: res.message }
            : p,
        );
      }
    };

    void tick();
    const handle = window.setInterval(() => void tick(), SESSION_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(handle);
    };
  }, [
    phase.id,
    phase.id === "guest_dashboard_signin" ? phase.guestId : "",
    phase.id === "guest_dashboard_signin" ? phase.pollZoneId : "",
    phase.id === "guest_dashboard_signin" ? (phase.exchange_code ?? "").trim() : "",
  ]);

  useEffect(() => {
    if (phase.id !== "guest_dashboard_signin") return;
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
    phase.id === "guest_dashboard_signin" ? phase.guestId : "",
    phase.id === "guest_dashboard_signin" ? phase.pollZoneId : "",
    phase.id === "guest_dashboard_signin" ? (phase.exchange_code ?? "").trim() : "",
    runGuestSessionExchange,
  ]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setLocalError(null);

    let payload;
    try {
      payload = buildGuestArrivalPermissionPayload({
        hid,
        to: effectiveZoneId,
        guestName,
        eventId: eventId.trim() || undefined,
        timestamp: new Date().toISOString(),
        position,
      });
    } catch (error) {
      setLocalError({
        text: error instanceof Error ? error.message : "Guest arrival payload is invalid.",
        tone: "error",
      });
      return;
    }
    const requiredToken = effectiveToken.trim();
    if (!requiredToken || !effectiveZoneId.trim()) {
      setLocalError({
        text: "Missing zone or QR token. Return to Scan QR.",
        tone: "error",
      });
      return;
    }

    const fallbackApiKey = resolveMappedDeviceApiKey();
    const submitWithHeaders = async (scanAuthToken?: string) =>
      submitGuestArrivalPermission(payload, {
        scanAuthToken,
        fallbackApiKey,
        idempotencyKey: requiredToken,
      });

    setSubmitting(true);
    let scanAuthToken = "";
    const scanAuthProbe = await requestGuestScanAuthToken({
      to: payload.to,
      token: requiredToken,
    });
    if (!scanAuthProbe.error && scanAuthProbe.data?.scanAuthToken) {
      scanAuthToken = scanAuthProbe.data.scanAuthToken.trim();
    }

    let result = await submitWithHeaders(scanAuthToken || undefined);

    if (result.errorCode === "INVALID_SCAN_AUTH") {
      const refreshed = await requestGuestScanAuthToken({
        to: payload.to,
        token: requiredToken,
      });
      const fresh = String(refreshed.data?.scanAuthToken ?? "").trim();
      if (!fresh) {
        setSubmitting(false);
        setLocalError({ text: REAUTH_PROMPT_MESSAGE, tone: "error" });
        return;
      }
      result = await submitWithHeaders(fresh);
      if (result.errorCode === "INVALID_SCAN_AUTH") {
        setSubmitting(false);
        setLocalError({ text: REAUTH_PROMPT_MESSAGE, tone: "error" });
        return;
      }
    }
    setSubmitting(false);

    if (result.error) {
      if (result.errorCode === "MISSING_SCAN_AUTH" || result.error === SCAN_AUTH_MISSING_MESSAGE) {
        setLocalError({ text: SCAN_AUTH_MISSING_MESSAGE, tone: "error" });
      } else if (result.error === SCAN_AUTH_REAUTH_MESSAGE) {
        setLocalError({ text: REAUTH_PROMPT_MESSAGE, tone: "error" });
      } else if (result.error === DEVICE_KEY_INVALID_MESSAGE) {
        setLocalError({ text: DEVICE_KEY_INVALID_MESSAGE, tone: "error" });
      } else if (includesScheduleNotFound(result.error)) {
        setLocalError({
          text: "Schedule not found: your host may need to create or update a guest pass.",
          tone: "warning",
        });
      } else if (includesNetworkFailure(result.error)) {
        setLocalError({
          text: "Network failure: we could not submit your arrival. Please retry.",
          tone: "error",
        });
      } else {
        setLocalError({ text: `Validation/API error: ${result.error}`, tone: "error" });
      }
      return;
    }

    const decision = result.data;
    if (!decision) {
      setLocalError({
        text: "Unexpected response from access permission service.",
        tone: "warning",
      });
      return;
    }

    const sessionGid = arrivalSessionGuestId(decision);
    const sessionZ = arrivalSessionZoneId(decision, effectiveZoneId);

    if (decision.expectation === "expected") {
      if (sessionGid && sessionZ) {
        setExchangeError(null);
        setPhase({
          id: "guest_dashboard_signin",
          guestId: sessionGid,
          pollZoneId: sessionZ,
          instructions:
            decision.nextInstructions?.trim() ||
            pickProceedWait(decision).proceed ||
            "You are expected — opening the guest app.",
          ...(decision.exchange_code?.trim()
            ? {
                exchange_code: decision.exchange_code.trim(),
                ...(decision.exchange_expires_at?.trim()
                  ? { exchange_expires_at: decision.exchange_expires_at.trim() }
                  : {}),
              }
            : {}),
        });
        return;
      }
      const { proceed, wait } = pickProceedWait(decision);
      setPhase({
        id: "expected_ok",
        proceedLine: proceed,
        waitLine: wait,
        eventHint: eventId.trim() || undefined,
      });
      return;
    }

    if (decision.approvalStatus === "APPROVED") {
      if (sessionGid && sessionZ) {
        setExchangeError(null);
        setPhase({
          id: "guest_dashboard_signin",
          guestId: sessionGid,
          pollZoneId: sessionZ,
          instructions:
            decision.nextInstructions ||
            "Access granted. Follow your host’s directions.",
          ...(decision.exchange_code?.trim()
            ? {
                exchange_code: decision.exchange_code.trim(),
                ...(decision.exchange_expires_at?.trim()
                  ? { exchange_expires_at: decision.exchange_expires_at.trim() }
                  : {}),
              }
            : {}),
        });
        return;
      }
      setPhase({
        id: "approved",
        instructions:
          decision.nextInstructions ||
          "Access granted. Follow your host’s directions.",
      });
      return;
    }
    if (decision.approvalStatus === "REJECTED") {
      setPhase({ id: "rejected" });
      return;
    }

    if (decision.approvalStatus === "PENDING" || decision.pollingNeeded) {
      setPhase({
        id: "awaiting_approval",
        requestId: decision.requestId,
        pollGuestId: sessionGid || decision.requestId?.trim() || undefined,
        pollZoneId: sessionZ || undefined,
      });
      return;
    }

    setPhase({
      id: "unexpected_pending",
      requestId: decision.requestId,
      pollGuestId: sessionGid || decision.requestId?.trim() || undefined,
      pollZoneId: sessionZ || undefined,
    });
  };

  const resetToForm = () => {
    setPhase({ id: "form" });
    setLocalError(null);
    setExchangeError(null);
    setExchangeBusy(false);
  };

  const handleContinueToGuestDashboard = () => {
    if (phase.id !== "guest_dashboard_signin" || !phase.exchange_code?.trim()) return;
    void runGuestSessionExchange(
      phase.guestId.trim(),
      phase.pollZoneId.trim(),
      phase.exchange_code.trim(),
    );
  };

  return (
    <section className="mx-auto max-w-3xl space-y-5 rounded-3xl border border-[#DCE6F2] bg-white p-6">
      <header className="space-y-2">
        <p className="inline-flex items-center gap-2 rounded-full bg-[#EDF3FB] px-3 py-1 text-xs font-semibold tracking-[0.14em] text-[#2F80ED]">
          <QrCode className="h-4 w-4" /> GUEST ARRIVAL
        </p>
        <h1 className="text-2xl font-semibold text-[#0F2C5C]">Guest info</h1>
        <p className="text-sm text-[#8694AC]">
          Zone <span className="font-mono text-[#2F80ED]">{effectiveZoneId || "—"}</span>
        </p>
        <div className="flex flex-wrap gap-2 text-xs">
          <Link
            to="/guest-arrival/scan"
            className="rounded-md border border-[#DCE6F2] px-2 py-1 text-[#566784] hover:border-[#2F80ED]/50 hover:text-[#0F2C5C]"
          >
            Back to Scan QR
          </Link>
        </div>
      </header>

      {phase.id === "form" && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="guest-name"
              className="mb-1 block text-xs uppercase tracking-[0.16em] text-[#8694AC]"
            >
              Guest name (required)
            </label>
            <input
              id="guest-name"
              value={guestName}
              onChange={(event) => setGuestName(event.target.value)}
              placeholder="Jordan Rivera"
              className="w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm text-[#0F2C5C]"
              required
            />
          </div>

          <div>
            <label
              htmlFor="guest-event-id"
              className="mb-1 block text-xs uppercase tracking-[0.16em] text-[#8694AC]"
            >
              Event ID (optional)
            </label>
            <input
              id="guest-event-id"
              value={eventId}
              onChange={(event) => setEventId(event.target.value)}
              placeholder="EVT-2026-GALA"
              className="w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm text-[#0F2C5C]"
            />
          </div>

          <div className="rounded-md border border-[#DCE6F2] bg-[#F7FAFE] p-3 text-xs text-[#8694AC]">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="font-semibold uppercase tracking-[0.16em] text-[#566784]">
                Position (optional)
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
              <p>
                latitude: {position.latitude.toFixed(6)} / longitude: {position.longitude.toFixed(6)}
              </p>
            ) : (
              <p>No position attached.</p>
            )}
          </div>

          {localError && (
            <p
              className={`rounded-md border px-3 py-2 text-sm ${
                localError.tone === "success"
                  ? "border-[#2FA24A]/30 bg-[#E3F4E8] text-[#2FA24A]"
                  : localError.tone === "warning"
                    ? "border-[#E0992A]/30 bg-[#FBEFD8] text-[#E0992A]"
                    : localError.tone === "error"
                      ? "border-rose-200 bg-rose-50 text-rose-600"
                      : "border-[#DCE6F2] bg-[#F7FAFE] text-[#566784]"
              }`}
            >
              {localError.text}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-[#2F80ED] px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Submitting…" : "I have arrived"}
          </button>
        </form>
      )}

      {(phase.id === "expected_ok" ||
        phase.id === "unexpected_pending" ||
        phase.id === "awaiting_approval") && (
        <output className="block space-y-3 rounded-xl border border-[#DCE6F2] bg-[#F7FAFE] px-4 py-4">
          {phase.id === "expected_ok" ? (
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-lg font-semibold text-[#2FA24A]">
                <CheckCircle className="h-5 w-5 text-[#2FA24A]" /> You are expected
              </p>
              {phase.eventHint ? (
                <p className="text-sm text-[#8694AC]">
                  Event reference:{" "}
                  <span className="font-mono text-[#566784]">{phase.eventHint}</span>
                </p>
              ) : null}
              <div className="space-y-2 text-sm leading-relaxed text-[#566784]">
                {phase.waitLine ? (
                  <>
                    <p className="rounded-lg border border-[#E0992A]/30 bg-[#FBEFD8] px-3 py-2 text-[#E0992A]">
                      Wait for host: {phase.waitLine}
                    </p>
                    <p className="text-[#566784]">When cleared: {phase.proceedLine}</p>
                  </>
                ) : (
                  <>
                    <p className="text-lg font-medium text-[#2F80ED]">Please proceed</p>
                    <p className="text-[#8694AC]">{phase.proceedLine}</p>
                  </>
                )}
              </div>
            </div>
          ) : phase.id === "unexpected_pending" ? (
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-lg font-semibold text-[#E0992A]">
                <ShieldAlert className="h-5 w-5 text-[#E0992A]" /> You are not scheduled here
              </p>
              <p className="text-sm text-[#8694AC]">Waiting for approval…</p>
              <p className="text-xs uppercase tracking-[0.16em] text-[#8694AC]">
                Realtime updates arrive over the admin channel; polling runs when configured.
              </p>
              {phase.requestId ? (
                <p className="break-all font-mono text-[10px] text-[#8694AC]">
                  Reference: {phase.requestId}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-lg font-semibold text-[#E0992A]">
                <ShieldAlert className="h-5 w-5 text-[#E0992A]" /> You are not scheduled here
              </p>
              <p className="text-sm text-[#8694AC]">Waiting for approval…</p>
              <p className="text-base font-medium text-[#0F2C5C]">Admin reviewing your request</p>
              <div className="flex items-center gap-2 text-sm text-[#8694AC]">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Live refresh…
              </div>
              {phase.requestId ? (
                <p className="break-all font-mono text-[10px] text-[#8694AC]">
                  Reference: {phase.requestId}
                </p>
              ) : null}
            </div>
          )}

          <button
            type="button"
            onClick={() => navigate("/guest-arrival/scan")}
            className="text-xs font-medium uppercase tracking-[0.14em] text-[#2F80ED] hover:underline"
          >
            Scan another QR
          </button>
        </output>
      )}

      {phase.id === "guest_dashboard_signin" && (
        <div className="space-y-3 rounded-xl border border-[#2FA24A]/30 bg-[#E3F4E8] px-4 py-4 text-[#2FA24A]">
          <p className="text-lg font-semibold">Guest sign-in</p>
          {phase.instructions ? (
            <p className="text-sm leading-relaxed text-[#2FA24A]">{phase.instructions}</p>
          ) : null}

          {!phase.exchange_code?.trim() ? (
            <div className="space-y-2 rounded-lg border border-[#2FA24A]/30 bg-[#E3F4E8] px-3 py-3 text-sm text-[#2FA24A]">
              <p className="flex items-center gap-2 font-medium text-[#2FA24A]">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Finishing sign-in…
              </p>
              <p className="text-[#2FA24A]">
                Keep this page open while we fetch your sign-in code from the server.
              </p>
              {phase.pollMessage ? (
                <p className="font-mono text-[11px] text-[#2FA24A]">{phase.pollMessage}</p>
              ) : null}
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
                onClick={() => void handleContinueToGuestDashboard()}
                className="w-full rounded-md bg-[#2F80ED] px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {exchangeBusy ? "Signing in…" : "Continue to guest dashboard"}
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={resetToForm}
            className="text-xs font-medium uppercase tracking-[0.14em] text-[#2FA24A] hover:underline"
          >
            Dismiss / start over
          </button>
        </div>
      )}

      {phase.id === "approved" && (
        <div className="space-y-3 rounded-xl border border-[#2FA24A]/30 bg-[#E3F4E8] px-4 py-4 text-[#2FA24A]">
          <p className="text-lg font-semibold">Access granted</p>
          <p className="text-sm leading-relaxed">{phase.instructions}</p>
          <button
            type="button"
            onClick={resetToForm}
            className="inline-flex items-center gap-2 rounded-md border border-[#2FA24A]/30 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-[#2FA24A]"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Check in again
          </button>
        </div>
      )}

      {phase.id === "rejected" && (
        <div className="space-y-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-4 text-rose-700">
          <p className="text-lg font-semibold">Access denied</p>
          <p className="text-sm">Your host or an admin declined this visit.</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={resetToForm}
              className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-bold text-white"
            >
              Retry
            </button>
            <span className="text-xs text-rose-600">or contact your host / admin.</span>
          </div>
        </div>
      )}
    </section>
  );
}
