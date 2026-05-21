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
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-end gap-3 px-4 sm:px-6">
      {showPermissionBanner ? (
        <div className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 shadow-lg backdrop-blur">
          <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
          <div className="flex-1 leading-snug">
            <p className="font-semibold">Enable alarm notifications</p>
            <p className="text-amber-100/80">
              Get a browser popup the moment a PANIC, SENSOR or UNKNOWN alarm reaches this account
              — even when this tab is in the background.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="rounded-lg bg-amber-400/90 px-3 py-1 text-xs font-semibold text-slate-900 hover:bg-amber-300"
                onClick={() => void handleEnable()}
              >
                Enable notifications
              </button>
              <button
                type="button"
                className="rounded-lg border border-amber-400/40 px-3 py-1 text-xs text-amber-100 hover:bg-amber-500/10"
                onClick={handleDismissBanner}
              >
                Not now
              </button>
            </div>
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            className="text-amber-300 hover:text-amber-100"
            onClick={handleDismissBanner}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {activeAlarms.map((alarm) => (
        <div
          key={alarm.id}
          className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border border-rose-500/40 bg-rose-600/15 px-4 py-3 text-sm text-rose-50 shadow-2xl backdrop-blur"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-300" />
          <div className="flex-1 leading-snug">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold uppercase tracking-wide">{alarm.title}</p>
              <span className="text-xs text-rose-200/80">
                {new Date(alarm.createdAt).toLocaleTimeString()}
              </span>
            </div>
            <p className="text-rose-100/90">{alarm.body}</p>
          </div>
          <button
            type="button"
            aria-label="Dismiss alarm"
            className="text-rose-200 hover:text-white"
            onClick={() => dismissAlarm(alarm.id)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
