import { useEffect, useMemo, useState } from "react";
import QRCode from "react-qr-code";
import { Copy, Hexagon, QrCode, RefreshCw } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { generateQrRegistrationToken, parseApiErrorBody } from "../lib/api";
import {
  canAdministratorInviteUserMember,
  MEMBER_INVITE_UNAVAILABLE_HINT,
  normalizeAccountType,
} from "../lib/accountLimits";

export default function QrInvite() {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const [joinToken, setJoinToken] = useState("");
  const [loadingToken, setLoadingToken] = useState(false);
  const [tokenError, setTokenError] = useState("");
  const userZoneId = String(user?.zone_id ?? user?.zoneId ?? "");
  const accountType = normalizeAccountType(
    user?.accountType,
    user?.account_type,
  );
  const canInviteUserMember = canAdministratorInviteUserMember({
    role: user?.role,
    accountType: user?.accountType,
    legacyAccountType: user?.account_type,
  });
  const isExclusiveAccount = accountType === "EXCLUSIVE";

  const joinUrl = useMemo(() => {
    if (!joinToken) return "";
    return new URL(
      `/join?token=${encodeURIComponent(joinToken)}`,
      window.location.origin,
    ).href;
  }, [joinToken]);

  const requestToken = async () => {
    if (!userZoneId || !canInviteUserMember) return;
    setLoadingToken(true);
    setTokenError("");
    try {
      const response = await generateQrRegistrationToken({
        zone_id: userZoneId,
      });
      if (!response?.token) {
        throw new Error("No token returned");
      }
      setJoinToken(response.token);
    } catch (e: unknown) {
      setJoinToken("");
      const errObj =
        e && typeof e === "object"
          ? (e as {
              message?: unknown;
              response?: { status?: number; data?: unknown };
            })
          : undefined;
      const status = Number(errObj?.response?.status ?? 0);
      const serverDetail = parseApiErrorBody(errObj?.response?.data);
      const networkMessage =
        typeof errObj?.message === "string" ? errObj.message : "";
      const statusLabel = status > 0 ? `HTTP ${status}` : "Network error";

      if (serverDetail) {
        setTokenError(`${statusLabel}: ${serverDetail}`);
      } else if (status === 403) {
        setTokenError(
          `${statusLabel}: access denied. Sign out, sign in again as an administrator on an invite-capable account tier, then retry.`,
        );
      } else if (status === 401) {
        setTokenError(
          "HTTP 401: your session token is missing or expired. Sign out and sign in again.",
        );
      } else if (status === 0) {
        setTokenError(
          `Network error reaching the server${
            networkMessage ? ` (${networkMessage})` : ""
          }. Check the API base URL and that the backend is up.`,
        );
      } else {
        setTokenError(
          `${statusLabel}: could not create a QR invite token for this zone or account.`,
        );
      }
    } finally {
      setLoadingToken(false);
    }
  };

  useEffect(() => {
    if (!userZoneId || !canInviteUserMember) {
      setJoinToken("");
      return;
    }
    void requestToken();
  }, [userZoneId, canInviteUserMember]);

  const copyLink = async () => {
    if (!joinUrl) return;
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-[#DCE6F2] bg-white p-6 shadow-sm">
        <span className="inline-flex items-center gap-2 rounded-full bg-[#EDF3FB] px-4 py-2 text-sm font-medium text-[#2F80ED]">
          <QrCode size={16} strokeWidth={2} /> Scan to join
        </span>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#566784]">
          {isExclusiveAccount
            ? "Exclusive accounts can invite exactly 1 user. They scan this code, enter their details, and register under your account."
            : "Generate a code that links to your zone. New teammates scan it, enter their details, and register on your account."}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
        <div className="rounded-[2rem] border border-[#DCE6F2] bg-white p-8 shadow-glow flex-1 flex flex-col">
          <div className="mb-6 flex items-center gap-2">
            <Hexagon className="h-5 w-5 text-[#2F80ED]" strokeWidth={2} />
            <h2 className="text-lg font-semibold text-[#0F2C5C]">Your zone</h2>
          </div>

          {!userZoneId && (
            <p className="text-sm leading-relaxed text-[#566784]">
              No network ID found on your account. Please update your profile
              first, then return here to share an invite.
            </p>
          )}
          {!canInviteUserMember && (
            <p className="mt-3 text-sm leading-relaxed text-[#E0992A]">
              {MEMBER_INVITE_UNAVAILABLE_HINT}
            </p>
          )}
          {!!userZoneId && (
            <div className="space-y-3">
              <p className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8694AC]">
                Your network ID
              </p>
              <div className="w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2.5 text-sm font-mono text-[#0F2C5C]">
                {userZoneId}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-[2rem] border border-[#DCE6F2] bg-white p-8 shadow-glow">
          <h2 className="text-lg font-semibold text-[#0F2C5C]">Invite link</h2>
          <p className="mt-2 text-sm text-[#566784]">
            The QR encodes a secure invite token. New users join with your zone
            ID from that token.
          </p>

          {loadingToken && (
            <p className="mt-6 text-sm text-[#566784]">
              Generating invite token…
            </p>
          )}
          {tokenError && !loadingToken && (
            <div className="mt-6 rounded-md border border-[#E23B4E]/30 bg-[#FCE7EA] p-3 text-sm text-[#E23B4E]">
              {tokenError}
            </div>
          )}
          {joinUrl && !loadingToken ? (
            <>
              <div className="mt-6 flex justify-center rounded-3xl bg-white p-6">
                <QRCode value={joinUrl} size={220} level="M" />
              </div>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
                <code className="min-w-0 flex-1 break-all rounded-xl border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-xs text-[#566784]">
                  {joinUrl}
                </code>
                <button
                  type="button"
                  onClick={() => void copyLink()}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-[#DCE6F2] bg-white px-4 py-2.5 text-sm font-medium text-[#566784] transition hover:border-[#2F80ED]/50 hover:text-[#2F80ED]"
                >
                  <Copy className="h-4 w-4" strokeWidth={2} />
                  {copied ? "Copied" : "Copy link"}
                </button>
                <button
                  type="button"
                  onClick={() => void requestToken()}
                  disabled={loadingToken || !userZoneId || !canInviteUserMember}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-[#DCE6F2] bg-white px-4 py-2.5 text-sm font-medium text-[#566784] transition hover:border-[#2F80ED]/50 hover:text-[#2F80ED] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw className="h-4 w-4" strokeWidth={2} />
                  Regenerate
                </button>
              </div>
            </>
          ) : (
            <p className="mt-6 text-sm text-[#8694AC]">
              {userZoneId
                ? canInviteUserMember
                  ? isExclusiveAccount
                    ? "Generate a token to invite your single Exclusive user."
                    : "Generate a token to display your QR code invite."
                  : MEMBER_INVITE_UNAVAILABLE_HINT
                : "Your account needs a network ID to generate a QR code."}
            </p>
          )}
        </div>
      </div>

      <div className="layer-card">
        <div className="px-8 py-12">
          <h2 className="text-xl font-semibold text-[#0F2C5C]">How it works</h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-3">
            {[
              {
                step: "01",
                title: "Share",
                body: "Show the QR on a phone or print it for your team.",
              },
              {
                step: "02",
                title: "Scan",
                body: "They open the join page with a secure invite token.",
              },
              {
                step: "03",
                title: "Register",
                body: "They submit details and are attached to your zone automatically.",
              },
            ].map((item) => (
              <div key={item.step} className="flex gap-4">
                <p className="text-2xl font-bold text-[#2F80ED]">{item.step}</p>
                <div>
                  <h3 className="font-semibold text-[#0F2C5C]">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#566784]">
                    {item.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
