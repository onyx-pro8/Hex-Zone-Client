import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, Eye, EyeOff, Loader2, QrCode, RefreshCw } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import {
  fetchRegistrationCode,
  type AccountType,
  type RegistrationType,
} from "../services/api";
import AuthMapPanel from "../components/AuthMapPanel";
import { AddressAutocompleteInput } from "../components/AddressAutocompleteInput";
import {
  addressToMockCoords,
  generateZoneId,
  getHexGrid,
  H3Cell,
} from "../lib/h3";

const accent = "text-[#2F80ED]";
const accentBorder = "border-[#2F80ED]/45";
const accentBg = "bg-[#2F80ED]";
const panelBg = "bg-[#F7FAFE]";
const labelClass =
  "mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8694AC]";
const inputClass = `${panelBg} w-full rounded-md border border-[#DCE6F2] px-3 py-2.5 text-sm text-[#0F2C5C] placeholder:text-[#8694AC] focus:border-[#2F80ED]/60 focus:outline-none focus:ring-1 focus:ring-[#2F80ED]/25`;

const accountOptions: {
  value: AccountType;
  title: string;
  lines: [string, string];
}[] = [
  {
    value: "EXCLUSIVE",
    title: "Exclusive",
    lines: ["1 user, 1 device", "Any zone type"],
  },
  {
    value: "PRIVATE_PLUS",
    title: "Private+",
    lines: ["Up to 10 devices", "Expanded account controls"],
  },
  {
    value: "ENHANCED",
    title: "Enhanced",
    lines: ["1 device only", "Extended zone capabilities"],
  },
  {
    value: "ENHANCED_PLUS",
    title: "Enhanced+",
    lines: ["Unlimited devices", "Maximum controls"],
  },
];

export default function CreateAccount() {
  const navigate = useNavigate();
  const { register } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [accountType, setAccountType] = useState<AccountType>("EXCLUSIVE");
  const [registrationType, setRegistrationType] =
    useState<RegistrationType>("ADMINISTRATOR");
  const [accountOwnerId, setAccountOwnerId] = useState("");
  const [address, setAddress] = useState("350 Fifth Avenue, New York");
  /** Set when user picks a suggestion — map uses real [lat, lng] */
  const [addressCoords, setAddressCoords] = useState<[number, number] | null>(
    null,
  );
  const [zoneId, setZoneId] = useState(() => generateZoneId());
  const [useExistingZone, setUseExistingZone] = useState(false);
  const [existingZoneId, setExistingZoneId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [registrationCode, setRegistrationCode] = useState("");
  const [regCodeLoading, setRegCodeLoading] = useState(true);
  const [regCodeError, setRegCodeError] = useState<string | null>(null);

  const loadRegistrationCode = useCallback(async () => {
    setRegCodeLoading(true);
    setRegCodeError(null);
    const result = await fetchRegistrationCode();
    if (result.error || !result.data) {
      setRegistrationCode("");
      setRegCodeError(result.error ?? "Could not load registration code.");
    } else {
      setRegistrationCode(result.data);
    }
    setRegCodeLoading(false);
  }, []);

  useEffect(() => {
    void loadRegistrationCode();
  }, [loadRegistrationCode]);

  const center = useMemo<[number, number]>(
    () => addressCoords ?? addressToMockCoords(address),
    [address, addressCoords],
  );
  const grid = useMemo<H3Cell[]>(() => getHexGrid(center, 9, 1), [center]);

  const selectedZoneId =
    useExistingZone && existingZoneId ? existingZoneId : zoneId;
  const userOnExclusiveAccount =
    registrationType === "USER" && accountType === "EXCLUSIVE";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const code = registrationCode.trim();
    if (!code) {
      setError(
        "Registration code is missing. Wait for the server to issue one, or use Retry.",
      );
      return;
    }
    if (userOnExclusiveAccount) {
      setError(
        "Exclusive accounts only allow 1 invited user. Ask the administrator for a QR invite instead of self-registering.",
      );
      return;
    }
    if (registrationType === "USER" && !accountOwnerId.trim()) {
      setError("User registration requires a valid account owner ID.");
      return;
    }

    setLoading(true);

    try {
      await register({
        name: `${firstName} ${lastName}`.trim(),
        email,
        password,
        accountType,
        registrationType,
        accountOwnerId:
          registrationType === "USER"
            ? Number(accountOwnerId.trim()) || undefined
            : undefined,
        address,
        phone: phone || undefined,
        zoneId: selectedZoneId,
        registrationCode: code,
      });
      navigate("/login");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "";
      setError(
        /422|exclusive|account owner|zone/i.test(message)
          ? message
          : "Could not create account. Please review your details and try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative left-1/2 w-screen max-w-[100vw] -translate-x-1/2 overflow-x-hidden">
      <div className="grid min-h-[min(100dvh,960px)] grid-cols-1 lg:grid-cols-2">
        <AuthMapPanel
          className="lg:min-h-[min(100dvh,960px)]"
          center={center}
          grid={grid}
          addressLabel={address}
        />

        <div className="flex flex-col border-t border-[#DCE6F2] bg-[#F3F7FD] lg:border-l lg:border-t-0">
          <div
            className={`flex items-center gap-2 border-b px-6 py-3 text-xs ${accent} ${accentBorder} bg-[#EDF3FB]`}
          >
            <QrCode className="h-4 w-4 shrink-0" strokeWidth={2} />
            <span>Have a QR code? Scan to auto-populate your Network ID</span>
          </div>

          <div className="flex flex-1 flex-col overflow-y-auto px-6 py-8 sm:px-10">
            <h1 className="text-center text-2xl font-semibold tracking-tight text-[#0F2C5C]">
              Create Account
            </h1>

            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              <div className="rounded-md border border-[#DCE6F2] bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor="reg-code" className={labelClass}>
                    Registration code
                  </label>
                  <button
                    type="button"
                    onClick={() => void loadRegistrationCode()}
                    disabled={regCodeLoading}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[#E4ECF7] bg-[#EDF3FB] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#566784] transition hover:bg-[#EDF3FB] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {regCodeLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
                    )}
                    Retry
                  </button>
                </div>
                {regCodeLoading && (
                  <p className="mt-2 flex items-center gap-2 text-sm text-[#8694AC]">
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" strokeWidth={2} />
                    Requesting registration code from server…
                  </p>
                )}
                {regCodeError && !regCodeLoading && (
                  <p className="mt-2 rounded-md border border-[#E0992A]/40 bg-[#FBEFD8] px-3 py-2 text-sm text-[#E0992A]">
                    {regCodeError}
                  </p>
                )}
                {!regCodeLoading && !regCodeError && (
                  <input
                    id="reg-code"
                    readOnly
                    value={registrationCode}
                    className={`${inputClass} mt-2 font-mono text-[#2F80ED]`}
                    aria-describedby="reg-code-hint"
                  />
                )}
                <p id="reg-code-hint" className="mt-2 text-xs text-[#8694AC]">
                  Issued by the server when you open this page. It is sent again when you
                  create your account, then you can sign in at Login.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="reg-first" className={labelClass}>
                    First name
                  </label>
                  <input
                    id="reg-first"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Alex"
                    required
                    autoComplete="given-name"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="reg-last" className={labelClass}>
                    Last name
                  </label>
                  <input
                    id="reg-last"
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
                <label htmlFor="reg-email" className={labelClass}>
                  Email
                </label>
                <input
                  id="reg-email"
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
                <label htmlFor="reg-phone" className={labelClass}>
                  Phone (optional)
                </label>
                <input
                  id="reg-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 555 0123"
                  autoComplete="tel"
                  className={inputClass}
                />
              </div>

              <AddressAutocompleteInput
                id="reg-address"
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

              <div>
                <p className={labelClass}>Account type</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {accountOptions.map((option) => {
                    const active = accountType === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          if (registrationType === "USER" && option.value === "EXCLUSIVE") {
                            setError(
                              "Exclusive account type is not valid for user registration.",
                            );
                            return;
                          }
                          setAccountType(option.value);
                          setError("");
                        }}
                        className={`rounded-md border px-4 py-4 text-left transition ${
                          active
                            ? `border-[#2F80ED] bg-[#EDF3FB] shadow-glow`
                            : "border-[#DCE6F2] bg-white hover:border-[#C5D4E8]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold text-[#0F2C5C]">
                            {option.title}
                          </p>
                        </div>
                        <p className="mt-2 text-sm text-[#8694AC]">
                          {option.lines[0]}
                        </p>
                        <p className="mt-1 text-sm text-[#8694AC]">
                          {option.lines[1]}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-md border border-[#DCE6F2] bg-white p-4">
                <p className={labelClass}>Registration type</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setRegistrationType("ADMINISTRATOR")}
                    className={`rounded-md border px-4 py-3 text-left transition ${
                      registrationType === "ADMINISTRATOR"
                        ? "border-[#2F80ED] bg-[#EDF3FB] text-[#0F2C5C]"
                        : "border-[#DCE6F2] text-[#566784] hover:border-[#C5D4E8]"
                    }`}
                  >
                    Administrator
                  </button>
                  <button
                    type="button"
                    onClick={() => setRegistrationType("USER")}
                    className={`rounded-md border px-4 py-3 text-left transition ${
                      registrationType === "USER"
                        ? "border-[#2F80ED] bg-[#EDF3FB] text-[#0F2C5C]"
                        : "border-[#DCE6F2] text-[#566784] hover:border-[#C5D4E8]"
                    }`}
                  >
                    User
                  </button>
                </div>
                {registrationType === "USER" && (
                  <div className="mt-4">
                    <label htmlFor="reg-owner-id" className={labelClass}>
                      Account owner ID
                    </label>
                    <input
                      id="reg-owner-id"
                      type="number"
                      min={1}
                      required
                      value={accountOwnerId}
                      onChange={(e) => setAccountOwnerId(e.target.value)}
                      placeholder="101"
                      className={inputClass}
                    />
                    <p className="mt-2 text-xs text-[#8694AC]">
                      Linked users must use the admin account owner ID and matching
                      account type/zone scope.
                    </p>
                  </div>
                )}
              </div>

              <div className="rounded-md border border-[#DCE6F2] bg-white p-4">
                <p className={labelClass}>Network ID</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setUseExistingZone(false)}
                    className={`rounded-md px-4 py-2 text-sm font-medium transition ${
                      !useExistingZone
                        ? `${accentBg} text-white`
                        : "bg-[#EDF3FB] text-[#566784] hover:bg-[#EDF3FB]"
                    }`}
                  >
                    Generate New
                  </button>
                  <button
                    type="button"
                    onClick={() => setUseExistingZone(true)}
                    className={`rounded-md px-4 py-2 text-sm font-medium transition ${
                      useExistingZone
                        ? `${accentBg} text-white`
                        : "bg-[#EDF3FB] text-[#566784] hover:bg-[#EDF3FB]"
                    }`}
                  >
                    Enter Existing
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap items-stretch gap-2 sm:flex-nowrap">
                  <input
                    readOnly={!useExistingZone}
                    value={useExistingZone ? existingZoneId : zoneId}
                    onChange={(e) => {
                      if (useExistingZone) setExistingZoneId(e.target.value);
                    }}
                    placeholder="Network-XXXXXXXX"
                    className={`min-w-0 flex-1 rounded-md border border-[#DCE6F2] px-3 py-2.5 font-mono text-sm focus:border-[#2F80ED]/60 focus:outline-none focus:ring-1 focus:ring-[#2F80ED]/25 ${
                      useExistingZone
                        ? `${panelBg} text-[#0F2C5C]`
                        : `${panelBg} ${accent}`
                    }`}
                  />
                  <button
                    type="button"
                    disabled={useExistingZone}
                    onClick={() => setZoneId(generateZoneId())}
                    className="shrink-0 rounded-md border border-[#E4ECF7] bg-[#EDF3FB] px-4 py-2.5 text-sm font-medium text-[#566784] transition hover:bg-[#EDF3FB] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Regenerate
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="reg-password" className={labelClass}>
                  Password
                </label>
                <div className="relative">
                  <input
                    id="reg-password"
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

              {error && (
                <p className="rounded-md border border-[#E23B4E]/30 bg-[#FCE7EA] px-3 py-2 text-sm text-[#E23B4E]">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={
                  loading ||
                  userOnExclusiveAccount ||
                  regCodeLoading ||
                  Boolean(regCodeError) ||
                  !registrationCode.trim()
                }
                className={`flex w-full items-center justify-center gap-2 rounded-md ${accentBg} py-3.5 text-sm font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {loading ? (
                  "Creating account…"
                ) : (
                  <>
                    Create Account
                    <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
                  </>
                )}
              </button>
            </form>
            {userOnExclusiveAccount && (
              <p className="mt-3 rounded-md border border-[#E0992A]/40 bg-[#FBEFD8] px-3 py-2 text-sm text-[#E0992A]">
                Exclusive accounts only allow 1 invited user. Ask your
                administrator to send a QR invite from their dashboard, then
                join via that link.
              </p>
            )}

            <p className="mt-8 text-center text-sm text-[#8694AC]">
              Already have an account?{" "}
              <Link
                to="/login"
                className={`font-medium ${accent} hover:underline`}
              >
                Login
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
