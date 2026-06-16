import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  MapPin,
  Mail,
  Users,
  Ticket,
  NotebookPen,
  ScanLine,
  QrCode,
  Shield,
  Siren,
  Settings as SettingsIcon,
  Terminal,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { Logo } from "./Logo";
import { useAuth } from "../../hooks/useAuth";

type NavItem = { path: string; title: string; icon: LucideIcon };

const PRIMARY_ITEMS: NavItem[] = [
  { path: "/dashboard", title: "Overview", icon: LayoutDashboard },
  { path: "/messages", title: "Messages", icon: Mail },
  { path: "/members", title: "Members", icon: Users },
  { path: "/settings", title: "Settings", icon: SettingsIcon },
];

const SECONDARY_ITEMS: NavItem[] = [
  { path: "/emergency-log", title: "Emergency Log", icon: Siren },
  { path: "/devices", title: "Devices", icon: Shield },
  { path: "/guest-passes", title: "Guest Passes", icon: Ticket },
  { path: "/guest-arrival-messages", title: "Guest Arrival Settings", icon: NotebookPen },
  { path: "/guest-access-qr", title: "Guest QR", icon: ScanLine },
  { path: "/qr", title: "QR invite", icon: QrCode },
  { path: "/api", title: "API", icon: Terminal },
];

const linkCls = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
    isActive
      ? "bg-[#2F80ED] text-white shadow-sm"
      : "text-[#566784] hover:bg-[#EDF3FB] hover:text-[#0F2C5C]"
  }`;

export function Sidebar() {
  const { user, logout } = useAuth();
  const isAdministrator =
    String(user?.role ?? "").toLowerCase() === "administrator";
  const normalizedAccountType = String(
    user?.accountType ?? user?.account_type ?? "",
  ).toUpperCase();
  const canInviteUserMember =
    isAdministrator &&
    (normalizedAccountType === "PRIVATE" || normalizedAccountType === "EXCLUSIVE");

  const secondary = SECONDARY_ITEMS.filter((item) => {
    if (item.path === "/qr") return canInviteUserMember;
    if (item.path === "/guest-access-qr") return isAdministrator;
    if (item.path === "/guest-arrival-messages") return isAdministrator;
    if (item.path === "/emergency-log") return isAdministrator;
    return true;
  });

  return (
    <aside className="fixed inset-y-0 left-0 z-[1100] hidden h-screen w-64 shrink-0 flex-col border-r border-[#DCE6F2] bg-white md:flex">
      <div className="flex h-16 items-center border-b border-[#DCE6F2] px-4">
        <Logo />
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {PRIMARY_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink key={item.path} to={item.path} className={linkCls}>
              <Icon className="h-4 w-4 shrink-0" />
              {item.title}
            </NavLink>
          );
        })}
        <div className="my-3 border-t border-[#DCE6F2]" />
        <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-[#8694AC]">
          Management
        </p>
        {secondary.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink key={item.path} to={item.path} className={linkCls}>
              <Icon className="h-4 w-4 shrink-0" />
              {item.title}
            </NavLink>
          );
        })}
      </nav>
      <div className="border-t border-[#DCE6F2] p-3">
        <div className="mb-2 flex items-center gap-3 rounded-lg px-3 py-2">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-[#EDF3FB]">
            <MapPin className="h-4 w-4 text-[#2F80ED]" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[#0F2C5C]">
              {user?.name ?? "Member"}
            </p>
            <p className="truncate text-xs text-[#8694AC]">
              {user?.email ?? String(user?.role ?? "")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-[#E23B4E] transition hover:bg-[#FCE7EA]"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    </aside>
  );
}
