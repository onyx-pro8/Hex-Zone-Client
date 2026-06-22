import { useEffect } from "react";
import { updateLocation } from "../services/api/members";

/** How often we push GPS to the server for in-zone recipient matching. */
const SYNC_INTERVAL_MS = 30_000;

/**
 * Periodically publishes the browser's GPS position to the server
 * (`POST /members/location`) so this user can be matched as an in-zone
 * recipient for geo messages (PA / PANIC / WELLNESS / PRIVATE, etc.).
 *
 * Zone-based delivery resolves recipients from each owner's stored
 * `owners.latitude/longitude`; without this sync a user physically inside a
 * zone is never found and silently receives nothing. No-op when there is no
 * auth token or the browser has no Geolocation support.
 */
export function useLocationSync(token: string | null) {
  useEffect(() => {
    if (!token) return;
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      return;
    }

    let cancelled = false;
    const push = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;
          void updateLocation({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          });
        },
        () => {
          /* permission denied / unavailable — ignore and retry next tick */
        },
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
      );
    };

    push();
    const id = setInterval(push, SYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token]);
}
