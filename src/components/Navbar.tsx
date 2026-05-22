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
  { path: "/guest-arrival-messages", title: "Guest arrival copy", icon: NotebookPen },
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
  "inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-slate-700/80 bg-[#151a20]/90 px-4 py-2 text-sm text-slate-200 transition hover:border-[#00E5D1]/50 hover:text-[#00E5D1]";

const accountBtnClassName =
  "inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-slate-700/80 bg-[#151a20]/90 px-4 py-2 text-sm text-slate-200 transition hover:border-[#00E5D1]/50 hover:text-[#00E5D1]";

const signOutOnlyBtnClassName =
  "inline-flex shrink-0 whitespace-nowrap rounded-md border border-slate-700/80 bg-[#151a20]/90 px-4 py-2 text-sm text-slate-200 transition hover:border-[#00E5D1]/50 hover:text-[#00E5D1]";

export default function Navbar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, token, logout } = useAuth();
  const guestToken = getGuestAccessToken();
  const guestSessionActive = Boolean(guestToken);
  const isLoggedIn = Boolean(token);
  const normalizedAccountType = String(
    user?.accountType ?? user?.account_type ?? "",
  ).toUpperCase();
  const isAdministrator =
    String(user?.role ?? "").toLowerCase() === "administrator";
  // Member-invite QR is available to Private (multi-user) and Exclusive
  // (admin + 1 invited user) account administrators.
  const canInviteUserMember =
    isAdministrator &&
    (normalizedAccountType === "PRIVATE" ||
      normalizedAccountType === "EXCLUSIVE");

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
        ? "bg-[#00E5D1]/15 font-medium text-[#00E5D1]"
        : "text-slate-400 hover:bg-slate-800/80 hover:text-slate-100"
    }`;

  const dropdownLinkCls = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm transition ${
      isActive
        ? "bg-[#00E5D1]/15 font-medium text-[#00E5D1]"
        : "text-slate-300 hover:bg-slate-800/80 hover:text-slate-100"
    }`;

  const dropdownMenuButtonCls =
    "flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-sm text-slate-300 transition hover:bg-slate-800/80 hover:text-slate-100";

  const moreBtnClassName =
    "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-700/80 bg-[#151a20]/90 px-3 py-2 text-sm text-slate-200 transition hover:border-[#00E5D1]/50 hover:text-[#00E5D1]";

  return (
    <header className="border-b border-slate-800/80 bg-transparent backdrop-blur-xl fixed w-full z-50">
      <div
        className={`mx-auto flex w-full max-w-full items-center gap-3 sm:px-12 px-6 py-4 ${
          !showSessionNav ? "justify-between" : ""
        }`}
      >
        <Link
          to="/"
          className="group flex shrink-0 items-center gap-3 transition hover:opacity-95"
        >
          <div className="grid h-11 w-11 place-items-center rounded-md border-2 border-[#00E5D1]/80 bg-[#0B0E11]/40 shadow-[0_0_24px_-8px_rgba(0,229,209,0.35)]">
            <div className="h-4 w-4 rounded-full bg-[#00E5D1] transition group-hover:brightness-110" />
          </div>
          <div>
            <p className="text-lg uppercase font-bold tracking-[0.25em] text-slate-400">
              Zone Weaver
            </p>
            <p className="text-sm text-white group-hover:text-[#00E5D1]">
              weave your spatial network
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
                      moreOpen ? "border-[#00E5D1]/50 text-[#00E5D1]" : ""
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
                      className="absolute right-0 top-full z-[100] mt-2 flex w-56 min-w-[14rem] flex-col gap-0.5 rounded-lg border border-slate-700/80 bg-[#0B0E11]/95 p-2 shadow-xl backdrop-blur-xl"
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
                              <div className="my-1.5 border-t border-slate-800/80" />
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
          <div className="flex shrink-0 items-center gap-2">
            <Link
              to="/api"
              className="rounded-md border border-slate-700/80 bg-[#151a20]/90 px-4 py-2 text-sm text-slate-200 transition hover:border-[#00E5D1]/50 hover:text-[#00E5D1]"
            >
              <span className="inline-flex items-center gap-2">
                <Terminal size={14} /> API
              </span>
            </Link>

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
          </div>
        )}
      </div>
    </header>
  );
}
