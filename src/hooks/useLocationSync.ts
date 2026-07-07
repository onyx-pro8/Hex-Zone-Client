import { useEffect } from "react";
import { updateLocation } from "../services/api/members";

/** How often we push GPS to the server for in-zone recipient matching. */
const SYNC_INTERVAL_MS = 30_000;

/**
 * Periodically publishes the browser's GPS position to the server
 * (`POST /members/location`) so dynamic zones and live geo workflows have
 * a current position in `member_locations`. Home address coords on the owner
 * profile are not updated by this sync.
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
