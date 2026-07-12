import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { canAdministratorInviteUserMember } from "../lib/accountLimits";
import {
  MapPin,
  Shield,
  Mail,
  Terminal,
  QrCode,
  Users,
  ScanLine,
  Ticket,
  NotebookPen,
  LayoutDashboard,
  MessageSquare,
  LogOut,
  ChevronDown,
} from "lucide-react";
import {
  clearGuestAccessSession,
  getGuestAccessToken,
} from "../lib/guestAccessToken";

const appRoutes = [
  { path: "/dashboard", title: "Dashboard", icon: MapPin },
  { path: "/devices", title: "Devices", icon: Shield },
  { path: "/messages", title: "Messages", icon: Mail },
  { path: "/members", title: "Members", icon: Users },
  { path: "/guest-passes", title: "Guest Passes", icon: Ticket },
  { path: "/guest-arrival-messages", title: "Guest Arrival Settings", icon: NotebookPen },
  { path: "/guest-access-qr", title: "Guest QR", icon: ScanLine },
  { path: "/qr", title: "QR invite", icon: QrCode },
];

const guestRoutes = [
  { path: "/guest/dashboard", title: "Guest dashboard", icon: LayoutDashboard },
  { path: "/guest/messages", title: "Guest messages", icon: MessageSquare },
];

type NavRouteItem = (typeof appRoutes)[number];

type SessionToolbarLayout = {
  /** Number of route tabs shown inline from the start of the list (0..routes.length). */
  visibleTabCount: number;
  apiInline: boolean;
  signoutInline: boolean;
};

const NAV_GAP_PX = 8;

function joinWithGap(widths: readonly number[]) {
  let sum = 0;
  for (let i = 0; i < widths.length; i++) {
    if (i > 0) sum += NAV_GAP_PX;
    sum += widths[i];
  }
  return sum;
}

type ToolbarEntry =
  | { type: "route"; route: NavRouteItem }
  | { type: "api" }
  | { type: "signout" }
  | { type: "guest-logout" };

const apiLinkClassName =
  "inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-[#DCE6F2] bg-white px-4 py-2 text-sm text-[#566784] transition hover:border-[#2F80ED]/50 hover:text-[#2F80ED]";

const accountBtnClassName =
  "inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-[#DCE6F2] bg-white px-4 py-2 text-sm text-[#566784] transition hover:border-[#2F80ED]/50 hover:text-[#2F80ED]";

const signOutOnlyBtnClassName =
  "inline-flex shrink-0 whitespace-nowrap rounded-md border border-[#DCE6F2] bg-white px-4 py-2 text-sm text-[#566784] transition hover:border-[#2F80ED]/50 hover:text-[#2F80ED]";

export default function Navbar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, token, logout } = useAuth();
  const guestToken = getGuestAccessToken();
  const guestSessionActive = Boolean(guestToken);
  const isLoggedIn = Boolean(token);
  const isAdministrator =
    String(user?.role ?? "").toLowerCase() === "administrator";
  const canInviteUserMember = canAdministratorInviteUserMember({
    role: user?.role,
    accountType: user?.accountType,
    legacyAccountType: user?.account_type,
  });

  const visibleAppRoutes = useMemo(
    () =>
      appRoutes.filter((route) => {
        if (route.path === "/qr") return canInviteUserMember;
        if (route.path === "/guest-access-qr") return isAdministrator;
        if (route.path === "/guest-arrival-messages") return isAdministrator;
        return true;
      }),
    [isAdministrator, canInviteUserMember],
  );

  const sessionNavRoutes: NavRouteItem[] = useMemo(() => {
    if (guestSessionActive) return guestRoutes as NavRouteItem[];
    if (isLoggedIn) return visibleAppRoutes;
    return [];
  }, [guestSessionActive, isLoggedIn, visibleAppRoutes]);

  const showSessionNav = guestSessionActive || isLoggedIn;

  const sessionRouteKey = useMemo(
    () => sessionNavRoutes.map((r) => r.path).join("|"),
    [sessionNavRoutes],
  );

  const navSlotRef = useRef<HTMLDivElement>(null);
  const routeMeasureRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const apiMeasureRef = useRef<HTMLSpanElement>(null);
  const accountMeasureRef = useRef<HTMLSpanElement>(null);
  const moreBtnMeasureRef = useRef<HTMLButtonElement>(null);
  const [layout, setLayout] = useState<SessionToolbarLayout>(() => ({
    visibleTabCount: sessionNavRoutes.length,
    apiInline: true,
    signoutInline: true,
  }));
  const [moreOpen, setMoreOpen] = useState(false);
  const moreWrapRef = useRef<HTMLDivElement>(null);

  const overflowToolbar: ToolbarEntry[] = useMemo(() => {
    const out: ToolbarEntry[] = [];
    out.push(
      ...sessionNavRoutes
        .slice(layout.visibleTabCount)
        .map((route) => ({ type: "route" as const, route })),
    );
    if (!layout.apiInline) out.push({ type: "api" as const });
    if (!layout.signoutInline) {
      out.push(
        guestSessionActive
          ? { type: "guest-logout" as const }
          : { type: "signout" as const },
      );
    }
    return out;
  }, [
    guestSessionActive,
    layout.apiInline,
    layout.signoutInline,
    layout.visibleTabCount,
    sessionNavRoutes,
  ]);

  useLayoutEffect(() => {
    if (!showSessionNav) return;
    const slot = navSlotRef.current;
    const n = sessionNavRoutes.length;
    if (!slot) return;

    let measureAttempts = 0;

    const compute = () => {
      const wApi = apiMeasureRef.current?.getBoundingClientRect().width ?? 0;
      const wAcct =
        accountMeasureRef.current?.getBoundingClientRect().width ?? 0;
      const moreW =
        moreBtnMeasureRef.current?.getBoundingClientRect().width ?? 52;
      const available = slot.clientWidth;
      if (available <= 0) return;

      if (n === 0) {
        if (wApi <= 0 || wAcct <= 0) {
          if (measureAttempts < 24) {
            measureAttempts += 1;
            requestAnimationFrame(compute);
          }
          return;
        }
        if (joinWithGap([wApi, wAcct]) <= available) {
          setLayout({
            visibleTabCount: 0,
            apiInline: true,
            signoutInline: true,
          });
          return;
        }
        if (joinWithGap([moreW, wAcct]) <= available) {
          setLayout({
            visibleTabCount: 0,
            apiInline: false,
            signoutInline: true,
          });
          return;
        }
        setLayout({
          visibleTabCount: 0,
          apiInline: false,
          signoutInline: false,
        });
        return;
      }

      const routeWidths = sessionNavRoutes.map((_, i) => {
        const el = routeMeasureRefs.current[i];
        return el ? el.getBoundingClientRect().width : 0;
      });
      if (routeWidths.some((w) => w <= 0) || wApi <= 0 || wAcct <= 0) {
        if (measureAttempts < 24) {
          measureAttempts += 1;
          requestAnimationFrame(compute);
        }
        return;
      }

      for (let k = n; k >= 1; k--) {
        const needMore = k < n;
        const parts: number[] = [...routeWidths.slice(0, k), wApi];
        if (needMore) parts.push(moreW);
        parts.push(wAcct);
        if (joinWithGap(parts) <= available) {
          setLayout({
            visibleTabCount: k,
            apiInline: true,
            signoutInline: true,
          });
          return;
        }
      }

      if (joinWithGap([moreW, wApi, wAcct]) <= available) {
        setLayout({
          visibleTabCount: 0,
          apiInline: true,
          signoutInline: true,
        });
        return;
      }
      if (joinWithGap([moreW, wAcct]) <= available) {
        setLayout({
          visibleTabCount: 0,
          apiInline: false,
          signoutInline: true,
        });
        return;
      }
      setLayout({
        visibleTabCount: 0,
        apiInline: false,
        signoutInline: false,
      });
    };

    compute();
    const ro = new ResizeObserver(() => {
      measureAttempts = 0;
      compute();
    });
    ro.observe(slot);
    return () => ro.disconnect();
  }, [
    guestSessionActive,
    pathname,
    sessionNavRoutes,
    sessionRouteKey,
    showSessionNav,
  ]);

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        moreWrapRef.current &&
        !moreWrapRef.current.contains(e.target as Node)
      ) {
        setMoreOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [moreOpen]);

  const navLinkCls = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-2 text-sm transition ${
      isActive
        ? "bg-[#EDF3FB] font-medium text-[#2F80ED]"
        : "text-[#566784] hover:bg-[#EDF3FB] hover:text-[#0F2C5C]"
    }`;

  const dropdownLinkCls = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm transition ${
      isActive
        ? "bg-[#EDF3FB] font-medium text-[#2F80ED]"
        : "text-[#566784] hover:bg-[#EDF3FB] hover:text-[#0F2C5C]"
    }`;

  const dropdownMenuButtonCls =
    "flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-sm text-[#566784] transition hover:bg-[#EDF3FB] hover:text-[#0F2C5C]";

  const moreBtnClassName =
    "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#DCE6F2] bg-white px-3 py-2 text-sm text-[#566784] transition hover:border-[#2F80ED]/50 hover:text-[#2F80ED]";

  return (
    <header className="fixed z-50 w-full border-b border-[#DCE6F2] bg-white/90 backdrop-blur-xl">
      <div
        className={`mx-auto flex w-full max-w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:gap-3 sm:px-6 sm:py-4 lg:px-12 ${
          !showSessionNav ? "justify-between" : ""
        }`}
      >
        <Link
          to="/"
          className="group flex min-w-0 shrink-0 items-center gap-2.5 transition hover:opacity-95 sm:gap-3"
        >
          <img
            src="/logo-mark.png"
            alt="Safe Zone Patrol"
            className="h-9 w-9 shrink-0 sm:h-11 sm:w-11"
          />
          <div className="min-w-0">
            <p className="truncate text-base font-extrabold tracking-tight text-[#0F2C5C] sm:text-lg">
              Safe <span className="text-[#2FA24A]">Zone</span> Patrol
            </p>
            <p className="hidden truncate text-sm text-[#8694AC] group-hover:text-[#2F80ED] sm:block">
              neighbourhood safety network
            </p>
          </div>
        </Link>

        {showSessionNav && (
          <div
            ref={navSlotRef}
            className="relative flex min-w-0 flex-1 items-center justify-end overflow-visible"
          >
            <div
              aria-hidden
              className="pointer-events-none fixed -left-[9999px] top-0 z-[-1] flex flex-row gap-2"
            >
              {sessionNavRoutes.map((item, i) => {
                const Icon = item.icon;
                return (
                  <span
                    key={`measure-${item.path}`}
                    ref={(el) => {
                      routeMeasureRefs.current[i] = el;
                    }}
                    className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm text-slate-400"
                  >
                    <Icon size={14} /> {item.title}
                  </span>
                );
              })}
              <span
                key="measure-api"
                ref={apiMeasureRef}
                className={apiLinkClassName}
              >
                <Terminal size={14} /> API
              </span>
              <span
                key="measure-account"
                ref={accountMeasureRef}
                className={
                  guestSessionActive
                    ? accountBtnClassName
                    : signOutOnlyBtnClassName
                }
              >
                {guestSessionActive ? (
                  <>
                    <LogOut size={14} /> Guest logout
                  </>
                ) : (
                  "Sign out"
                )}
              </span>
              <button
                ref={moreBtnMeasureRef}
                type="button"
                tabIndex={-1}
                className={moreBtnClassName}
              >
                More
                <ChevronDown size={14} />
              </button>
            </div>

            <nav className="flex min-w-0 max-w-full shrink items-center justify-end gap-2">
              {sessionNavRoutes.slice(0, layout.visibleTabCount).map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={navLinkCls}
                  >
                    <span className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap">
                      <Icon size={14} /> {item.title}
                    </span>
                  </NavLink>
                );
              })}

              {overflowToolbar.length > 0 && (
                <div ref={moreWrapRef} className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setMoreOpen((v) => !v)}
                    className={`${moreBtnClassName} ${
                      moreOpen ? "border-[#2F80ED]/50 text-[#2F80ED]" : ""
                    }`}
                    aria-expanded={moreOpen}
                    aria-haspopup="menu"
                  >
                    More
                    <ChevronDown
                      size={14}
                      className={`transition-transform ${moreOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                  {moreOpen && (
                    <nav
                      className="absolute right-0 top-full z-[100] mt-2 flex w-56 min-w-[14rem] flex-col gap-0.5 rounded-lg border border-[#DCE6F2] bg-white p-2 shadow-xl"
                      role="menu"
                    >
                      {overflowToolbar.map((entry, idx) => {
                        const key =
                          entry.type === "route"
                            ? entry.route.path
                            : entry.type;
                        const showAccountDivider =
                          (entry.type === "signout" ||
                            entry.type === "guest-logout") &&
                          idx > 0;

                        let row;
                        if (entry.type === "route") {
                          const Icon = entry.route.icon;
                          row = (
                            <NavLink
                              to={entry.route.path}
                              className={dropdownLinkCls}
                              onClick={() => setMoreOpen(false)}
                            >
                              <Icon size={14} /> {entry.route.title}
                            </NavLink>
                          );
                        } else if (entry.type === "api") {
                          row = (
                            <NavLink
                              to="/api"
                              className={dropdownLinkCls}
                              onClick={() => setMoreOpen(false)}
                            >
                              <Terminal size={14} /> API
                            </NavLink>
                          );
                        } else if (entry.type === "signout") {
                          row = (
                            <button
                              type="button"
                              className={dropdownMenuButtonCls}
                              onClick={() => {
                                setMoreOpen(false);
                                void logout();
                              }}
                            >
                              <LogOut size={14} /> Sign out
                            </button>
                          );
                        } else {
                          row = (
                            <button
                              type="button"
                              className={dropdownMenuButtonCls}
                              onClick={() => {
                                setMoreOpen(false);
                                clearGuestAccessSession();
                                navigate("/access", { replace: true });
                              }}
                            >
                              <LogOut size={14} /> Guest logout
                            </button>
                          );
                        }

                        return (
                          <Fragment key={key}>
                            {showAccountDivider && (
                              <div className="my-1.5 border-t border-[#DCE6F2]" />
                            )}
                            {row}
                          </Fragment>
                        );
                      })}
                    </nav>
                  )}
                </div>
              )}
              {layout.apiInline && (
                <Link to="/api" className={apiLinkClassName}>
                  <Terminal size={14} /> API
                </Link>
              )}
              {layout.signoutInline &&
                (guestSessionActive ? (
                  <button
                    type="button"
                    onClick={() => {
                      clearGuestAccessSession();
                      navigate("/access", { replace: true });
                    }}
                    className={accountBtnClassName}
                  >
                    <LogOut size={14} /> Guest logout
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      void logout();
                    }}
                    className={signOutOnlyBtnClassName}
                  >
                    Sign out
                  </button>
                ))}
            </nav>
          </div>
        )}

        {!showSessionNav && (
          <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
            <Link
              to="/api"
              className="inline-flex items-center gap-2 rounded-md border border-[#DCE6F2] bg-white px-4 py-2 text-sm text-[#566784] transition hover:border-[#2F80ED]/50 hover:text-[#2F80ED]"
            >
              <Terminal size={14} aria-hidden />
              <span>API</span>
            </Link>

            <Link
              to="/login"
              className="rounded-md border border-[#DCE6F2] bg-white px-4 py-2 text-sm text-[#566784] transition hover:border-[#2F80ED]/50 hover:text-[#2F80ED]"
            >
              Sign In
            </Link>
            <Link
              to="/register"
              className="rounded-md bg-[#2F80ED] px-4 py-2 text-sm font-bold text-white transition hover:brightness-110"
            >
              Get Started
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
