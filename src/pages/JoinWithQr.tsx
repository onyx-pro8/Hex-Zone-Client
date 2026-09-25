import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronRight, Eye, EyeOff, QrCode, RefreshCw } from "lucide-react";
import AuthMapPanel from "../components/AuthMapPanel";
import { AddressAutocompleteInput } from "../components/AddressAutocompleteInput";
import { addressToMockCoords, generateZoneId, getHexGrid, H3Cell } from "../lib/h3";
import { normalizeAccountType } from "../lib/accountLimits";
import {
  joinWithQrToken,
  parseApiErrorBody,
  previewQrInviteToken,
  type QrInvitePreview,
} from "../lib/api";

const accent = "text-[#2F80ED]";
const accentBorder = "border-[#2F80ED]/45";
const accentBg = "bg-[#2F80ED]";
const panelBg = "bg-[#F7FAFE]";
const labelClass =
  "mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8694AC]";
const inputClass = `${panelBg} w-full rounded-md border border-[#DCE6F2] px-3 py-2.5 text-sm text-[#0F2C5C] placeholder:text-[#8694AC] focus:border-[#2F80ED]/60 focus:outline-none focus:ring-1 focus:ring-[#2F80ED]/25`;

export default function JoinWithQr() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [address, setAddress] = useState("350 Fifth Avenue, New York");
  const [addressCoords, setAddressCoords] = useState<[number, number] | null>(
    null,
  );
  const [zoneId, setZoneId] = useState(() => generateZoneId());
  const [preview, setPreview] = useState<QrInvitePreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const isNewNetworkAdmin = preview?.invite_kind === "new_network_admin";
  const isFamilyMemberInvite =
    !isNewNetworkAdmin &&
    preview?.invite_kind === "member" &&
    normalizeAccountType(preview?.account_type) === "PRIVATE_PLUS";
  const membersAtCapacity =
    !isNewNetworkAdmin && Boolean(preview?.members_at_capacity);
  const [capacityBlocked, setCapacityBlocked] = useState(false);

  useEffect(() => {
    setCapacityBlocked(false);
  }, [token]);

  useEffect(() => {
    if (!token) {
      setPreview(null);
      setPreviewError("");
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError("");
    void previewQrInviteToken(token)
      .then((data) => {
        if (cancelled) return;
        setPreview(data);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setPreview(null);
        const errObj =
          e && typeof e === "object"
            ? (e as { response?: { data?: unknown }; message?: string })
            : undefined;
        const detail = parseApiErrorBody(errObj?.response?.data);
        setPreviewError(
          detail ||
            (typeof errObj?.message === "string" ? errObj.message : "") ||
            "This invite link is invalid or expired.",
        );
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const center = useMemo<[number, number]>(
    () => addressCoords ?? addressToMockCoords(address),
    [address, addressCoords],
  );
  const grid = useMemo<H3Cell[]>(() => getHexGrid(center, 13, 1), [center]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (!token) {
      setError("Missing QR invite token. Please scan a valid QR code.");
      return;
    }
    if (isNewNetworkAdmin && !zoneId.trim()) {
      setError("Enter or generate a network ID for your new Exclusive network.");
      return;
    }
    if (!isFamilyMemberInvite && !address.trim()) {
      setError("Address is required.");
      return;
    }

    setLoading(true);
    try {
      await joinWithQrToken({
        token,
        email,
        password,
        first_name: firstName,
        last_name: lastName,
        ...(isFamilyMemberInvite ? {} : { address }),
        phone: phone || undefined,
        ...(isNewNetworkAdmin ? { zone_id: zoneId.trim() } : {}),
      });
      navigate("/login");
    } catch (e: unknown) {
      const response =
        e && typeof e === "object"
          ? (e as { response?: { data?: unknown; status?: number } }).response
          : undefined;
      const detail = parseApiErrorBody(response?.data);
      const isCapacity =
        response?.status === 403 &&
        /limited|capacity|independent Individual/i.test(detail || "");
      if (isCapacity) {
        setCapacityBlocked(true);
      }
      setError(
        detail ||
          "Could not complete registration with this QR invite. The token may be invalid or expired.",
      );
    } finally {
      setLoading(false);
    }
  };

  const showCapacityNotice = membersAtCapacity || capacityBlocked;

  return (
    <div className="relative left-1/2 w-screen max-w-[100vw] -translate-x-1/2 overflow-x-hidden">
      <div className="grid min-h-[min(100dvh,960px)] grid-cols-1 lg:grid-cols-2">
        <AuthMapPanel
          className="lg:min-h-[min(100dvh,960px)]"
          center={center}
          grid={grid}
          addressLabel={
            isFamilyMemberInvite ? "Family home address" : address
          }
        />

        <div className="flex flex-col border-t border-[#DCE6F2] bg-[#F3F7FD] lg:border-l lg:border-t-0">
          <div
            className={`flex items-center gap-2 border-b px-6 py-3 text-xs ${accent} ${accentBorder} bg-[#EDF3FB]`}
          >
            <QrCode className="h-4 w-4 shrink-0" strokeWidth={2} />
            <span>
              {isNewNetworkAdmin
                ? "System invite — create your Individual network"
                : preview?.account_type === "private_plus"
                  ? "Member invite — Family member (user role)"
                  : preview?.account_type === "enhanced_plus"
                    ? "Member invite — Organization member (user role)"
                    : preview?.account_type === "exclusive"
                      ? "Member invite — Individual (user role)"
                      : "Member invite — join the inviter's network"}
            </span>
          </div>

          <div className="flex flex-1 flex-col overflow-y-auto px-6 py-8 sm:px-10">
            <h1 className="text-center text-2xl font-semibold tracking-tight text-[#0F2C5C]">
              {isNewNetworkAdmin ? "Create Individual network" : "Join with QR"}
            </h1>
            <p className="mt-2 text-center text-sm text-[#8694AC]">
              {previewLoading
                ? "Checking invite…"
                : isNewNetworkAdmin
                  ? "You will create an Individual (user-role) account for a new network."
                  : preview?.zone_id
                    ? `You join zone ${preview.zone_id} as a ${
                        preview.account_type === "private_plus"
                          ? "Family"
                          : preview.account_type === "enhanced_plus"
                            ? "Organization"
                            : "Individual"
                      } user-role member.`
                    : "You join the inviter's zone as a user-role member."}
            </p>

            {previewError && (
              <p className="mt-6 rounded-md border border-[#E23B4E]/30 bg-[#FCE7EA] px-3 py-2 text-sm text-[#E23B4E]">
                {previewError}
              </p>
            )}

            {showCapacityNotice && !previewError && (
              <div className="mt-6 rounded-md border border-[#D4A017]/35 bg-[#FFF8E7] px-4 py-3 text-sm text-[#7A5A00]">
                <p className="font-medium text-[#5C4300]">
                  Currently the number of members on this account is limited.
                </p>
                <p className="mt-1.5 text-[#7A5A00]">
                  You can sign up as an independent Individual account instead.
                </p>
                <Link
                  to="/register"
                  className={`mt-3 inline-flex items-center gap-1 font-semibold ${accent} hover:underline`}
                >
                  Sign up as Individual
                  <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
                </Link>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              <div className="rounded-md border border-[#DCE6F2] bg-white p-4">
                <p className={labelClass}>Invite token</p>
                <code className="block break-all rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2.5 text-xs text-[#566784]">
                  {token || "No token provided"}
                </code>
              </div>

              {isNewNetworkAdmin && (
                <div>
                  <label htmlFor="join-zone" className={labelClass}>
                    Network ID
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="join-zone"
                      value={zoneId}
                      onChange={(e) => setZoneId(e.target.value)}
                      placeholder="Network-ABC123"
                      required
                      className={inputClass}
                    />
                    <button
                      type="button"
                      onClick={() => setZoneId(generateZoneId())}
                      className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-[#DCE6F2] bg-white px-3 text-sm font-medium text-[#566784] transition hover:border-[#2F80ED]/50 hover:text-[#2F80ED]"
                      aria-label="Generate network ID"
                    >
                      <RefreshCw className="h-4 w-4" strokeWidth={2} />
                    </button>
                  </div>
                  <p className="mt-1.5 text-xs text-[#8694AC]">
                    Account type: Individual · Role: User. Up to 3 secondary
                    zones · No member invites · No smart-home.
                  </p>
                </div>
              )}

              {!isNewNetworkAdmin && preview && !previewError && (
                <p className="text-xs text-[#8694AC]">
                  {preview.account_type === "private_plus"
                    ? "Account type: Family · Role: User — joins the inviter's network."
                    : preview.account_type === "enhanced_plus"
                      ? "Account type: Organization · Role: User — joins the inviter's network."
                      : "Account type: Individual · Role: User — joins the inviter's primary zone."}
                </p>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="join-first" className={labelClass}>
                    First name
                  </label>
                  <input
                    id="join-first"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Alex"
                    required
                    autoComplete="given-name"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="join-last" className={labelClass}>
                    Last name
                  </label>
                  <input
                    id="join-last"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Chen"
                    required
                    autoComplete="family-name"
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="join-email" className={labelClass}>
                  Email
                </label>
                <input
                  id="join-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="alex@geozone.io"
                  required
                  autoComplete="email"
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="join-phone" className={labelClass}>
                  Phone (optional)
                </label>
                <input
                  id="join-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 555 0123"
                  autoComplete="tel"
                  className={inputClass}
                />
              </div>

              {isFamilyMemberInvite ? (
                <div className="rounded-md border border-[#DCE6F2] bg-white p-4">
                  <p className={labelClass}>Address</p>
                  <p className="text-sm font-semibold text-[#0F2C5C]">
                    Same as family administrator
                  </p>
                  <p className="mt-1.5 text-xs text-[#8694AC]">
                    Family members share the administrator's home address.
                  </p>
                </div>
              ) : (
                <AddressAutocompleteInput
                  id="join-address"
                  label="Address"
                  value={address}
                  onChange={(addr, coords) => {
                    setAddress(addr);
                    setAddressCoords(coords);
                  }}
                  required
                  labelClassName={labelClass}
                  inputClassName={inputClass}
                  className="relative"
                />
              )}

              <div>
                <label htmlFor="join-password" className={labelClass}>
                  Password
                </label>
                <div className="relative">
                  <input
                    id="join-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min 8 characters"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className={`${inputClass} pr-11`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-[#8694AC] transition hover:bg-[#EDF3FB] hover:text-[#566784]"
                    aria-label={
                      showPassword ? "Hide characters" : "Show characters"
                    }
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" strokeWidth={2} />
                    ) : (
                      <Eye className="h-4 w-4" strokeWidth={2} />
                    )}
                  </button>
                </div>
              </div>

              {error && !showCapacityNotice && (
                <p className="rounded-md border border-[#E23B4E]/30 bg-[#FCE7EA] px-3 py-2 text-sm text-[#E23B4E]">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={
                  loading ||
                  !token ||
                  !!previewError ||
                  previewLoading ||
                  showCapacityNotice
                }
                className={`flex w-full items-center justify-center gap-2 rounded-md ${accentBg} py-3.5 text-sm font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {loading ? (
                  "Joining…"
                ) : showCapacityNotice ? (
                  "Member limit reached"
                ) : (
                  <>
                    {isNewNetworkAdmin
                      ? "Create Exclusive network"
                      : "Join zone & create account"}
                    <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
                  </>
                )}
              </button>
            </form>

            <p className="mt-8 text-center text-sm text-[#8694AC]">
              {showCapacityNotice ? (
                <>
                  Continue with your own network?{" "}
                  <Link
                    to="/register"
                    className={`font-medium ${accent} hover:underline`}
                  >
                    Create Independent Individual account
                  </Link>
                </>
              ) : (
                <>
                  Need your own zone?{" "}
                  <Link
                    to="/register"
                    className={`font-medium ${accent} hover:underline`}
                  >
                    Create account
                  </Link>
                </>
              )}
              {" · "}
              <Link
                to="/login"
                className={`font-medium ${accent} hover:underline`}
              >
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
