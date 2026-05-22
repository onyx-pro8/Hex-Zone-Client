import { useEffect, useMemo, useState } from "react";
import QRCode from "react-qr-code";
import { Copy, Hexagon, QrCode, RefreshCw } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { generateQrRegistrationToken, parseApiErrorBody } from "../lib/api";

export default function QrInvite() {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const [joinToken, setJoinToken] = useState("");
  const [loadingToken, setLoadingToken] = useState(false);
  const [tokenError, setTokenError] = useState("");
  const userZoneId = String(user?.zone_id ?? user?.zoneId ?? "");
  const normalizedAccountType = String(
    user?.accountType ?? user?.account_type ?? "",
  ).toUpperCase();
  const isAdministrator =
    String(user?.role ?? "").toLowerCase() === "administrator";
  // Private accounts: many invitable users. Exclusive accounts: exactly 1.
  const canInviteUserMember =
    isAdministrator &&
    (normalizedAccountType === "PRIVATE" ||
      normalizedAccountType === "EXCLUSIVE");
  const isExclusiveAccount = normalizedAccountType === "EXCLUSIVE";

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
          `${statusLabel}: access denied. Sign out, sign in again as the Exclusive administrator, ` +
            `then retry. If it persists, confirm Render deployed commit 5578a6a or later.`,
        );
      } else if (status === 401) {
        setTokenError(
          "HTTP 401: your session token is missing or expired. Sign out and sign in again as the Exclusive administrator.",
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
    <section className="space-y-10">
      <div>
        <span className="inline-flex items-center gap-2 rounded-full bg-[#00E5D1]/10 px-4 py-2 text-sm font-medium text-[#00E5D1]">
          <QrCode size={16} strokeWidth={2} /> Scan to join
        </span>
        <h1 className="mt-4 text-3xl font-semibold text-white sm:text-4xl">
          QR invite
        </h1>
        <p className="mt-3 max-w-2xl text-lg leading-relaxed text-slate-400">
          {isExclusiveAccount
            ? "Exclusive accounts can invite exactly 1 user. They scan this code, enter their details, and register under your account."
            : "Generate a code that links to your zone. New teammates scan it, enter their details, and register on your private network."}
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
        <div className="rounded-[2rem] border border-slate-800/80 bg-slate-900/90 p-8 shadow-glow flex-1 flex flex-col">
          <div className="mb-6 flex items-center gap-2">
            <Hexagon className="h-5 w-5 text-[#00E5D1]" strokeWidth={2} />
            <h2 className="text-lg font-semibold text-white">Your zone</h2>
          </div>

          {!userZoneId && (
            <p className="text-sm leading-relaxed text-slate-400">
              No zone ID found on your account. Please update your profile
              first, then return here to share an invite.
            </p>
          )}
          {!canInviteUserMember && (
            <p className="mt-3 text-sm leading-relaxed text-amber-300">
              QR invites are available only to Private and Exclusive
              administrators.
            </p>
          )}
          {!!userZoneId && (
            <div className="space-y-3">
              <p className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                Your zone ID
              </p>
              <div className="w-full rounded-md border border-slate-700/80 bg-[#151a20] px-3 py-2.5 text-sm font-mono text-white">
                {userZoneId}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-[2rem] border border-slate-800/80 bg-slate-950/80 p-8 shadow-glow">
          <h2 className="text-lg font-semibold text-white">Invite link</h2>
          <p className="mt-2 text-sm text-slate-400">
            The QR encodes a secure invite token. New users join with your zone
            ID from that token.
          </p>

          {loadingToken && (
            <p className="mt-6 text-sm text-slate-400">
              Generating invite token…
            </p>
          )}
          {tokenError && !loadingToken && (
            <div className="mt-6 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
              {tokenError}
            </div>
          )}
          {joinUrl && !loadingToken ? (
            <>
              <div className="mt-6 flex justify-center rounded-3xl bg-white p-6">
                <QRCode value={joinUrl} size={220} level="M" />
              </div>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
                <code className="min-w-0 flex-1 break-all rounded-xl border border-slate-800/90 bg-slate-900/90 px-3 py-2 text-xs text-slate-300">
                  {joinUrl}
                </code>
                <button
                  type="button"
                  onClick={() => void copyLink()}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-slate-700/80 bg-[#151a20]/90 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:border-[#00E5D1]/50 hover:text-[#00E5D1]"
                >
                  <Copy className="h-4 w-4" strokeWidth={2} />
                  {copied ? "Copied" : "Copy link"}
                </button>
                <button
                  type="button"
                  onClick={() => void requestToken()}
                  disabled={loadingToken || !userZoneId || !canInviteUserMember}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-slate-700/80 bg-[#151a20]/90 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:border-[#00E5D1]/50 hover:text-[#00E5D1] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw className="h-4 w-4" strokeWidth={2} />
                  Regenerate
                </button>
              </div>
            </>
          ) : (
            <p className="mt-6 text-sm text-slate-500">
              {userZoneId
                ? canInviteUserMember
                  ? isExclusiveAccount
                    ? "Generate a token to invite your single Exclusive user."
                    : "Generate a token to display your QR code invite."
                  : "Only Private and Exclusive administrators can generate QR invite tokens."
                : "Your account needs a zone ID to generate a QR code."}
            </p>
          )}
        </div>
      </div>

      <div className="layer-card">
        <div className="px-8 py-12">
          <h2 className="text-xl font-semibold text-white">How it works</h2>
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
                <p className="text-2xl font-bold text-[#00E5D1]">{item.step}</p>
                <div>
                  <h3 className="font-semibold text-white">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">
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
