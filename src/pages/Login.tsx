import { FormEvent, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Eye, EyeOff, QrCode } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { getLastEmail, persistLastEmail } from "../services/api/client";
import AuthMapPanel from "../components/AuthMapPanel";
import { AUTH_MAP_DEFAULT_CENTER, getHexGrid, H3Cell } from "../lib/h3";

const accent = "text-[#2F80ED]";
const accentBorder = "border-[#2F80ED]/40";
const accentBg = "bg-[#2F80ED]";
const panelBg = "bg-[#F7FAFE]";
const labelClass =
  "mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8694AC]";
const inputClass = `${panelBg} w-full rounded-md border border-[#DCE6F2] px-3 py-2.5 text-sm text-[#0F2C5C] placeholder:text-[#8694AC] focus:border-[#2F80ED]/60 focus:outline-none focus:ring-1 focus:ring-[#2F80ED]/25`;

export default function Login() {
  const [email, setEmail] = useState(() => getLastEmail());
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const center = AUTH_MAP_DEFAULT_CENTER;
  const grid = useMemo<H3Cell[]>(() => getHexGrid(center, 9, 1), [center]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      await login(email, password, { rememberMe });
      persistLastEmail(email);
      navigate("/dashboard");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Login failed. Check your credentials and try again.";
      setError(
        /inactive|expired|403/i.test(message)
          ? "Account is inactive or expired"
          : message,
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
          addressLabel="New York, NY"
        />

        <div className="flex flex-col border-t border-[#DCE6F2] bg-white lg:border-l lg:border-t-0">
          <div
            className={`flex items-center gap-2 border-b px-6 py-3 text-xs ${accent} ${accentBorder} bg-[#EDF3FB]`}
          >
            <QrCode className="h-4 w-4 shrink-0" strokeWidth={2} />
            <span>Have a QR code? Scan to auto-populate your Zone ID</span>
          </div>

          <div className="flex flex-1 flex-col justify-center px-6 py-10 sm:px-12">
            <h1 className="text-center text-2xl font-semibold tracking-tight text-[#0F2C5C]">
              Login
            </h1>

            <form onSubmit={handleSubmit} className="mt-10 space-y-5">
              <div>
                <label htmlFor="login-email" className={labelClass}>
                  Email
                </label>
                <input
                  id="login-email"
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
                <div className="mb-1.5 flex items-end justify-between gap-2">
                  <label htmlFor="login-password" className={labelClass}>
                    Password
                  </label>
                  <button
                    type="button"
                    className="text-[10px] font-medium uppercase tracking-wide text-[#8694AC] transition hover:text-[#2F80ED]"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
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

              <label className="flex items-center gap-2 text-sm text-[#566784]">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="accent-[#2F80ED]"
                />
                Remember me
              </label>

              <button
                type="submit"
                disabled={loading}
                className={`w-full rounded-md ${accentBg} py-3.5 text-sm font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {loading ? "Logging in…" : "Login"}
              </button>
            </form>

            <p className="mt-8 text-center text-sm text-[#8694AC]">
              Need an account?{" "}
              <Link
                to="/register"
                className={`font-medium ${accent} hover:underline`}
              >
                Register
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
