import { useEffect, useMemo, useState } from "react";
import { getZones } from "../services/api/zones";
import { buildZoneNameLookup, type ZoneNameLookup } from "../lib/messageZoneLabel";

export function useZoneNameLookup(): {
  zoneNames: ZoneNameLookup;
  loading: boolean;
} {
  const [zoneNames, setZoneNames] = useState<ZoneNameLookup>(() => new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void getZones()
      .then((result) => {
        if (!active) return;
        setZoneNames(buildZoneNameLookup(result.data ?? []));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return useMemo(
    () => ({
      zoneNames,
      loading,
    }),
    [zoneNames, loading],
  );
}
