import { useEffect, useState } from "react";
import { AlertTriangle, BellRing, X } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useAlarmNotifications } from "../hooks/useAlarmNotifications";
import {
  browserSupportsNotifications,
  notificationPermission,
  requestAlarmNotificationPermission,
} from "../lib/alarmNotifications";

const PERMISSION_BANNER_DISMISSED_KEY = "hexzone-alarm-permission-banner-dismissed";

/**
 * Mounted near the application root. While the user is authenticated:
 *  - Asks for browser notification permission (one-time, dismissible banner).
 *  - Subscribes to the realtime feed and renders any incoming alarms as a
 *    floating stack of toasts in the top-right of the viewport.
 *
 * The toasts are intentionally lightweight (no router dependency, no portal)
 * so they render correctly on every authenticated page.
 */
export function AlarmNotificationsHost() {
  const { token } = useAuth();
  const { activeAlarms, dismissAlarm } = useAlarmNotifications(token);
  const [permission, setPermission] = useState<ReturnType<typeof notificationPermission>>(() =>
    notificationPermission(),
  );
  const [bannerDismissed, setBannerDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(PERMISSION_BANNER_DISMISSED_KEY) === "1";
  });

  useEffect(() => {
    setPermission(notificationPermission());
  }, [token]);

  if (!token) {
    return null;
  }

  const showPermissionBanner =
    browserSupportsNotifications() && permission === "default" && !bannerDismissed;

  const handleEnable = async () => {
    const next = await requestAlarmNotificationPermission();
    setPermission(next);
    if (next !== "default") {
      window.localStorage.setItem(PERMISSION_BANNER_DISMISSED_KEY, "1");
      setBannerDismissed(true);
    }
  };

  const handleDismissBanner = () => {
    window.localStorage.setItem(PERMISSION_BANNER_DISMISSED_KEY, "1");
    setBannerDismissed(true);
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-[1200] flex flex-col items-end gap-3 px-4 sm:px-6">
      {showPermissionBanner ? (
        <div className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border border-[#E0992A]/40 bg-[#FBEFD8] px-4 py-3 text-sm text-[#8A5A12] shadow-lg backdrop-blur">
          <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-[#E0992A]" />
          <div className="flex-1 leading-snug">
            <p className="font-semibold">Enable alarm notifications</p>
            <p className="text-[#8A5A12]/90">
              Get a browser popup the moment a PANIC, SENSOR or UNKNOWN alarm reaches this account
              — even when this tab is in the background.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="rounded-lg bg-[#E0992A] px-3 py-1 text-xs font-semibold text-white hover:brightness-110"
                onClick={() => void handleEnable()}
              >
                Enable notifications
              </button>
              <button
                type="button"
                className="rounded-lg border border-[#E0992A]/40 px-3 py-1 text-xs text-[#8A5A12] hover:bg-[#FBEFD8]"
                onClick={handleDismissBanner}
              >
                Not now
              </button>
            </div>
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            className="text-[#E0992A] hover:text-[#8A5A12]"
            onClick={handleDismissBanner}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {activeAlarms.map((alarm) => {
        const isNsPanic =
          String(alarm.type).toUpperCase().replace(/-/g, "_") === "NS_PANIC";
        return (
          <div
            key={alarm.id}
            className={[
              "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border px-4 py-3 text-sm shadow-2xl backdrop-blur",
              isNsPanic
                ? "border-[#B5179E]/50 bg-[#F6E1F2] text-[#6A1060] ring-2 ring-[#B5179E]/40"
                : "border-[#E23B4E]/40 bg-[#FCE7EA] text-[#7A1622]",
            ].join(" ")}
            role="alert"
          >
            <AlertTriangle
              className={[
                "mt-0.5 h-5 w-5 shrink-0",
                isNsPanic ? "text-[#B5179E]" : "text-[#E23B4E]",
              ].join(" ")}
            />
            <div className="flex-1 leading-snug">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold uppercase tracking-wide">
                  {isNsPanic ? `🔕 ${alarm.title}` : alarm.title}
                </p>
                <span
                  className={`text-xs ${isNsPanic ? "text-[#9A2A8C]" : "text-[#B23A48]"}`}
                >
                  {new Date(alarm.createdAt).toLocaleTimeString()}
                </span>
              </div>
              <p className={isNsPanic ? "text-[#6A1060]/90" : "text-[#7A1622]/90"}>
                {alarm.body}
              </p>
            </div>
            <button
              type="button"
              aria-label="Dismiss alarm"
              className={
                isNsPanic
                  ? "text-[#B5179E] hover:text-[#6A1060]"
                  : "text-[#E23B4E] hover:text-[#7A1622]"
              }
              onClick={() => dismissAlarm(alarm.id)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
