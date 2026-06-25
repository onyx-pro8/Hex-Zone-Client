import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, Mail, Users, Settings as SettingsIcon } from "lucide-react";
import { Logo } from "./Logo";
import { useAuth } from "../../hooks/useAuth";
import { AlertBellButton } from "./AlertBellButton";

const TITLES: Record<string, string> = {
  "/dashboard": "Overview",
  "/messages": "Messages",
  "/alerts": "Incoming alarms",
  "/members": "Members",
  "/emergency-log": "Emergency Log",
  "/settings": "Settings",
  "/devices": "Devices",
  "/guest-passes": "Guest Passes",
  "/guest-arrival-messages": "Guest Arrival Settings",
  "/guest-access-qr": "Guest QR",
  "/qr": "QR invite",
  "/api": "API",
};

const MOBILE_NAV = [
  { path: "/dashboard", title: "Overview", icon: LayoutDashboard },
  { path: "/messages", title: "Messages", icon: Mail },
  { path: "/members", title: "Members", icon: Users },
  { path: "/settings", title: "Settings", icon: SettingsIcon },
];

const mobileLinkCls = ({ isActive }: { isActive: boolean }) =>
  `inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
    isActive ? "bg-[#2F80ED] text-white" : "text-[#566784] hover:bg-[#EDF3FB]"
  }`;

export function AppHeader() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const title = TITLES[pathname] ?? "Safe Zone Patrol";

  return (
    <header className="sticky top-0 z-[1100] border-b border-[#DCE6F2] bg-white/90 backdrop-blur">
      <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="md:hidden">
            <Logo showWordmark={false} size={34} />
          </span>
          <h1 className="text-lg font-bold text-[#0F2C5C]">{title}</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-[#566784] sm:inline">
            {user?.name ?? "Member"}
          </span>
          <AlertBellButton />
        </div>
      </div>
      <nav className="flex gap-2 overflow-x-auto border-t border-[#DCE6F2] px-4 py-2 md:hidden">
        {MOBILE_NAV.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink key={item.path} to={item.path} className={mobileLinkCls}>
              <Icon className="h-4 w-4" /> {item.title}
            </NavLink>
          );
        })}
      </nav>
    </header>
  );
}
