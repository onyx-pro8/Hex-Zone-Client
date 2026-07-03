import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronRight, Eye, EyeOff, QrCode } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import AuthMapPanel from "../components/AuthMapPanel";
import { AddressAutocompleteInput } from "../components/AddressAutocompleteInput";
import { addressToMockCoords, getHexGrid, H3Cell } from "../lib/h3";

const accent = "text-[#2F80ED]";
const accentBorder = "border-[#2F80ED]/45";
const accentBg = "bg-[#2F80ED]";
const panelBg = "bg-[#F7FAFE]";
const labelClass =
  "mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8694AC]";
const inputClass = `${panelBg} w-full rounded-md border border-[#DCE6F2] px-3 py-2.5 text-sm text-[#0F2C5C] placeholder:text-[#8694AC] focus:border-[#2F80ED]/60 focus:outline-none focus:ring-1 focus:ring-[#2F80ED]/25`;

export default function Join() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const zoneFromQuery = searchParams.get("zone")?.trim() ?? "";

  const { register } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [zoneId, setZoneId] = useState(zoneFromQuery);
  const [address, setAddress] = useState("350 Fifth Avenue, New York");
  const [addressCoords, setAddressCoords] = useState<[number, number] | null>(
    null,
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const z = searchParams.get("zone")?.trim();
    if (z) setZoneId(z);
  }, [searchParams]);

  const center = useMemo<[number, number]>(
    () => addressCoords ?? addressToMockCoords(address),
    [address, addressCoords],
  );
  const grid = useMemo<H3Cell[]>(() => getHexGrid(center, 13, 1), [center]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const trimmedZone = zoneId.trim();
    if (!trimmedZone) {
      setError("Enter the network ID from your invite or scan the QR code again.");
      return;
    }

    setLoading(true);
    try {
      await register({
        name: `${firstName} ${lastName}`.trim(),
        email,
        password,
        accountType: "PRIVATE_PLUS",
        registrationType: "USER",
        address,
        phone: phone || undefined,
        zoneId: trimmedZone,
      });
      navigate("/login");
    } catch {
      setError(
        "Could not complete registration. Check the network ID and your details, then try again.",
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
            <span>Joining a private zone — your network ID is set from the invite</span>
          </div>

          <div className="flex flex-1 flex-col overflow-y-auto px-6 py-8 sm:px-10">
            <h1 className="text-center text-2xl font-semibold tracking-tight text-[#0F2C5C]">
              Join with QR
            </h1>
            <p className="mt-2 text-center text-sm text-[#8694AC]">
              Complete your profile to join this network.
            </p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              <div>
                <label htmlFor="join-zone" className={labelClass}>
                  Network ID
                </label>
                <input
                  id="join-zone"
                  value={zoneId}
                  onChange={(e) => setZoneId(e.target.value)}
                  placeholder="ZN-XXXXXXXX"
                  required
                  className={`${inputClass} font-mono`}
                  autoComplete="off"
                />
              </div>

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

              {error && (
                <p className="rounded-md border border-[#E23B4E]/30 bg-[#FCE7EA] px-3 py-2 text-sm text-[#E23B4E]">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className={`flex w-full items-center justify-center gap-2 rounded-md ${accentBg} py-3.5 text-sm font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {loading ? (
                  "Joining…"
                ) : (
                  <>
                    Join zone &amp; create account
                    <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
                  </>
                )}
              </button>
            </form>

            <p className="mt-8 text-center text-sm text-[#8694AC]">
              Need your own zone?{" "}
              <Link
                to="/register"
                className={`font-medium ${accent} hover:underline`}
              >
                Create account
              </Link>
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
