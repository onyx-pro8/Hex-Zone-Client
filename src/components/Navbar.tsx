import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { MapPin, Shield, Mail, Terminal, QrCode, Users } from "lucide-react";

const appRoutes = [
  { path: "/dashboard", title: "Dashboard", icon: MapPin },
  { path: "/devices", title: "Devices", icon: Shield },
  { path: "/messages", title: "Messages", icon: Mail },
  { path: "/members", title: "Members", icon: Users },
  { path: "/qr", title: "QR invite", icon: QrCode },
];

export default function Navbar() {
  const { user, token, logout } = useAuth();
  const isLoggedIn = Boolean(token);
  const isPrivateAdministrator =
    String(user?.role ?? "").toLowerCase() === "administrator" &&
    String(user?.accountType ?? user?.account_type ?? "").toUpperCase() ===
      "PRIVATE";
  const visibleAppRoutes = appRoutes.filter(
    (route) => route.path !== "/qr" || isPrivateAdministrator,
  );

  return (
    <header className="border-b border-slate-800/80 bg-transparent backdrop-blur-xl fixed w-full z-50">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-4">
        <Link
          to="/"
          className="group flex items-center gap-3 transition hover:opacity-95"
        >
          <div className="grid h-11 w-11 place-items-center rounded-md border-2 border-[#00E5D1]/80 bg-[#0B0E11]/40 shadow-[0_0_24px_-8px_rgba(0,229,209,0.35)]">
            <div className="h-4 w-4 rounded-full bg-[#00E5D1] transition group-hover:brightness-110" />
          </div>
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-slate-400">
              Zone Weaver
            </p>
            <p className="font-semibold text-white group-hover:text-[#00E5D1]">
              weave your spatial network
            </p>
          </div>
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/api"
            className="rounded-md border border-slate-700/80 bg-[#151a20]/90 px-4 py-2 text-sm text-slate-200 transition hover:border-[#00E5D1]/50 hover:text-[#00E5D1]"
          >
            <span className="inline-flex items-center gap-2">
              <Terminal size={14} /> API
            </span>
          </Link>

          {isLoggedIn ? (
            <>
              <nav className="hidden md:flex items-center gap-2">
                {visibleAppRoutes.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      className={({ isActive }) =>
                        `rounded-md px-4 py-2 text-sm transition ${
                          isActive
                            ? "bg-[#00E5D1]/15 font-medium text-[#00E5D1]"
                            : "text-slate-400 hover:bg-slate-800/80 hover:text-slate-100"
                        }`
                      }
                    >
                      <span className="inline-flex items-center gap-2">
                        <Icon size={14} /> {item.title}
                      </span>
                    </NavLink>
                  );
                })}
              </nav>
              <button
                type="button"
                onClick={() => {
                  void logout();
                }}
                className="rounded-md border border-slate-700/80 bg-[#151a20]/90 px-4 py-2 text-sm text-slate-200 transition hover:border-[#00E5D1]/50 hover:text-[#00E5D1]"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link
                to="/login"
                className="rounded-md border border-slate-700/80 bg-[#151a20]/90 px-4 py-2 text-sm text-slate-200 transition hover:border-[#00E5D1]/50 hover:text-[#00E5D1]"
              >
                Sign In
              </Link>
              <Link
                to="/register"
                className="rounded-md bg-[#00E5D1] px-4 py-2 text-sm font-bold text-[#0B0E11] transition hover:brightness-110"
              >
                Start Weaving
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
