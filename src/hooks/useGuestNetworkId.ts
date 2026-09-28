import { useMemo, useState } from "react";
import { useAuth } from "./useAuth";
import { useZones } from "./useZones";

/**
 * Network id for guest pass / schedule screens.
 * Always includes the account `zone_id` even when GET /zones returns no map zones.
 */
export function useGuestNetworkId() {
  const { user } = useAuth();
  const userZoneId = String(user?.zone_id ?? user?.zoneId ?? "").trim();
  const isAdmin = String(user?.role ?? "").toLowerCase() === "administrator";
  const { zones, loading } = useZones(userZoneId || null, {
    role: user?.role,
    currentUserId: user?.id != null ? String(user.id) : null,
    accountOwnerId:
      user?.account_owner_id != null ? String(user.account_owner_id) : null,
  });
  const [pickedZoneId, setPickedZoneId] = useState("");

  const options = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (raw: unknown) => {
      const str = String(raw ?? "").trim();
      if (!str || seen.has(str)) return;
      seen.add(str);
      out.push(str);
    };
    push(userZoneId);
    for (const z of zones ?? []) push(z.zone_id);
    return out;
  }, [userZoneId, zones]);

  const zoneId = pickedZoneId.trim() || options[0] || "";

  return {
    zoneId,
    options,
    loading,
    isAdmin,
    setPickedZoneId,
  };
}
