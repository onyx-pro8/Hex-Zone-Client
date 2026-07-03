import { useCallback, useEffect, useState } from "react";
import { request } from "../services/api/client";

export type SavedZone = {
  zone_id?: number | string;
  id: number | string;
  name?: string;
  type?: string;
  owner_id?: number | string;
  creator_id?: number | string;
  zone_type?: string;
  geometry?: Record<string, unknown>;
  config?: Record<string, unknown>;
  h3_cells?: string[];
  geo_fence?: [number, number][];
  geo_fence_polygon?: unknown;
  polygons?: unknown;
  can_edit?: boolean;
};

export type ZonesCapabilities = {
  can_create_zone: boolean;
  can_edit_active_zone?: boolean;
  remaining_total?: number;
  remaining_for_role?: number;
  remaining_for_current_user_role?: number;
  role?: "administrator" | "standard" | string;
  reason?: string;
  max_total?: number;
};

type ZonesPayload = {
  data: SavedZone[];
  capabilities: ZonesCapabilities | null;
};

function getZoneId(zone: SavedZone): number | string {
  return zone.id;
}

function asCellList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function asGeoFence(value: unknown): [number, number][] | undefined {
  if (!Array.isArray(value)) return undefined;
  const points = value
    .map((row) => {
      if (!Array.isArray(row) || row.length < 2) return null;
      const lat = Number(row[0]);
      const lng = Number(row[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return [lat, lng] as [number, number];
    })
    .filter((pt): pt is [number, number] => pt !== null);
  return points.length >= 3 ? points : undefined;
}

function normalizeSavedZone(raw: unknown): SavedZone | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const config =
    row.config && typeof row.config === "object"
      ? (row.config as Record<string, unknown>)
      : null;

  const rawId = row.id ?? row.zone_id ?? row.zoneId;
  if (rawId == null) return null;
  const rawZoneId = row.zone_id ?? row.zoneId ?? rawId;

  const h3Cells = asCellList(
    row.h3_cells ?? row.h3Cells ?? config?.h3Cells ?? config?.h3_cells,
  );

  const geometryObj =
    row.geometry && typeof row.geometry === "object"
      ? (row.geometry as Record<string, unknown>)
      : null;
  const rawPolygon =
    row.geo_fence_polygon ??
    geometryObj?.geo_fence_polygon ??
    (geometryObj?.type === "Polygon" || geometryObj?.type === "MultiPolygon"
      ? geometryObj
      : null) ??
    config?.geo_fence_polygon ??
    row.polygons;
  const rawGeoFence = row.geo_fence ?? config?.geo_fence;
  const geometry =
    row.geometry && typeof row.geometry === "object"
      ? (row.geometry as Record<string, unknown>)
      : undefined;
  const configMap =
    row.config && typeof row.config === "object"
      ? (row.config as Record<string, unknown>)
      : undefined;
  const zoneType =
    typeof row.zone_type === "string"
      ? row.zone_type
      : typeof row.type === "string"
        ? row.type
        : undefined;

  return {
    id: String(rawId),
    zone_id: String(rawZoneId),
    name: typeof row.name === "string" ? row.name : undefined,
    type: typeof row.type === "string" ? row.type : zoneType,
    owner_id:
      row.owner_id != null
        ? (row.owner_id as number | string)
        : row.ownerId != null
          ? (row.ownerId as number | string)
          : row.account_owner_id != null
            ? (row.account_owner_id as number | string)
            : row.accountOwnerId != null
              ? (row.accountOwnerId as number | string)
              : row.owner &&
                  typeof row.owner === "object" &&
                  (row.owner as Record<string, unknown>).id != null
                ? ((row.owner as Record<string, unknown>).id as number | string)
              : undefined,
    creator_id:
      row.creator_id != null
        ? (row.creator_id as number | string)
        : row.creatorId != null
          ? (row.creatorId as number | string)
          : row.created_by != null
            ? (row.created_by as number | string)
            : row.createdBy != null
              ? (row.createdBy as number | string)
              : row.user_id != null
                ? (row.user_id as number | string)
                : row.userId != null
                  ? (row.userId as number | string)
                  : row.user &&
                      typeof row.user === "object" &&
                      (row.user as Record<string, unknown>).id != null
                    ? ((row.user as Record<string, unknown>).id as number | string)
                    : undefined,
    zone_type: zoneType,
    geometry,
    config: configMap,
    h3_cells: h3Cells,
    geo_fence: asGeoFence(rawGeoFence),
    geo_fence_polygon: rawPolygon,
    polygons: row.polygons,
    can_edit:
      typeof row.can_edit === "boolean"
        ? row.can_edit
        : typeof row.canEdit === "boolean"
          ? row.canEdit
          : undefined,
  };
}

function normalizeZoneList(value: unknown): SavedZone[] {
  if (Array.isArray(value)) {
    return value
      .map((zone) => normalizeSavedZone(zone))
      .filter((zone): zone is SavedZone => zone !== null);
  }
  if (value && typeof value === "object" && "data" in value) {
    return normalizeZoneList((value as { data?: unknown }).data);
  }
  return [];
}

function normalizeCapabilities(value: unknown): ZonesCapabilities | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const canCreate = row.can_create_zone;
  if (typeof canCreate !== "boolean") return null;
  return {
    can_create_zone: canCreate,
    can_edit_active_zone:
      typeof row.can_edit_active_zone === "boolean"
        ? row.can_edit_active_zone
        : undefined,
    remaining_total:
      typeof row.remaining_total === "number" ? row.remaining_total : undefined,
    remaining_for_role:
      typeof row.remaining_for_role === "number" ? row.remaining_for_role : undefined,
    remaining_for_current_user_role:
      typeof row.remaining_for_current_user_role === "number"
        ? row.remaining_for_current_user_role
        : typeof row.remaining_for_role === "number"
          ? row.remaining_for_role
          : undefined,
    role: typeof row.role === "string" ? row.role : undefined,
    reason: typeof row.reason === "string" ? row.reason : undefined,
    max_total: typeof row.max_total === "number" ? row.max_total : undefined,
  };
}

function normalizeZonesPayload(value: unknown): ZonesPayload {
  if (Array.isArray(value)) {
    return { data: normalizeZoneList(value), capabilities: null };
  }
  if (value && typeof value === "object" && "data" in value) {
    const row = value as { data?: unknown; capabilities?: unknown };
    const capabilities = normalizeCapabilities(row.capabilities);
    if (Array.isArray(row.data)) {
      return { data: normalizeZoneList(row.data), capabilities };
    }
    if (row.data && typeof row.data === "object") {
      const inner = row.data as { data?: unknown; capabilities?: unknown };
      return {
        data: normalizeZoneList(inner.data),
        capabilities: capabilities ?? normalizeCapabilities(inner.capabilities),
      };
    }
    console.warn("Unexpected zones payload shape from API", row);
    return { data: [], capabilities };
  }
  return { data: [], capabilities: null };
}

async function fetchAccountZones(ownerZoneId: number | string): Promise<ZonesPayload> {
  const primary = await request<unknown>({ method: "GET", url: "/zones" });
  const primaryPayload = normalizeZonesPayload(primary.data);
  if (primaryPayload.data.length > 0 || primaryPayload.capabilities) {
    return primaryPayload;
  }
  const alt = await request<unknown[]>({
    method: "GET",
    url: "/zones/",
    params: { zone_id: ownerZoneId },
  });
  return normalizeZonesPayload(alt.data);
}

export function useZones(
  ownerZoneId: number | string | null,
  scope?: {
    role?: string | null;
    currentUserId?: string | null;
    accountOwnerId?: string | null;
  },
) {
  const [zones, setZones] = useState<SavedZone[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<ZonesCapabilities | null>(null);

  const refresh = useCallback(async () => {
    if (ownerZoneId == null || ownerZoneId === "") {
      setZones([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchAccountZones(ownerZoneId);
      setZones(payload.data);
      setCapabilities(payload.capabilities);
    } catch {
      setError("Could not load saved zones.");
    } finally {
      setLoading(false);
    }
  }, [ownerZoneId, scope?.accountOwnerId, scope?.currentUserId, scope?.role]);

  const saveZone = useCallback(
    async (payload: Record<string, unknown>) => {
      if (ownerZoneId == null || ownerZoneId === "") {
        throw new Error("Missing owner network id");
      }
      const createResult = await request<SavedZone>({
        method: "POST",
        url: "/zones",
        data: { ...payload, zone_id: String(ownerZoneId) },
      });
      if (!createResult.data || createResult.error) {
        throw new Error(createResult.error ?? "Zone save failed");
      }
      await refresh();
      return createResult.data;
    },
    [ownerZoneId, refresh],
  );

  const saveZoneWithRebalance = useCallback(
    async (payload: Record<string, unknown>) => {
      if (ownerZoneId == null || ownerZoneId === "") {
        throw new Error("Missing owner network id");
      }

      const ownerZones = (await fetchAccountZones(ownerZoneId)).data;

      const incomingCells = asCellList(payload.h3_cells);
      const incomingSet = new Set(incomingCells);
      const seenIncomingInPrevious = new Set<string>();

      const updates = ownerZones
        .map((zone: SavedZone) => {
          const oldCells = asCellList(zone.h3_cells);
          const nextCells = oldCells.filter((c) => incomingSet.has(c));
          const changed =
            nextCells.length !== oldCells.length ||
            nextCells.some((c, i) => c !== oldCells[i]);

          oldCells.forEach((c) => {
            if (incomingSet.has(c)) seenIncomingInPrevious.add(c);
          });

          return { zone, nextCells, changed };
        })
        .filter((u: { changed: boolean }) => u.changed);

      await Promise.all(
        updates.map(
          ({ zone, nextCells }: { zone: SavedZone; nextCells: string[] }) => {
          const z = zone as Record<string, unknown>;
          const { id, ...rest } = z;
          return request<SavedZone>({
            method: "PATCH",
            url: `/zones/${getZoneId(zone)}`,
            data: {
              ...rest,
              h3_cells: nextCells,
            },
          });
          },
        ),
      );

      const dedupedIncoming = Array.from(new Set(incomingCells));
      const filteredNewCells = dedupedIncoming.filter(
        (c) => !seenIncomingInPrevious.has(c),
      );
      const toSave = {
        ...payload,
        zone_id: String(ownerZoneId),
        h3_cells: filteredNewCells,
      };
      const createResult = await request<SavedZone>({
        method: "POST",
        url: "/zones",
        data: toSave,
      });
      if (!createResult.data || createResult.error) {
        throw new Error(createResult.error ?? "Zone save failed");
      }
      await refresh();
      return {
        saved: createResult.data,
        filteredNewCells,
        removedFromNewCount: dedupedIncoming.length - filteredNewCells.length,
        updatedPreviousZonesCount: updates.length,
      };
    },
    [ownerZoneId, refresh],
  );

  const updateSavedZone = useCallback(
    async (zoneRef: number | string, payload: Record<string, unknown>) => {
      const updateResult = await request<SavedZone>({
        method: "PATCH",
        url: `/zones/${zoneRef}`,
        data: payload,
      });
      if (!updateResult.data || updateResult.error) {
        throw new Error(updateResult.error ?? "Zone update failed");
      }
      await refresh();
      return updateResult.data;
    },
    [refresh],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    zones,
    capabilities,
    loading,
    error,
    refresh,
    saveZone,
    saveZoneWithRebalance,
    updateSavedZone,
  };
}
