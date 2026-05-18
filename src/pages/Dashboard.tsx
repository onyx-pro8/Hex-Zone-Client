import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as turf from "@turf/turf";
import { cellToParent, getResolution, isValidCell } from "h3-js";
import {
  Copy,
  Download,
  LocateFixed,
  MapPin,
  Ruler,
  Trash2,
  Upload,
} from "lucide-react";
import HexMapperMap, {
  h3CellsAtPoint,
  type MapFitBoundsRequest,
  type SavedZoneCellLayer,
  type SavedZonePolygonLayer,
} from "../components/HexMapperMap";
import { AddressAutocompleteInput } from "../components/AddressAutocompleteInput";
import { GuestRequestsDashboardSection } from "../components/dashboard/GuestRequestsDashboardSection";
import { GuestAccessQrSection } from "../components/dashboard/GuestAccessQrSection";
import { useAuth } from "../hooks/useAuth";
import {
  useZones,
  type SavedZone,
} from "../hooks/useZones";
import {
  getCellFromCoords,
  h3ToPolygon,
  serializeCellCsv,
  AUTH_MAP_DEFAULT_CENTER,
} from "../lib/h3";
import {
  circleToPolygonRing,
  deletePolygonOuterVertex,
  distanceMeters,
  findPolygonContainingPoint,
  insertPolygonOuterVertex,
  movePolygonOuterVertex,
  newPolygonId,
  pointInPolygon,
  ringsNearlyClosed,
  type GeoPolygonShape,
  type LatLng,
} from "../lib/geoPoly";
import {
  exportPolygonsAsKML,
  exportPolygonsAsWKT,
  parseKmlToPolygons,
  parseWktToPolygons,
} from "../lib/wktKml";
import {
  cornersFromCircle,
  cornersFromH3Cell,
  cornersFromPolygonShape,
  cornersFromPolygonShapes,
  mergeFitBoundsCorners,
} from "../lib/mapBounds";
import {
  photonPlaceReferenceId,
  searchPhotonAddresses,
} from "../lib/addressSearch";
import {
  applyGovernmentFieldsFromConfig,
  buildGovernmentReferenceId,
  governmentAddressMatchesValidation,
  governmentAddressToConfig,
  governmentAddressValidatePayload,
  governmentReferenceIdFromConfig,
  isGovernmentAddressComplete,
  type GovernmentAddressFields,
  type GovernmentAddressMode,
} from "../lib/governmentAddress";
import {
  generateZoneReference,
  validateZoneReference,
  type ZoneReferenceValidateResult,
} from "../services/api/zoneReferences";

const accent = "#00E5D1";
const panel = "bg-[#151a20]";
/** Distinct map colors for saved zones (active zone uses gold highlight). */
const ZONE_MAP_COLORS = [
  "#00E5D1",
  "#06B6D4",
  "#A78BFA",
  "#F59E0B",
  "#22C55E",
  "#F472B6",
] as const;

type MapperMode = "h3" | "polygon";
type GeofenceDrawTool = "polygon" | "circle";
type ActiveTool = null | "measure";
type ValidReferenceValidation = {
  valid: true;
  referenceId: string;
  displayName?: string;
  geometry: Record<string, unknown>;
  config: Record<string, unknown>;
  h3Cells: string[];
  source?: string;
};

type ReferenceValidationState =
  | ValidReferenceValidation
  | { valid: false; message: string };

type ZoneTypeMode =
  | "geofence"
  | "grid"
  | "proximity"
  | "dynamic"
  | "communal_id"
  | "government_local_code"
  | "object";

type ProximitySourceMode = "current_location" | "map_pin";

type HexMapperExport = {
  version: 1;
  resolution: number;
  h3_cells: string[];
  polygons: GeoPolygonShape[];
  h3Color: string;
  h3OpacityPct: number;
  polygonColor: string;
  polygonOpacityPct: number;
};

type GeoJsonPolygon = {
  type: "Polygon";
  coordinates: number[][][];
};

type GeoJsonMultiPolygon = {
  type: "MultiPolygon";
  coordinates: number[][][][];
};

type ParsedGeoJsonMultiPolygon = {
  type: "MultiPolygon";
  coordinates: number[][][][];
};

function closeRingLatLng(ring: LatLng[]): LatLng[] {
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, first];
}

function ringLatLngToGeoJson(ring: LatLng[]): number[][] {
  return closeRingLatLng(ring).map(([lat, lng]) => [lng, lat]);
}

function polygonsToGeoFenceMultiPolygon(
  polygons: GeoPolygonShape[],
): GeoJsonMultiPolygon | undefined {
  if (polygons.length === 0) return undefined;
  return {
    type: "MultiPolygon",
    coordinates: polygons
      .map((p) => [p.outer, ...p.holes].filter((r) => r.length >= 3))
      .filter((rings) => rings.length > 0)
      .map((rings) => rings.map((r) => ringLatLngToGeoJson(r))),
  };
}

function geoJsonPolygonToShapes(value: unknown): GeoPolygonShape[] {
  if (!value || typeof value !== "object") return [];
  const g = value as { type?: unknown; coordinates?: unknown };
  if (!("type" in g) || !("coordinates" in g)) return [];

  const toRing = (ring: unknown): LatLng[] => {
    if (!Array.isArray(ring)) return [];
    return ring
      .map((pt) => {
        if (!Array.isArray(pt) || pt.length < 2) return null;
        const lng = Number(pt[0]);
        const lat = Number(pt[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return [lat, lng] as LatLng;
      })
      .filter((pt): pt is LatLng => pt !== null);
  };

  const asPolygon = (coords: unknown): GeoPolygonShape | null => {
    if (!Array.isArray(coords) || coords.length === 0) return null;
    const rings = coords.map((r) => toRing(r)).filter((r) => r.length >= 3);
    if (rings.length === 0) return null;
    return {
      id: newPolygonId(),
      outer: rings[0],
      holes: rings.slice(1),
    };
  };

  if (g.type === "Polygon") {
    const poly = asPolygon(g.coordinates);
    return poly ? [poly] : [];
  }
  if (g.type === "MultiPolygon" && Array.isArray(g.coordinates)) {
    return g.coordinates
      .map((polyCoords) => asPolygon(polyCoords))
      .filter((p): p is GeoPolygonShape => p !== null);
  }
  return [];
}

function ewkbHexToMultiPolygon(hex: string): ParsedGeoJsonMultiPolygon | null {
  const normalized = hex
    .trim()
    .replace(/^\\x/i, "")
    .replace(/^0x/i, "")
    .replace(/\s+/g, "");
  if (!/^[0-9a-f]+$/i.test(normalized) || normalized.length % 2 !== 0)
    return null;

  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const parseGeometry = (
    offsetStart: number,
  ): {
    value: ParsedGeoJsonMultiPolygon | GeoJsonPolygon | null;
    offset: number;
  } => {
    let offset = offsetStart;
    const byteOrder = view.getUint8(offset);
    offset += 1;
    const little = byteOrder === 1;
    const rawType = view.getUint32(offset, little);
    offset += 4;

    const hasSrid = (rawType & 0x20000000) !== 0;
    const baseType = rawType & 0xff;
    if (hasSrid) offset += 4;

    if (baseType === 3) {
      const ringCount = view.getUint32(offset, little);
      offset += 4;
      const polygon: GeoJsonPolygon = { type: "Polygon", coordinates: [] };
      for (let r = 0; r < ringCount; r += 1) {
        const pointCount = view.getUint32(offset, little);
        offset += 4;
        const ring: number[][] = [];
        for (let p = 0; p < pointCount; p += 1) {
          const x = view.getFloat64(offset, little);
          offset += 8;
          const y = view.getFloat64(offset, little);
          offset += 8;
          ring.push([x, y]);
        }
        polygon.coordinates.push(ring);
      }
      return { value: polygon, offset };
    }

    if (baseType === 6) {
      const polygonCount = view.getUint32(offset, little);
      offset += 4;
      const multi: ParsedGeoJsonMultiPolygon = {
        type: "MultiPolygon",
        coordinates: [],
      };
      for (let i = 0; i < polygonCount; i += 1) {
        const parsed = parseGeometry(offset);
        offset = parsed.offset;
        if (parsed.value?.type === "Polygon") {
          multi.coordinates.push(parsed.value.coordinates);
        }
      }
      return { value: multi, offset };
    }

    return { value: null, offset };
  };

  try {
    const parsed = parseGeometry(0).value;
    if (!parsed) return null;
    if (parsed.type === "Polygon") {
      return { type: "MultiPolygon", coordinates: [parsed.coordinates] };
    }
    return parsed;
  } catch {
    return null;
  }
}

function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normalizeGeoFencePolygonValue(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return value;
      }
    }
  }
  if (
    value &&
    typeof value === "object" &&
    "type" in (value as Record<string, unknown>) &&
    (value as Record<string, unknown>).type === "Buffer" &&
    Array.isArray((value as Record<string, unknown>).data)
  ) {
    const arr = (value as { data: unknown[] }).data
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n) && n >= 0 && n <= 255);
    return bytesToHex(arr);
  }
  if (
    value &&
    typeof value === "object" &&
    "geometry" in (value as Record<string, unknown>)
  ) {
    const g = (value as { geometry?: unknown }).geometry;
    if (g && typeof g === "object") return normalizeGeoFencePolygonValue(g);
  }
  if (
    value &&
    typeof value === "object" &&
    "geo_fence_polygon" in (value as Record<string, unknown>)
  ) {
    const nested = (value as { geo_fence_polygon?: unknown }).geo_fence_polygon;
    if (nested != null) return normalizeGeoFencePolygonValue(nested);
  }
  return value;
}

function zoneGeoFenceRaw(zone: SavedZone): unknown {
  if (zone.geo_fence_polygon != null) return zone.geo_fence_polygon;
  const geoFence = (zone as Record<string, unknown>).geoFencePolygon;
  if (geoFence != null) return geoFence;
  const geometry =
    zone.geometry && typeof zone.geometry === "object"
      ? (zone.geometry as Record<string, unknown>)
      : null;
  if (!geometry) return null;
  if (geometry.geo_fence_polygon != null) return geometry.geo_fence_polygon;
  if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
    return geometry;
  }
  return null;
}

function zoneToPolygons(zone: SavedZone): GeoPolygonShape[] {
  const rawGeo = zoneGeoFenceRaw(zone);
  const normalizedGeo = normalizeGeoFencePolygonValue(rawGeo);

  const fromGeoJson = geoJsonPolygonToShapes(normalizedGeo);
  if (fromGeoJson.length > 0) {
    return fromGeoJson;
  }
  if (typeof normalizedGeo === "string") {
    const parsed = ewkbHexToMultiPolygon(normalizedGeo);
    const fromEwkb = geoJsonPolygonToShapes(parsed);
    if (fromEwkb.length > 0) return fromEwkb;
  }
  if (Array.isArray(zone.polygons)) {
    return zone.polygons.filter(
      (p): p is GeoPolygonShape =>
        typeof p === "object" &&
        p !== null &&
        "id" in p &&
        "outer" in p &&
        "holes" in p,
    );
  }
  if (Array.isArray(zone.geo_fence) && zone.geo_fence.length >= 3) {
    return [{ id: newPolygonId(), outer: zone.geo_fence, holes: [] }];
  }
  return [];
}

function savedZoneId(zone: SavedZone): string {
  return String(zone.zone_id ?? zone.id);
}

function savedZoneRecordId(zone: SavedZone): string {
  return String(zone.id);
}

function normalizeZoneTypeValue(raw: unknown): ZoneTypeMode {
  const value = String(raw ?? "").toLowerCase();
  if (value === "grid" || value === "warn" || value === "alert") return "grid";
  if (value === "proximity") return "proximity";
  if (value === "dynamic" || value === "emergency") return "dynamic";
  if (value === "communal_id" || value === "custom_1") return "communal_id";
  if (value === "government_local_code" || value === "custom_2")
    return "government_local_code";
  if (value === "object") return "object";
  return "geofence";
}

function zoneConfigMap(zone: SavedZone): Record<string, unknown> {
  return zone.config && typeof zone.config === "object"
    ? (zone.config as Record<string, unknown>)
    : {};
}

function referenceValidationFromZone(
  zone: SavedZone,
  codeKey: "communal_id" | "local_code",
): ReferenceValidationState | null {
  const config = zoneConfigMap(zone);
  const raw =
    codeKey === "communal_id"
      ? config.communal_id
      : config.local_code ?? config.area_code;
  const referenceId =
    typeof raw === "string"
      ? codeKey === "communal_id"
        ? raw.trim().toUpperCase()
        : raw.replace(/\s+/g, "").toUpperCase()
      : "";
  if (!referenceId) return null;
  const polys = zoneToPolygons(zone);
  const rawFence = zoneGeoFenceRaw(zone);
  if (polys.length === 0 && rawFence == null) return null;
  const geometry =
    zone.geometry && typeof zone.geometry === "object"
      ? ({ ...(zone.geometry as Record<string, unknown>) } as Record<
          string,
          unknown
        >)
      : ({} as Record<string, unknown>);
  if (rawFence != null) {
    geometry.geo_fence_polygon = normalizeGeoFencePolygonValue(rawFence);
  }
  return {
    valid: true,
    referenceId,
    displayName: zone.name ?? undefined,
    geometry,
    config,
    h3Cells: Array.isArray(zone.h3_cells) ? [...zone.h3_cells] : [],
    source: "existing_zone",
  };
}

function communalValidationFromZone(zone: SavedZone): ReferenceValidationState | null {
  return referenceValidationFromZone(zone, "communal_id");
}

function governmentValidationFromZone(zone: SavedZone): ReferenceValidationState | null {
  const config = zoneConfigMap(zone);
  const referenceId = governmentReferenceIdFromConfig(config);
  if (!referenceId) return null;
  const polys = zoneToPolygons(zone);
  const rawFence = zoneGeoFenceRaw(zone);
  if (polys.length === 0 && rawFence == null) return null;
  const geometry =
    zone.geometry && typeof zone.geometry === "object"
      ? ({ ...(zone.geometry as Record<string, unknown>) } as Record<
          string,
          unknown
        >)
      : ({} as Record<string, unknown>);
  if (rawFence != null) {
    geometry.geo_fence_polygon = normalizeGeoFencePolygonValue(rawFence);
  }
  return {
    valid: true,
    referenceId,
    displayName: zone.name ?? undefined,
    geometry,
    config,
    h3Cells: Array.isArray(zone.h3_cells) ? [...zone.h3_cells] : [],
    source: "existing_zone",
  };
}

function extractZoneCenter(zone: SavedZone): [number, number] | null {
  const geometry =
    zone.geometry && typeof zone.geometry === "object" ? zone.geometry : null;
  const center =
    geometry && typeof geometry.center === "object" && geometry.center
      ? (geometry.center as Record<string, unknown>)
      : null;
  const latitude = Number(center?.latitude);
  const longitude = Number(center?.longitude);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return [latitude, longitude];
  }
  const config = zoneConfigMap(zone);
  const configLat = Number(config.latitude ?? config.lat);
  const configLng = Number(config.longitude ?? config.lng ?? config.lon);
  if (Number.isFinite(configLat) && Number.isFinite(configLng)) {
    return [configLat, normalizeLongitude(configLng)];
  }
  return null;
}

function isObjectZone(zone: SavedZone): boolean {
  if (normalizeZoneTypeValue(zone.type ?? zone.zone_type) === "object") return true;
  const config = zoneConfigMap(zone);
  return (
    typeof config.object_id === "string" &&
    config.object_id.trim().length > 0 &&
    Number(config.radius_meters) > 0
  );
}

function objectZoneRadiusMeters(zone: SavedZone): number {
  const config = zoneConfigMap(zone);
  const radius = Number(config.radius_meters);
  return Number.isFinite(radius) && radius > 0 ? radius : 250;
}

function proximitySourceModeFromZone(zone: SavedZone): ProximitySourceMode {
  const config = zoneConfigMap(zone);
  const raw = String(
    config.source_type ?? config.proximity_source_type ?? "",
  ).toLowerCase();
  if (raw === "map_pin" || raw === "map" || raw === "pin") return "map_pin";
  if (
    raw === "current_location" ||
    raw === "gps" ||
    raw === "location" ||
    raw === "my_location"
  ) {
    return "current_location";
  }
  return "map_pin";
}

function proximityRadiusFromZone(zone: SavedZone, fallback: number): number {
  const config = zoneConfigMap(zone);
  const radius = Number(config.radius_meters);
  return Number.isFinite(radius) && radius > 0 ? radius : fallback;
}

function loadProximityFromZone(
  zone: SavedZone,
  fallbackRadius: number,
): {
  sourceMode: ProximitySourceMode;
  center: [number, number] | null;
  radiusMeters: number;
} {
  const circles = parseCircleDraftsFromZone(zone, "proximity", {
    proximityRadiusMeters: fallbackRadius,
    dynamicMinRadiusMeters: 200,
    dynamicMaxRadiusMeters: 1000,
  });
  const center =
    extractZoneCenter(zone) ?? (circles.length > 0 ? circles[0].center : null);
  const radiusMeters =
    circles.length > 0
      ? circles[0].radiusMeters
      : proximityRadiusFromZone(zone, fallbackRadius);
  return {
    sourceMode: proximitySourceModeFromZone(zone),
    center,
    radiusMeters,
  };
}

function normalizeLongitude(value: number): number {
  // Keep longitudes visible in wrapped maps (e.g. -540 -> -180).
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

function parseCircleDraftsFromZone(
  zone: SavedZone,
  kind: "proximity" | "dynamic",
  defaults: {
    proximityRadiusMeters: number;
    dynamicMinRadiusMeters: number;
    dynamicMaxRadiusMeters: number;
  },
): DraftCircle[] {
  const geometry =
    zone.geometry && typeof zone.geometry === "object" ? zone.geometry : {};
  const config =
    zone.config && typeof zone.config === "object" ? zone.config : {};
  const circlesRaw = Array.isArray((geometry as Record<string, unknown>).circles)
    ? ((geometry as Record<string, unknown>).circles as unknown[])
    : [];
  const centersRaw = Array.isArray((geometry as Record<string, unknown>).centers)
    ? ((geometry as Record<string, unknown>).centers as unknown[])
    : [];
  const radiiRaw = Array.isArray((config as Record<string, unknown>).radii_meters)
    ? ((config as Record<string, unknown>).radii_meters as unknown[])
    : [];
  const rangesRaw = Array.isArray((config as Record<string, unknown>).circle_ranges)
    ? ((config as Record<string, unknown>).circle_ranges as unknown[])
    : [];
  const defaultProximity = Number(
    (config as Record<string, unknown>).radius_meters ?? defaults.proximityRadiusMeters,
  );
  const defaultDynamicMin = Number(
    (config as Record<string, unknown>).min_radius_meters ??
      defaults.dynamicMinRadiusMeters,
  );
  const defaultDynamicMax = Number(
    (config as Record<string, unknown>).max_radius_meters ??
      defaults.dynamicMaxRadiusMeters,
  );

  const makeCenter = (raw: unknown): [number, number] | null => {
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Record<string, unknown>;
    const lat = Number(row.latitude);
    const lng = Number(row.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return [lat, normalizeLongitude(lng)];
  };

  const fromCircles: DraftCircle[] = [];
  circlesRaw.forEach((raw, idx) => {
      if (!raw || typeof raw !== "object") return null;
      const row = raw as Record<string, unknown>;
      const center = makeCenter(row.center);
      if (!center) return null;
      if (kind === "proximity") {
        const radius = Number(row.radius_meters ?? defaultProximity);
        if (!Number.isFinite(radius) || radius <= 0) return null;
        fromCircles.push({
          id: `${kind}-${zone.id}-circle-${idx}`,
          center,
          radiusMeters: radius,
        });
        return null;
      }
      const minRadius = Number(row.min_radius_meters ?? defaultDynamicMin);
      const maxRadius = Number(row.max_radius_meters ?? defaultDynamicMax);
      const normalizedMin = Number.isFinite(minRadius) ? minRadius : defaultDynamicMin;
      const normalizedMax = Number.isFinite(maxRadius)
        ? Math.max(maxRadius, normalizedMin)
        : Math.max(defaultDynamicMax, normalizedMin);
      if (normalizedMax <= 0) return null;
      fromCircles.push({
        id: `${kind}-${zone.id}-circle-${idx}`,
        center,
        radiusMeters: normalizedMax,
        minRadiusMeters: Math.max(normalizedMin, 0),
        maxRadiusMeters: normalizedMax,
      });
      return null;
    });
  if (fromCircles.length > 0) return fromCircles;

  const fromCenters: DraftCircle[] = [];
  centersRaw.forEach((raw, idx) => {
      const center = makeCenter(raw);
      if (!center) return null;
      if (kind === "proximity") {
        const perCircleRadius = Number(radiiRaw[idx] ?? defaultProximity);
        if (!Number.isFinite(perCircleRadius) || perCircleRadius <= 0) return null;
        fromCenters.push({
          id: `${kind}-${zone.id}-center-${idx}`,
          center,
          radiusMeters: perCircleRadius,
        });
        return null;
      }
      const rangeRaw = rangesRaw[idx];
      const minRadius =
        rangeRaw && typeof rangeRaw === "object"
          ? Number((rangeRaw as Record<string, unknown>).min_radius_meters)
          : defaultDynamicMin;
      const maxRadius =
        rangeRaw && typeof rangeRaw === "object"
          ? Number((rangeRaw as Record<string, unknown>).max_radius_meters)
          : defaultDynamicMax;
      const normalizedMin = Number.isFinite(minRadius) ? minRadius : defaultDynamicMin;
      const normalizedMax = Number.isFinite(maxRadius)
        ? Math.max(maxRadius, normalizedMin)
        : Math.max(defaultDynamicMax, normalizedMin);
      if (normalizedMax <= 0) return null;
      fromCenters.push({
        id: `${kind}-${zone.id}-center-${idx}`,
        center,
        radiusMeters: normalizedMax,
        minRadiusMeters: Math.max(normalizedMin, 0),
        maxRadiusMeters: normalizedMax,
      });
      return null;
    });
  if (fromCenters.length > 0) return fromCenters;

  const singleCenter = extractZoneCenter(zone);
  if (!singleCenter) return [];
  if (kind === "proximity") {
    const radius = Number.isFinite(defaultProximity) ? defaultProximity : 0;
    return radius > 0
      ? [
          {
            id: `${kind}-${zone.id}-single`,
            center: singleCenter,
            radiusMeters: radius,
          },
        ]
      : [];
  }
  const minRadius = Number.isFinite(defaultDynamicMin) ? defaultDynamicMin : 0;
  const maxRadius = Number.isFinite(defaultDynamicMax)
    ? Math.max(defaultDynamicMax, minRadius)
    : minRadius;
  return maxRadius > 0
    ? [
        {
          id: `${kind}-${zone.id}-single`,
          center: singleCenter,
          radiusMeters: maxRadius,
          minRadiusMeters: minRadius,
          maxRadiusMeters: maxRadius,
        },
      ]
    : [];
}

type ZoneEntry = {
  zone: SavedZone;
  key: string;
  ownerId: string | null;
  creatorId: string | null;
  editable: boolean;
};

const MAX_ZONE_NAME_LENGTH = 120;

type DraftCircle = {
  id: string;
  center: [number, number];
  radiusMeters: number;
  minRadiusMeters?: number;
  maxRadiusMeters?: number;
};

function polygonKey(p: GeoPolygonShape): string {
  return JSON.stringify([p.outer, p.holes]);
}

function geoPolygonAreaKm2(p: GeoPolygonShape): number {
  try {
    const rings = [p.outer, ...p.holes].filter((r) => r.length >= 3);
    if (!rings.length) return 0;
    const coords = rings.map((ring) => {
      const c = [...ring];
      const a = c[0];
      const b = c[c.length - 1];
      if (a[0] !== b[0] || a[1] !== b[1]) c.push(a);
      return c.map(([lat, lng]) => [lng, lat] as [number, number]);
    });
    const poly = turf.polygon(coords);
    return turf.area(poly) / 1e6;
  } catch {
    return 0;
  }
}

function hasCrossResolutionOverlap(cells: string[]): boolean {
  const unique = new Set(
    cells.filter((cell) => typeof cell === "string" && isValidCell(cell)),
  );

  for (const cell of unique) {
    const resolution = getResolution(cell);
    for (let r = resolution - 1; r >= 0; r -= 1) {
      const parent = cellToParent(cell, r);
      if (unique.has(parent)) return true;
    }
  }
  return false;
}

function wouldOverlapAcrossResolutions(
  nextCell: string,
  existingCells: string[],
): boolean {
  if (!isValidCell(nextCell)) return false;
  const EPS = 1e-12;
  const nearlyEqual = (a: number, b: number) => Math.abs(a - b) <= EPS;
  const pointsEqual = (a: [number, number], b: [number, number]): boolean =>
    nearlyEqual(a[0], b[0]) && nearlyEqual(a[1], b[1]);
  const cross = (
    a: [number, number],
    b: [number, number],
    c: [number, number],
  ): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const isPointOnSegment = (
    p: [number, number],
    a: [number, number],
    b: [number, number],
  ): boolean => {
    if (Math.abs(cross(a, b, p)) > EPS) return false;
    const minX = Math.min(a[0], b[0]) - EPS;
    const maxX = Math.max(a[0], b[0]) + EPS;
    const minY = Math.min(a[1], b[1]) - EPS;
    const maxY = Math.max(a[1], b[1]) + EPS;
    return p[0] >= minX && p[0] <= maxX && p[1] >= minY && p[1] <= maxY;
  };
  const isPointStrictlyInsidePolygon = (
    point: [number, number],
    ring: [number, number][],
  ): boolean => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (isPointOnSegment(point, a, b)) return false;
      const intersects =
        a[1] > point[1] !== b[1] > point[1] &&
        point[0] <
          ((b[0] - a[0]) * (point[1] - a[1])) /
            (b[1] - a[1] || Number.EPSILON) +
            a[0];
      if (intersects) inside = !inside;
    }
    return inside;
  };
  const segmentsProperlyIntersect = (
    a1: [number, number],
    a2: [number, number],
    b1: [number, number],
    b2: [number, number],
  ): boolean => {
    if (
      pointsEqual(a1, b1) ||
      pointsEqual(a1, b2) ||
      pointsEqual(a2, b1) ||
      pointsEqual(a2, b2)
    ) {
      return false;
    }
    const d1 = cross(a1, a2, b1);
    const d2 = cross(a1, a2, b2);
    const d3 = cross(b1, b2, a1);
    const d4 = cross(b1, b2, a2);
    return d1 * d2 < -EPS && d3 * d4 < -EPS;
  };
  const polygonsHaveAreaOverlap = (
    a: [number, number][],
    b: [number, number][],
  ): boolean => {
    const aOpen = a.slice(0, -1);
    const bOpen = b.slice(0, -1);
    for (const p of aOpen) {
      if (isPointStrictlyInsidePolygon(p, bOpen)) return true;
    }
    for (const p of bOpen) {
      if (isPointStrictlyInsidePolygon(p, aOpen)) return true;
    }
    for (let i = 0; i < aOpen.length; i += 1) {
      const a1 = aOpen[i];
      const a2 = aOpen[(i + 1) % aOpen.length];
      for (let j = 0; j < bOpen.length; j += 1) {
        const b1 = bOpen[j];
        const b2 = bOpen[(j + 1) % bOpen.length];
        if (segmentsProperlyIntersect(a1, a2, b1, b2)) return true;
      }
    }
    return false;
  };
  const toClosedLngLatRing = (cell: string): [number, number][] | null => {
    try {
      const ring = h3ToPolygon(cell).map(
        ([lng, lat]) => [lng, lat] as [number, number],
      );
      if (ring.length < 3) return null;
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
      return ring;
    } catch {
      return null;
    }
  };

  const nextRing = toClosedLngLatRing(nextCell);
  const nextResolution = getResolution(nextCell);
  for (const existing of existingCells) {
    if (!isValidCell(existing) || existing === nextCell) continue;
    const existingResolution = getResolution(existing);
    if (existingResolution === nextResolution) continue;

    if (existingResolution < nextResolution) {
      if (cellToParent(nextCell, existingResolution) === existing) return true;
    } else if (cellToParent(existing, nextResolution) === nextCell) {
      return true;
    }

    // Defensive geometry check: reject any non-zero area overlap across
    // resolutions, even when hierarchy IDs are inconsistent.
    if (!nextRing) continue;
    const existingRing = toClosedLngLatRing(existing);
    if (!existingRing) continue;
    if (polygonsHaveAreaOverlap(nextRing, existingRing)) return true;
  }
  return false;
}

function normalizeMapCenterForDashboard(
  center: { latitude?: unknown; longitude?: unknown } | null | undefined,
): [number, number] | null {
  if (!center || typeof center !== "object") return null;
  const lat = Number(center.latitude);
  const lng = Number(center.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return [lat, lng];
  // Defensive swap for accidentally reversed backend values.
  if (Math.abs(lng) <= 90 && Math.abs(lat) <= 180) return [lng, lat];
  return null;
}

export default function Dashboard() {
  const { user } = useAuth();
  const userZoneId = user?.zone_id ?? user?.zoneId ?? null;
  const userLabel = useMemo(() => {
    if (!user) return "—";
    const n = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim();
    return n || user.email;
  }, [user]);

  const zoneId = useMemo(() => String(userZoneId ?? ""), [userZoneId]);
  const [zoneName, setZoneName] = useState("");
  const [description] = useState("Zone from dashboard console.");
  const [zoneType, setZoneType] = useState<ZoneTypeMode>("geofence");
  const [proximityRadiusMeters, setProximityRadiusMeters] = useState(500);
  const [proximitySourceMode, setProximitySourceMode] =
    useState<ProximitySourceMode>("map_pin");
  const [proximityCenter, setProximityCenter] = useState<[number, number] | null>(
    null,
  );
  const [proximityLocating, setProximityLocating] = useState(false);
  const [dynamicMinRadiusMeters, setDynamicMinRadiusMeters] = useState(200);
  const [dynamicMaxRadiusMeters, setDynamicMaxRadiusMeters] = useState(1000);
  const [communalCode, setCommunalCode] = useState("");
  const [communalValidation, setCommunalValidation] =
    useState<ReferenceValidationState | null>(null);
  const [communalValidating, setCommunalValidating] = useState(false);
  const [governmentAddressMode, setGovernmentAddressMode] =
    useState<GovernmentAddressMode>("postal");
  const [governmentPostalCode, setGovernmentPostalCode] = useState("");
  const [governmentCity, setGovernmentCity] = useState("");
  const [governmentCountry, setGovernmentCountry] = useState("");
  const [governmentStreet, setGovernmentStreet] = useState("");
  const [governmentStreetNumber, setGovernmentStreetNumber] = useState("");
  const [governmentValidation, setGovernmentValidation] =
    useState<ReferenceValidationState | null>(null);
  const [governmentValidating, setGovernmentValidating] = useState(false);
  const governmentFields = useMemo(
    (): GovernmentAddressFields => ({
      addressMode: governmentAddressMode,
      postalCode: governmentPostalCode,
      city: governmentCity,
      country: governmentCountry,
      street: governmentStreet,
      streetNumber: governmentStreetNumber,
    }),
    [
      governmentAddressMode,
      governmentPostalCode,
      governmentCity,
      governmentCountry,
      governmentStreet,
      governmentStreetNumber,
    ],
  );
  const [objectReferenceId, setObjectReferenceId] = useState("");
  const [objectPlaceName, setObjectPlaceName] = useState("");
  const [objectRadiusMeters, setObjectRadiusMeters] = useState(250);
  const [objectCenter, setObjectCenter] = useState<[number, number] | null>(null);
  const [objectSearchQuery, setObjectSearchQuery] = useState("");
  const [dynamicCircles, setDynamicCircles] = useState<DraftCircle[]>([]);

  const [mapperMode, setMapperMode] = useState<MapperMode>("h3");
  const [resolution, setResolution] = useState(6);
  const [h3Color, setH3Color] = useState(accent);
  const [h3OpacityPct, setH3OpacityPct] = useState(38);
  const [polygonColor, setPolygonColor] = useState(accent);
  const [polygonOpacityPct, setPolygonOpacityPct] = useState(22);

  const [selectedCells, setSelectedCells] = useState<string[]>([]);
  const [polygons, setPolygons] = useState<GeoPolygonShape[]>([]);
  const [draftRing, setDraftRing] = useState<LatLng[]>([]);
  const [drawingActive, setDrawingActive] = useState(false);
  const [geofenceDrawTool, setGeofenceDrawTool] =
    useState<GeofenceDrawTool>("polygon");
  const [selectedPolygonId, setSelectedPolygonId] = useState<string | null>(
    null,
  );
  const [circleDraft, setCircleDraft] = useState<{
    center: LatLng;
    radiusMeters: number;
  } | null>(null);
  const [holeParentId, setHoleParentId] = useState<string | null>(null);

  const [grayscaleMap, setGrayscaleMap] = useState(false);
  const [activeTool, setActiveTool] = useState<ActiveTool>(null);
  const [measureA, setMeasureA] = useState<LatLng | null>(null);
  const [measureB, setMeasureB] = useState<LatLng | null>(null);
  const [measurePreview, setMeasurePreview] = useState<LatLng | null>(null);
  const [measureColor, setMeasureColor] = useState(accent);
  const [measureLabelKm, setMeasureLabelKm] = useState<number | null>(null);

  const [mapCenter, setMapCenter] = useState<[number, number]>(
    AUTH_MAP_DEFAULT_CENTER,
  );
  const mapFitSeq = useRef(0);
  const [mapFitBounds, setMapFitBounds] = useState<MapFitBoundsRequest | null>(
    null,
  );
  const [cursor, setCursor] = useState<{ lat: number; lng: number } | null>(
    null,
  );

  const [locationQuery, setLocationQuery] = useState("");

  const [pasteText, setPasteText] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [activeSavedZoneKey, setActiveSavedZoneKey] = useState<string | null>(
    null,
  );
  const [isCreatingNewZone, setIsCreatingNewZone] = useState(false);
  const [showAllZones, setShowAllZones] = useState(true);
  const [activeSavedZoneEditable, setActiveSavedZoneEditable] =
    useState<boolean>(false);
  const [removedCellIds, setRemovedCellIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [removedPolygonKeys, setRemovedPolygonKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const {
    zones,
    capabilities,
    loading: loadingZones,
    error: zonesError,
    saveZone,
    updateSavedZone,
  } = useZones(userZoneId, {
    role: user?.role,
    currentUserId: user?.id != null ? String(user.id) : null,
    accountOwnerId:
      user?.account_owner_id != null ? String(user.account_owner_id) : null,
  });
  const currentUserId = useMemo(() => {
    const raw = user?.id;
    if (raw == null) return "";
    return String(raw);
  }, [user?.id]);
  const zoneEntries = useMemo<ZoneEntry[]>(
    () =>
      [...zones]
        .sort((a, b) =>
          savedZoneRecordId(a).localeCompare(savedZoneRecordId(b), undefined, {
            numeric: true,
            sensitivity: "base",
          }),
        )
        .map((zone, idx) => {
        const ownerId =
          zone.owner_id != null ? String(zone.owner_id) : null;
        const creatorId =
          zone.creator_id != null ? String(zone.creator_id) : null;
        const editable =
          typeof zone.can_edit === "boolean"
            ? zone.can_edit
            : (creatorId != null && creatorId === currentUserId) ||
              (creatorId == null && ownerId != null && ownerId === currentUserId);
        return {
          zone,
          key: `${savedZoneRecordId(zone)}:${ownerId ?? "none"}:${idx}`,
          ownerId,
          creatorId,
          editable,
        };
      }),
    [zones, currentUserId],
  );
  const activeZoneEntry = useMemo(
    () => zoneEntries.find((entry) => entry.key === activeSavedZoneKey) ?? null,
    [zoneEntries, activeSavedZoneKey],
  );
  const canCreateZone = capabilities?.can_create_zone ?? true;
  const createBlockedReason =
    capabilities?.reason ??
    (canCreateZone ? "" : "You have reached your allowed zone limit.");
  const canEditCurrentSelection =
    isCreatingNewZone || (!!activeZoneEntry && activeSavedZoneEditable);
  /** Validate / preview reference IDs (Type 2–3); does not require save permission. */
  const canValidateReferenceZone = useMemo(() => {
    if (isCreatingNewZone) return true;
    if (activeZoneEntry != null) return true;
    return canCreateZone;
  }, [isCreatingNewZone, activeZoneEntry, canCreateZone]);
  const communalValidated = useMemo(() => {
    if (communalValidation?.valid !== true) return false;
    return communalCode.trim().toUpperCase() === communalValidation.referenceId;
  }, [communalValidation, communalCode]);
  const governmentValidated = useMemo(() => {
    if (governmentValidation?.valid !== true) return false;
    return governmentAddressMatchesValidation(
      governmentFields,
      governmentValidation.referenceId,
    );
  }, [governmentValidation, governmentFields]);
  const activeReferenceValidation = useMemo((): ValidReferenceValidation | null => {
    if (zoneType === "communal_id" && communalValidation?.valid === true) {
      return communalValidation;
    }
    if (
      zoneType === "government_local_code" &&
      governmentValidation?.valid === true
    ) {
      return governmentValidation;
    }
    return null;
  }, [zoneType, communalValidation, governmentValidation]);
  const usesMapGeometry = zoneType === "geofence" || zoneType === "grid";
  const typeVisual = useMemo(() => {
    if (zoneType === "grid") return { color: "#F59E0B", label: "Grid" };
    if (zoneType === "proximity")
      return { color: "#06B6D4", label: "Proximity" };
    if (zoneType === "dynamic") return { color: "#22C55E", label: "Dynamic" };
    if (zoneType === "communal_id") {
      const validated =
        communalValidation?.valid === true &&
        communalCode.trim().toUpperCase() === communalValidation.referenceId;
      return validated
        ? { color: "#8B5CF6", label: "Communal ID" }
        : { color: "#64748B", label: "Communal ID (validate first)" };
    }
    if (zoneType === "government_local_code") {
      const validated =
        governmentValidation?.valid === true &&
        governmentAddressMatchesValidation(
          governmentFields,
          governmentValidation.referenceId,
        );
      return validated
        ? { color: "#0EA5E9", label: "Gov Local Code" }
        : { color: "#64748B", label: "Gov Local Code (validate first)" };
    }
    if (zoneType === "object") return { color: "#A855F7", label: "Object" };
    return { color: accent, label: "Geofence" };
  }, [
    zoneType,
    communalValidation,
    communalCode,
    governmentValidation,
    governmentFields,
  ]);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    lat: number;
    lng: number;
  } | null>(null);
  const [contextPanel, setContextPanel] = useState<
    "h3info" | "customer" | null
  >(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const normalized = normalizeMapCenterForDashboard(
      user?.mapCenter ?? user?.map_center,
    );
    if (!normalized) return;
    setMapCenter(normalized);
  }, [user?.mapCenter, user?.map_center]);

  useEffect(() => {
    const address = user?.address?.trim();
    if (!address || address.length < 2) return;
    const ac = new AbortController();
    searchPhotonAddresses(address, ac.signal)
      .then((features) => {
        const first = features[0];
        if (!first) return;
        const [lng, lat] = first.geometry.coordinates;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        setMapCenter([lat, lng]);
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        // Keep prior map center when address lookup fails.
      });
    return () => ac.abort();
  }, [user?.id, user?.address]);

  const captureProximityLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setSaveStatus("Location is not available in this browser.");
      return;
    }
    setProximityLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setProximityCenter([lat, lng]);
        setMapCenter([lat, lng]);
        setProximityLocating(false);
        setSaveStatus("Current location set as zone source.");
      },
      () => {
        setProximityLocating(false);
        setSaveStatus("Could not read your location. Try Pin on map instead.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, []);

  useEffect(() => {
    if (isCreatingNewZone) return;
    if (zoneEntries.length === 0) return;
    if (activeSavedZoneKey != null) {
      const stillActive = zoneEntries.some(
        (entry) => entry.key === activeSavedZoneKey,
      );
      if (stillActive) return;
    }
    const chosen =
      zoneEntries.find(
        (entry) =>
          Array.isArray(entry.zone.h3_cells) && entry.zone.h3_cells.length > 0,
      ) ||
      zoneEntries.find((entry) => zoneToPolygons(entry.zone).length > 0) ||
      zoneEntries.find(
        (entry) =>
          normalizeZoneTypeValue(entry.zone.type ?? entry.zone.zone_type) ===
          "proximity",
      ) ||
      zoneEntries[0] ||
      null;
    if (!chosen) return;
    const normalizedType = normalizeZoneTypeValue(
      chosen.zone.type ?? chosen.zone.zone_type,
    );
    setZoneType(normalizedType);
    setZoneName((chosen.zone.name ?? "").trim());
    setActiveSavedZoneKey(chosen.key);
    setActiveSavedZoneEditable(
      chosen.editable && (capabilities?.can_edit_active_zone ?? true),
    );
    setSelectedCells(
      Array.isArray(chosen.zone.h3_cells) ? [...chosen.zone.h3_cells] : [],
    );
    setRemovedCellIds(new Set());
    setRemovedPolygonKeys(new Set());
    setPolygons(zoneToPolygons(chosen.zone));
    if (normalizedType === "proximity") {
      const proximity = loadProximityFromZone(chosen.zone, 500);
      setProximitySourceMode(proximity.sourceMode);
      setProximityCenter(proximity.center);
      setProximityRadiusMeters(proximity.radiusMeters);
    } else {
      setProximitySourceMode("map_pin");
      setProximityCenter(null);
    }
    setDynamicCircles(
      normalizedType === "dynamic"
        ? parseCircleDraftsFromZone(chosen.zone, "dynamic", {
            proximityRadiusMeters: 500,
            dynamicMinRadiusMeters: 200,
            dynamicMaxRadiusMeters: 1000,
          })
        : [],
    );
    const chosenConfig = zoneConfigMap(chosen.zone);
    setCommunalCode(
      typeof chosenConfig.communal_id === "string" ? chosenConfig.communal_id : "",
    );
    setCommunalValidation(
      normalizedType === "communal_id"
        ? communalValidationFromZone(chosen.zone)
        : null,
    );
    {
      const govFields = applyGovernmentFieldsFromConfig(chosenConfig);
      setGovernmentAddressMode(govFields.addressMode);
      setGovernmentPostalCode(govFields.postalCode);
      setGovernmentCity(govFields.city);
      setGovernmentCountry(govFields.country);
      setGovernmentStreet(govFields.street);
      setGovernmentStreetNumber(govFields.streetNumber);
    }
    setGovernmentValidation(
      normalizedType === "government_local_code"
        ? governmentValidationFromZone(chosen.zone)
        : null,
    );
    setObjectReferenceId(
      typeof chosenConfig.object_id === "string" ? chosenConfig.object_id : "",
    );
    setObjectPlaceName(
      typeof chosenConfig.object_name === "string"
        ? chosenConfig.object_name
        : typeof chosenConfig.object_id === "string"
          ? chosenConfig.object_id
          : "",
    );
    setObjectRadiusMeters(
      typeof chosenConfig.radius_meters === "number" && chosenConfig.radius_meters > 0
        ? chosenConfig.radius_meters
        : 250,
    );
    const center = extractZoneCenter(chosen.zone);
    setObjectCenter(center);
    setObjectSearchQuery(
      typeof chosenConfig.object_name === "string" && chosenConfig.object_name.trim()
        ? chosenConfig.object_name
        : typeof chosenConfig.object_id === "string"
          ? chosenConfig.object_id
          : "",
    );
  }, [zoneEntries, activeSavedZoneKey, isCreatingNewZone, capabilities?.can_edit_active_zone]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("[data-context-menu-root]")) return;
      setContextMenu(null);
      setContextPanel(null);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (activeTool === "measure") {
        setActiveTool(null);
        setMeasureA(null);
        setMeasureB(null);
        setMeasurePreview(null);
        setMeasureLabelKm(null);
      }
      if (drawingActive) {
        if (circleDraft) {
          setCircleDraft(null);
          setDrawingActive(false);
        } else {
          setDraftRing((d) => {
            if (d.length <= 1) {
              setDrawingActive(false);
              setHoleParentId(null);
              return [];
            }
            return d.slice(0, -1);
          });
        }
      } else if (selectedPolygonId) {
        setSelectedPolygonId(null);
      }
      setContextMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTool, circleDraft, drawingActive, selectedPolygonId]);

  const toggleCell = useCallback((cell: string) => {
    setSelectedCells((current) =>
      current.includes(cell)
        ? current.filter((c) => c !== cell)
        : [...current, cell],
    );
  }, []);

  const h3FillOpacity = h3OpacityPct / 100;
  const polygonFillOpacity = polygonOpacityPct / 100;
  const effectiveH3Color =
    zoneType === "geofence" ? accent : usesMapGeometry ? typeVisual.color : h3Color;
  const effectivePolygonColor =
    zoneType === "geofence"
      ? accent
      : usesMapGeometry
        ? typeVisual.color
        : polygonColor;
  const editableWorkingCells = useMemo(
    () =>
      activeSavedZoneEditable
        ? selectedCells.filter((c) => !removedCellIds.has(c))
        : [],
    [activeSavedZoneEditable, selectedCells, removedCellIds],
  );
  const editableWorkingPolygons = useMemo(
    () =>
      activeSavedZoneEditable
        ? polygons.filter((p) => !removedPolygonKeys.has(polygonKey(p)))
        : [],
    [activeSavedZoneEditable, polygons, removedPolygonKeys],
  );
  const allWorkingCells = useMemo(() => {
    const set = new Set<string>();
    for (const zone of zones) {
      if (!Array.isArray(zone.h3_cells)) continue;
      for (const c of zone.h3_cells) {
        if (typeof c !== "string") continue;
        if (removedCellIds.has(c)) continue;
        set.add(c);
      }
    }
    for (const c of selectedCells) {
      if (!removedCellIds.has(c)) set.add(c);
    }
    return Array.from(set);
  }, [zones, selectedCells, removedCellIds]);

  const allWorkingPolygons = useMemo<GeoPolygonShape[]>(() => {
    const byKey = new Map<string, GeoPolygonShape>();
    for (const zone of zones) {
      const parsed = zoneToPolygons(zone);
      for (const p of parsed) {
        const key = polygonKey(p);
        if (removedPolygonKeys.has(key)) continue;
        if (!byKey.has(key)) byKey.set(key, p);
      }
    }
    for (const p of polygons) {
      const key = polygonKey(p);
      if (removedPolygonKeys.has(key)) continue;
      byKey.set(key, p);
    }
    return Array.from(byKey.values());
  }, [zones, polygons, removedPolygonKeys]);

  const mapInteraction = useMemo(() => {
    if (activeTool === "measure") return "measure" as const;
    if (
      zoneType === "proximity" ||
      zoneType === "object" ||
      zoneType === "dynamic"
    ) {
      return "place" as const;
    }
    if (mapperMode === "h3") return "h3" as const;
    if (mapperMode === "polygon") return "polygon" as const;
    return "none" as const;
  }, [activeTool, mapperMode, zoneType]);

  const passMapClicks = useMemo(() => {
    if (!canEditCurrentSelection) return false;
    if (zoneType === "proximity" && proximitySourceMode === "map_pin") {
      return true;
    }
    if (zoneType === "object") return true;
    return false;
  }, [canEditCurrentSelection, zoneType, proximitySourceMode]);

  const handleMapClick = useCallback(
    (lat: number, lng: number) => {
      if (activeTool === "measure") {
        const p: LatLng = [lat, lng];
        if (!measureA) {
          setMeasureA(p);
          setMeasureB(null);
          setMeasureLabelKm(null);
          return;
        }
        if (!measureB) {
          setMeasureB(p);
          const km = distanceMeters(measureA, p) / 1000;
          setMeasureLabelKm(km);
          return;
        }
        setMeasureA(p);
        setMeasureB(null);
        setMeasureLabelKm(null);
        return;
      }

      if (!canEditCurrentSelection) {
        setSaveStatus(
          zones.length === 0
            ? "No zone selected. Click Create new zone to start drawing."
            : "Selected zone is read-only. Choose one of your own zones or create a new zone.",
        );
        return;
      }
      if (!usesMapGeometry) {
        if (zoneType === "proximity" || zoneType === "dynamic") {
          const point: [number, number] = [lat, lng];
          if (zoneType === "proximity") {
            if (proximitySourceMode !== "map_pin") {
              setProximitySourceMode("map_pin");
            }
            setProximityCenter(point);
            setSaveStatus("Source pinned. Adjust radius to resize the zone.");
            return;
          }
          setDynamicCircles((prev) => {
            const hit = prev.find(
              (circle) =>
                distanceMeters(circle.center, point) <=
                Math.max(
                  circle.maxRadiusMeters ?? 0,
                  circle.minRadiusMeters ?? 0,
                  circle.radiusMeters,
                ),
            );
            if (hit) {
              setSaveStatus("Dynamic circle removed.");
              return prev.filter((c) => c.id !== hit.id);
            }
            setSaveStatus(
              "Dynamic circle added. Click inside a circle to remove it.",
            );
            return [
              ...prev,
              {
                id: `dynamic-${Date.now()}-${Math.random()}`,
                center: point,
                radiusMeters: Math.max(dynamicMaxRadiusMeters, dynamicMinRadiusMeters),
                minRadiusMeters: dynamicMinRadiusMeters,
                maxRadiusMeters: Math.max(dynamicMaxRadiusMeters, dynamicMinRadiusMeters),
              },
            ];
          });
          return;
        }
        if (zoneType === "object") {
          setObjectCenter([lat, lng]);
          setSaveStatus(
            "Object anchor updated on map. Adjust radius if needed, then save.",
          );
          return;
        }
        setSaveStatus(
          "This zone type uses config fields, not H3 cell drawing. Update fields and save.",
        );
        return;
      }

      if (mapperMode === "h3") {
        const pt = turf.point([lng, lat]);
        let matchedEditable: string | null = null;
        for (const id of editableWorkingCells) {
          try {
            const ring = h3ToPolygon(id);
            const coords = ring.map(([x, y]) => [x, y] as [number, number]);
            if (
              coords[0][0] !== coords[coords.length - 1][0] ||
              coords[0][1] !== coords[coords.length - 1][1]
            ) {
              coords.push(coords[0]);
            }
            if (turf.booleanPointInPolygon(pt, turf.polygon([coords]))) {
              matchedEditable = id;
              break;
            }
          } catch {
            /* skip invalid ids */
          }
        }
        if (matchedEditable) {
          setRemovedCellIds((prev) => {
            const next = new Set(prev);
            next.add(matchedEditable);
            return next;
          });
          setSelectedCells((current) =>
            current.filter((c) => c !== matchedEditable),
          );
          return;
        }
        for (const id of allWorkingCells) {
          if (editableWorkingCells.includes(id)) continue;
          try {
            const ring = h3ToPolygon(id);
            const coords = ring.map(([x, y]) => [x, y] as [number, number]);
            if (
              coords[0][0] !== coords[coords.length - 1][0] ||
              coords[0][1] !== coords[coords.length - 1][1]
            ) {
              coords.push(coords[0]);
            }
            if (turf.booleanPointInPolygon(pt, turf.polygon([coords]))) {
              setSaveStatus("This cell is shared reference data and is read-only.");
              return;
            }
          } catch {
            /* skip invalid ids */
          }
        }
        const cell = getCellFromCoords(lat, lng, resolution);
        if (wouldOverlapAcrossResolutions(cell, allWorkingCells)) {
          setSaveStatus(
            "Overlapping H3 cells across resolutions are not allowed. Pick a non-overlapping area.",
          );
          return;
        }
        setRemovedCellIds((prev) => {
          if (!prev.has(cell)) return prev;
          const next = new Set(prev);
          next.delete(cell);
          return next;
        });
        toggleCell(cell);
        return;
      }

      if (
        mapperMode === "polygon" &&
        drawingActive &&
        geofenceDrawTool === "circle"
      ) {
        if (!circleDraft) {
          setCircleDraft({ center: [lat, lng], radiusMeters: 0 });
          setSaveStatus("Move the mouse to set radius, then click again to finish.");
          return;
        }
        const radiusMeters = Math.max(
          distanceMeters(circleDraft.center, [lat, lng]),
          5,
        );
        const outer = circleToPolygonRing(circleDraft.center, radiusMeters);
        if (outer.length >= 3) {
          setPolygons((ps) => [
            ...ps,
            { id: newPolygonId(), outer, holes: [] },
          ]);
          setSaveStatus("Circle added. Tap polygon to edit vertices.");
        }
        setCircleDraft(null);
        setDrawingActive(false);
        return;
      }

      if (mapperMode === "polygon" && drawingActive && geofenceDrawTool === "polygon") {
        const pt: LatLng = [lat, lng];
        if (draftRing.length >= 3 && ringsNearlyClosed(draftRing, pt)) {
          const outer = [...draftRing];
          setDraftRing([]);
          if (holeParentId) {
            setPolygons((ps) =>
              ps.map((p) =>
                p.id === holeParentId
                  ? { ...p, holes: [...p.holes, outer] }
                  : p,
              ),
            );
            setHoleParentId(null);
          } else {
            setPolygons((ps) => [
              ...ps,
              { id: newPolygonId(), outer, holes: [] },
            ]);
          }
          return;
        }
        if (draftRing.length === 0) {
          const parent = findPolygonContainingPoint(lat, lng, polygons);
          setHoleParentId(parent?.id ?? null);
        }
        setDraftRing((d) => [...d, pt]);
        return;
      }

      if (mapperMode === "polygon" && !drawingActive) {
        if (selectedPolygonId) {
          const selected = polygons.find((p) => p.id === selectedPolygonId);
          if (selected && pointInPolygon(lat, lng, selected.outer)) {
            return;
          }
          setSelectedPolygonId(null);
          setSaveStatus("");
        }

        let matched: GeoPolygonShape | null = null;
        for (const p of editableWorkingPolygons) {
          if (pointInPolygon(lat, lng, p.outer)) {
            let inHole = false;
            for (const h of p.holes) {
              if (pointInPolygon(lat, lng, h)) {
                inHole = true;
                break;
              }
            }
            if (!inHole) {
              matched = p;
              break;
            }
          }
        }
        if (matched) {
          setSelectedPolygonId(matched.id);
          setSaveStatus(
            "Selected — click an edge to add a point, drag points to move, long-press a point to remove it, long-press the polygon to delete it.",
          );
          return;
        }
        setSelectedPolygonId(null);
        for (const p of allWorkingPolygons) {
          if (editableWorkingPolygons.some((editablePoly) => editablePoly.id === p.id)) {
            continue;
          }
          if (pointInPolygon(lat, lng, p.outer)) {
            let inHole = false;
            for (const h of p.holes) {
              if (pointInPolygon(lat, lng, h)) {
                inHole = true;
                break;
              }
            }
            if (!inHole) {
              setSaveStatus(
                "This polygon is shared reference data and is read-only.",
              );
              return;
            }
          }
        }
      }
    },
    [
      activeTool,
      canEditCurrentSelection,
      mapperMode,
      resolution,
      toggleCell,
      editableWorkingCells,
      allWorkingCells,
      allWorkingPolygons,
      editableWorkingPolygons,
      drawingActive,
      geofenceDrawTool,
      circleDraft,
      draftRing,
      holeParentId,
      polygons,
      selectedPolygonId,
      proximityRadiusMeters,
      proximitySourceMode,
      dynamicMinRadiusMeters,
      dynamicMaxRadiusMeters,
      usesMapGeometry,
      zoneType,
      zones.length,
      measureA,
      measureB,
    ],
  );

  const handleMapMouseMove = useCallback(
    (lat: number, lng: number) => {
      if (activeTool === "measure" && measureA && !measureB) {
        setMeasurePreview([lat, lng]);
        return;
      }
      setMeasurePreview(null);
      if (
        mapperMode === "polygon" &&
        drawingActive &&
        geofenceDrawTool === "circle" &&
        circleDraft
      ) {
        const radiusMeters = Math.max(
          distanceMeters(circleDraft.center, [lat, lng]),
          5,
        );
        setCircleDraft({ center: circleDraft.center, radiusMeters });
      }
    },
    [activeTool, measureA, measureB, mapperMode, drawingActive, geofenceDrawTool, circleDraft],
  );

  const handleVertexMove = useCallback(
    (polygonId: string, vertexIndex: number, lat: number, lng: number) => {
      setPolygons((ps) =>
        movePolygonOuterVertex(ps, polygonId, vertexIndex, lat, lng),
      );
    },
    [],
  );

  const handleVertexDelete = useCallback(
    (polygonId: string, vertexIndex: number) => {
      setPolygons((ps) => {
        const target = ps.find((p) => p.id === polygonId);
        if (target && target.outer.length <= 3) {
          setSaveStatus("A polygon needs at least 3 vertices.");
          return ps;
        }
        setSaveStatus("Vertex removed.");
        return deletePolygonOuterVertex(ps, polygonId, vertexIndex);
      });
    },
    [],
  );

  const deleteSelectedPolygon = useCallback(() => {
    if (!selectedPolygonId) return;
    const key = polygonKey(
      polygons.find((p) => p.id === selectedPolygonId) ?? {
        id: selectedPolygonId,
        outer: [],
        holes: [],
      },
    );
    setRemovedPolygonKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    setPolygons((ps) => ps.filter((p) => p.id !== selectedPolygonId));
    setSelectedPolygonId(null);
    setSaveStatus("Polygon removed.");
  }, [polygons, selectedPolygonId]);

  const handleEdgeVertexAdd = useCallback(
    (polygonId: string, segmentIndex: number, lat: number, lng: number) => {
      setPolygons((ps) =>
        insertPolygonOuterVertex(ps, polygonId, segmentIndex, lat, lng),
      );
      setSaveStatus("Vertex added on edge.");
    },
    [],
  );

  const handlePolygonLongPressDelete = useCallback(
    (polygonId: string) => {
      if (polygonId !== selectedPolygonId) return;
      deleteSelectedPolygon();
    },
    [deleteSelectedPolygon, selectedPolygonId],
  );

  const clearH3 = () => setSelectedCells([]);
  const clearPolygons = () => {
    setPolygons([]);
    setRemovedPolygonKeys(new Set());
    setDraftRing([]);
    setDrawingActive(false);
    setHoleParentId(null);
    setCircleDraft(null);
    setSelectedPolygonId(null);
  };

  const handleExportWorkspaceJson = () => {
    const doc: HexMapperExport = {
      version: 1,
      resolution,
      h3_cells: selectedCells,
      polygons,
      h3Color,
      h3OpacityPct,
      polygonColor,
      polygonOpacityPct,
    };
    const blob = new Blob([JSON.stringify(doc, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "h3-hex-mapper-workspace.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLoadWorkspaceJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result)) as HexMapperExport;
        if (data.h3_cells) setSelectedCells(data.h3_cells);
        if (data.polygons) {
          setRemovedPolygonKeys(new Set());
          setPolygons(data.polygons);
        }
        if (typeof data.resolution === "number")
          setResolution(Math.min(15, Math.max(0, data.resolution)));
        if (data.h3Color) setH3Color(data.h3Color);
        if (typeof data.h3OpacityPct === "number")
          setH3OpacityPct(data.h3OpacityPct);
        if (data.polygonColor) setPolygonColor(data.polygonColor);
        if (typeof data.polygonOpacityPct === "number")
          setPolygonOpacityPct(data.polygonOpacityPct);
        setSaveStatus("Workspace loaded.");
      } catch {
        setSaveStatus("Invalid JSON file.");
      }
    };
    reader.readAsText(file);
  };

  const handleImportWktKml = () => {
    const t = pasteText.trim();
    if (!t) return;
    const upper = t.toUpperCase();
    let next: GeoPolygonShape[] = [];
    if (upper.includes("POLYGON") || upper.includes("MULTIPOLYGON")) {
      next = parseWktToPolygons(t);
    } else if (upper.includes("<KML") || upper.includes("COORDINATES")) {
      next = parseKmlToPolygons(t);
    }
    if (next.length) {
      setRemovedPolygonKeys(new Set());
      setPolygons((p) => [...p, ...next]);
      setSaveStatus(`Imported ${next.length} polygon(s).`);
    } else {
      setSaveStatus("Could not parse WKT/KML.");
    }
  };

  const handleExportWkt = () => {
    const wkt = exportPolygonsAsWKT(allWorkingPolygons);
    if (!wkt) {
      setSaveStatus("No polygons to export.");
      return;
    }
    const blob = new Blob([wkt], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "polygons.wkt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportKml = () => {
    const kml = exportPolygonsAsKML(allWorkingPolygons);
    const blob = new Blob([kml], {
      type: "application/vnd.google-earth.kml+xml",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "polygons.kml";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCsv = () => {
    const csv = serializeCellCsv(selectedCells);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "zone-cells.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSave = async () => {
    if (!zoneId) {
      setSaveStatus("Your account has no zone ID.");
      return;
    }
    if (!isCreatingNewZone && !activeSavedZoneEditable) {
      setSaveStatus("Selected zone is read-only. Choose one of your own zones to edit.");
      return;
    }
    if (isCreatingNewZone && !canCreateZone) {
      setSaveStatus(createBlockedReason || "You cannot create more zones.");
      return;
    }
    const normalizedZoneName = zoneName.trim();
    if (!normalizedZoneName) {
      setSaveStatus("Zone name is required.");
      return;
    }
    if (normalizedZoneName.length > MAX_ZONE_NAME_LENGTH) {
      setSaveStatus(`Zone name must be ${MAX_ZONE_NAME_LENGTH} characters or less.`);
      return;
    }
    const cellsToSave = selectedCells.filter((c) => !removedCellIds.has(c));
    const polygonsToSave = polygons.filter(
      (p) => !removedPolygonKeys.has(polygonKey(p)),
    );
    const geoFenceForSave = polygonsToGeoFenceMultiPolygon(polygonsToSave);

    const canSaveGeometry =
      cellsToSave.length > 0 || polygonsToSave.length > 0;
    const canSaveByType =
      usesMapGeometry
        ? canSaveGeometry
        : zoneType === "proximity"
          ? proximityRadiusMeters > 0 && proximityCenter != null
          : zoneType === "dynamic"
            ? dynamicMinRadiusMeters > 0 &&
              dynamicMaxRadiusMeters >= dynamicMinRadiusMeters &&
              dynamicCircles.length > 0
            : zoneType === "communal_id"
              ? communalValidated &&
                (polygonsToSave.length > 0 || cellsToSave.length > 0)
              : zoneType === "government_local_code"
                ? governmentValidated &&
                  (polygonsToSave.length > 0 || cellsToSave.length > 0)
                : zoneType === "object"
                  ? objectReferenceId.trim().length > 0 &&
                    objectRadiusMeters > 0 &&
                    objectCenter != null
                : true;
    if (!canSaveByType) {
      setSaveStatus(
        usesMapGeometry
          ? "Select H3 cells or add polygons before saving."
          : zoneType === "proximity"
            ? "Set a proximity radius before saving."
            : zoneType === "dynamic"
              ? "Set valid dynamic min/max radius values before saving."
              : zoneType === "communal_id"
                ? "Validate the communal ID and confirm the map preview before saving."
                : zoneType === "government_local_code"
                  ? "Validate the address and confirm the map preview before saving."
                  : "Set object ID, radius, and anchor point before saving.",
      );
      return;
    }
    if (usesMapGeometry && hasCrossResolutionOverlap(cellsToSave)) {
      setSaveStatus(
        "Overlapping H3 cells across resolutions are not allowed. Remove parent/child duplicates before saving.",
      );
      return;
    }
    setSaveStatus("Saving…");
    try {
      const compatibilityZoneType = zoneType;
      const proximityCenterPayload = proximityCenter
        ? {
            latitude: proximityCenter[0],
            longitude: proximityCenter[1],
          }
        : {
            latitude: mapCenter[0],
            longitude: mapCenter[1],
          };
      const proximityCircleDef = {
        center: proximityCenterPayload,
        radius_meters: proximityRadiusMeters,
      };
      const dynamicCenters = dynamicCircles.map((circle) => ({
        latitude: circle.center[0],
        longitude: circle.center[1],
      }));
      const dynamicCircleDefs = dynamicCircles.map((circle) => ({
        center: {
          latitude: circle.center[0],
          longitude: circle.center[1],
        },
        min_radius_meters: circle.minRadiusMeters ?? dynamicMinRadiusMeters,
        max_radius_meters:
          circle.maxRadiusMeters ??
          Math.max(dynamicMaxRadiusMeters, dynamicMinRadiusMeters),
      }));
      const referenceGeoFence = activeReferenceValidation
        ? normalizeGeoFencePolygonValue(
            activeReferenceValidation.geometry.geo_fence_polygon ??
              activeReferenceValidation.geometry,
          )
        : geoFenceForSave;
      const referenceCellsToSave = activeReferenceValidation
        ? activeReferenceValidation.h3Cells
        : cellsToSave;
      const geometryPayload: Record<string, unknown> =
        activeReferenceValidation
          ? {
              ...activeReferenceValidation.geometry,
              geo_fence_polygon: referenceGeoFence,
            }
          : zoneType === "proximity"
          ? {
              center: proximityCenterPayload,
              centers: [proximityCenterPayload],
              circles: [proximityCircleDef],
            }
          : zoneType === "dynamic"
            ? {
                center: dynamicCenters[0] ?? {
                  latitude: mapCenter[0],
                  longitude: mapCenter[1],
                },
                centers: dynamicCenters,
                circles: dynamicCircleDefs,
              }
            : zoneType === "object"
              ? {
                  center: objectCenter
                    ? {
                        latitude: objectCenter[0],
                        longitude: objectCenter[1],
                      }
                    : {
                        latitude: mapCenter[0],
                        longitude: mapCenter[1],
                      },
                }
          : {
              geo_fence_polygon: geoFenceForSave,
            };
      const configPayload: Record<string, unknown> = {
        h3_cells: activeReferenceValidation ? referenceCellsToSave : cellsToSave,
        ...(zoneType === "proximity"
          ? {
              radius_meters: proximityRadiusMeters,
              radii_meters: [proximityRadiusMeters],
              source_type: proximitySourceMode,
            }
          : {}),
        ...(zoneType === "dynamic"
          ? {
              min_radius_meters: dynamicMinRadiusMeters,
              max_radius_meters: dynamicMaxRadiusMeters,
              circle_ranges: dynamicCircles.map((circle) => ({
                min_radius_meters:
                  circle.minRadiusMeters ?? dynamicMinRadiusMeters,
                max_radius_meters:
                  circle.maxRadiusMeters ??
                  Math.max(dynamicMaxRadiusMeters, dynamicMinRadiusMeters),
              })),
            }
          : {}),
        ...(zoneType === "communal_id"
          ? {
              communal_id: communalCode.trim().toUpperCase(),
              ...(communalValidation?.valid === true
                ? communalValidation.config
                : {}),
            }
          : {}),
        ...(zoneType === "government_local_code"
          ? governmentValidation?.valid === true
            ? governmentValidation.config
            : governmentAddressToConfig(governmentFields)
          : {}),
        ...(zoneType === "object"
          ? {
              object_id: objectReferenceId.trim(),
              object_name: (objectPlaceName.trim() || objectSearchQuery.trim()) || undefined,
              object_source: "place",
              radius_meters: objectRadiusMeters,
            }
          : {}),
      };
      const payload = {
        // zone_id: zoneId,
        name: normalizedZoneName,
        description,
        zone_type: compatibilityZoneType,
        type: zoneType,
        h3_cells: activeReferenceValidation ? referenceCellsToSave : cellsToSave,
        geo_fence_polygon: activeReferenceValidation
          ? referenceGeoFence
          : geoFenceForSave,
        geometry: geometryPayload,
        config: configPayload,
      };
      if (isCreatingNewZone) {
        await saveZone(payload);
        setSaveStatus("New zone created successfully.");
        setIsCreatingNewZone(false);
      } else if (activeZoneEntry) {
        await updateSavedZone(savedZoneRecordId(activeZoneEntry.zone), payload);
        setSaveStatus("Zone updated successfully.");
      } else {
        setSaveStatus("Select a zone to edit, or click Create new zone.");
      }
    } catch (err) {
      console.error(err);
      const message =
        err instanceof Error
          ? err.message
          : "Save failed. Check your session and try again.";
      const lower = message.toLowerCase();
      if (lower.includes("quota") || lower.includes("limit")) {
        setSaveStatus(`Quota limit: ${message}`);
        return;
      }
      if (
        lower.includes("forbidden") ||
        lower.includes("unauthorized") ||
        lower.includes("permission")
      ) {
        setSaveStatus(`Permission error: ${message}`);
        return;
      }
      if (lower.includes("network") || lower.includes("timeout")) {
        setSaveStatus(`Network error: ${message}`);
        return;
      }
      setSaveStatus(message);
    }
  };

  const loadSavedZone = useCallback((entry: ZoneEntry) => {
    const zone = entry.zone;
    const normalizedType = normalizeZoneTypeValue(zone.type ?? zone.zone_type);
    setIsCreatingNewZone(false);
    setZoneType(normalizedType);
    setZoneName((zone.name ?? "").trim());
    setActiveSavedZoneKey(entry.key);
    setActiveSavedZoneEditable(
      entry.editable && (capabilities?.can_edit_active_zone ?? true),
    );
    setSelectedCells(Array.isArray(zone.h3_cells) ? [...zone.h3_cells] : []);
    setRemovedCellIds(new Set());
    setRemovedPolygonKeys(new Set());
    setPolygons(zoneToPolygons(zone));
    if (normalizedType === "proximity") {
      const proximity = loadProximityFromZone(
        zone,
        proximityRadiusMeters || 500,
      );
      setProximitySourceMode(proximity.sourceMode);
      setProximityCenter(proximity.center);
      setProximityRadiusMeters(proximity.radiusMeters);
    } else {
      setProximitySourceMode("map_pin");
      setProximityCenter(null);
    }
    setDynamicCircles(
      normalizedType === "dynamic"
        ? parseCircleDraftsFromZone(zone, "dynamic", {
            proximityRadiusMeters: proximityRadiusMeters || 500,
            dynamicMinRadiusMeters: dynamicMinRadiusMeters || 200,
            dynamicMaxRadiusMeters: dynamicMaxRadiusMeters || 1000,
          })
        : [],
    );
    const config = zoneConfigMap(zone);
    setCommunalCode(
      typeof config.communal_id === "string" ? config.communal_id : "",
    );
    setCommunalValidation(
      normalizedType === "communal_id" ? communalValidationFromZone(zone) : null,
    );
    {
      const govFields = applyGovernmentFieldsFromConfig(config);
      setGovernmentAddressMode(govFields.addressMode);
      setGovernmentPostalCode(govFields.postalCode);
      setGovernmentCity(govFields.city);
      setGovernmentCountry(govFields.country);
      setGovernmentStreet(govFields.street);
      setGovernmentStreetNumber(govFields.streetNumber);
    }
    setGovernmentValidation(
      normalizedType === "government_local_code"
        ? governmentValidationFromZone(zone)
        : null,
    );
    setObjectReferenceId(
      typeof config.object_id === "string" ? config.object_id : "",
    );
    setObjectPlaceName(
      typeof config.object_name === "string"
        ? config.object_name
        : typeof config.object_id === "string"
          ? config.object_id
          : "",
    );
    setObjectRadiusMeters(
      typeof config.radius_meters === "number" && config.radius_meters > 0
        ? config.radius_meters
        : 250,
    );
    setObjectCenter(extractZoneCenter(zone));
    setObjectSearchQuery(
      typeof config.object_name === "string" && config.object_name.trim()
        ? config.object_name
        : typeof config.object_id === "string"
          ? config.object_id
          : "",
    );
    setSaveStatus(
      entry.editable
        ? `Loaded ${zone.name ?? `zone ${savedZoneId(zone)}`}.`
        : `Loaded ${zone.name ?? `zone ${savedZoneId(zone)}`} (read-only).`,
    );
  }, [
    capabilities?.can_edit_active_zone,
    dynamicMaxRadiusMeters,
    dynamicMinRadiusMeters,
    proximityRadiusMeters,
  ]);

  const copyZoneId = async () => {
    if (!zoneId) {
      setSaveStatus("No zone ID available.");
      return;
    }
    try {
      await navigator.clipboard.writeText(zoneId);
      setSaveStatus("Zone ID copied.");
    } catch {
      setSaveStatus("Could not copy.");
    }
  };

  const startNewZoneDraft = useCallback(() => {
    if (!canCreateZone) {
      setSaveStatus(createBlockedReason || "You cannot create more zones.");
      return;
    }
    setIsCreatingNewZone(true);
    setZoneName("");
    setActiveSavedZoneKey(null);
    setActiveSavedZoneEditable(true);
    setSelectedCells([]);
    setRemovedCellIds(new Set());
    setRemovedPolygonKeys(new Set());
    setPolygons([]);
    setProximitySourceMode("map_pin");
    setProximityCenter(null);
    setProximityRadiusMeters(500);
    setDynamicCircles([]);
    setCommunalCode("");
    setCommunalValidation(null);
    setGovernmentAddressMode("postal");
    setGovernmentPostalCode("");
    setGovernmentCity("");
    setGovernmentCountry("");
    setGovernmentStreet("");
    setGovernmentStreetNumber("");
    setGovernmentValidation(null);
    setObjectReferenceId("");
    setObjectPlaceName("");
    setObjectSearchQuery("");
    setObjectRadiusMeters(250);
    setObjectCenter(null);
    setDraftRing([]);
    setDrawingActive(false);
    setHoleParentId(null);
    setSaveStatus("New zone mode: draw cells/polygons, then Save zone.");
  }, [canCreateZone, createBlockedReason]);

  const cancelNewZoneDraft = useCallback(() => {
    if (!isCreatingNewZone) return;
    setIsCreatingNewZone(false);
    setZoneName(activeZoneEntry?.zone.name?.trim() ?? "");
    setSelectedCells([]);
    setRemovedCellIds(new Set());
    setRemovedPolygonKeys(new Set());
    setPolygons([]);
    setDynamicCircles([]);
    setObjectReferenceId("");
    setObjectPlaceName("");
    setObjectSearchQuery("");
    setObjectCenter(null);
    setDraftRing([]);
    setDrawingActive(false);
    setHoleParentId(null);
    setSaveStatus("New zone creation canceled.");
  }, [activeZoneEntry?.zone.name, isCreatingNewZone]);

  const totalPolyAreaKm2 = useMemo(
    () => allWorkingPolygons.reduce((s, p) => s + geoPolygonAreaKm2(p), 0),
    [allWorkingPolygons],
  );

  const savedZoneCellLayers = useMemo<SavedZoneCellLayer[]>(
    () =>
      zoneEntries
        .map((entry, idx) => {
          const active = activeSavedZoneKey != null && entry.key === activeSavedZoneKey;
          if (!showAllZones && !active) return null;
          const cells = Array.isArray(entry.zone.h3_cells)
            ? entry.zone.h3_cells.filter(
                (v): v is string =>
                  typeof v === "string" && !removedCellIds.has(v),
              )
            : [];
          if (cells.length === 0) return null;
          const layerColor = active
            ? "#FBBF24"
            : ZONE_MAP_COLORS[idx % ZONE_MAP_COLORS.length];
          return {
            key: `saved-${entry.key}`,
            cells,
            color: layerColor,
            fillOpacity: active ? 0.38 : 0.22,
            weight: active ? 2.4 : 1.6,
          } satisfies SavedZoneCellLayer;
        })
        .filter((v): v is SavedZoneCellLayer => v !== null),
    [zoneEntries, activeSavedZoneKey, removedCellIds, showAllZones],
  );

  const savedZonePolygonLayers = useMemo<SavedZonePolygonLayer[]>(
    () =>
      zoneEntries
        .map((entry, idx) => {
          const active = activeSavedZoneKey != null && entry.key === activeSavedZoneKey;
          if (!showAllZones && !active) return null;
          const zonePolys = zoneToPolygons(entry.zone);
          const filtered = zonePolys.filter(
            (p) => !removedPolygonKeys.has(polygonKey(p)),
          );
          if (filtered.length === 0) return null;
          const layerColor = active
            ? "#FBBF24"
            : ZONE_MAP_COLORS[idx % ZONE_MAP_COLORS.length];
          return {
            key: `poly-${entry.key}`,
            polygons: filtered,
            color: layerColor,
            fillOpacity: active ? 0.26 : 0.12,
            weight: active ? 2.4 : 1.6,
          } satisfies SavedZonePolygonLayer;
        })
        .filter((v): v is SavedZonePolygonLayer => v !== null),
    [zoneEntries, activeSavedZoneKey, removedPolygonKeys, showAllZones],
  );
  const helperCircles = useMemo(() => {
    const circles: Array<{
      key: string;
      center: [number, number];
      radiusMeters: number;
      color: string;
      fillOpacity?: number;
      dashArray?: string;
    }> = [];
    zoneEntries.forEach((entry) => {
      const active = activeSavedZoneKey != null && entry.key === activeSavedZoneKey;
      if (!showAllZones && !active) return;
      const normalizedType = active
        ? zoneType
        : normalizeZoneTypeValue(entry.zone.type ?? entry.zone.zone_type);

      if (normalizedType === "proximity") {
        const center = active
          ? proximityCenter
          : extractZoneCenter(entry.zone);
        const radius = active
          ? proximityRadiusMeters
          : proximityRadiusFromZone(entry.zone, 500);
        if (center && radius > 0) {
          circles.push({
            key: `p-${entry.key}`,
            center,
            radiusMeters: radius,
            color: "#06B6D4",
            fillOpacity: active ? 0.2 : 0.1,
            dashArray: "8 6",
          });
        }
      }

      if (normalizedType === "dynamic") {
        const zoneCircles = active
          ? dynamicCircles
          : parseCircleDraftsFromZone(entry.zone, "dynamic", {
              proximityRadiusMeters: 500,
              dynamicMinRadiusMeters: 200,
              dynamicMaxRadiusMeters: 1000,
            });
        circles.push(
          ...zoneCircles.flatMap((c, idx) => [
            {
              key: `dmin-${entry.key}-${c.id}-${idx}`,
              center: c.center,
              radiusMeters: Math.max(c.minRadiusMeters ?? 0, 0),
              color: "#22C55E",
              fillOpacity: active ? 0.16 : 0.1,
              dashArray: "4 6",
            },
            {
              key: `dmax-${entry.key}-${c.id}-${idx}`,
              center: c.center,
              radiusMeters: Math.max(
                c.maxRadiusMeters ?? 0,
                c.minRadiusMeters ?? 0,
                c.radiusMeters,
              ),
              color: "#16A34A",
              fillOpacity: active ? 0.1 : 0.06,
              dashArray: "10 6",
            },
          ]),
        );
      }

      if (normalizedType === "object") {
        const zoneConfig = active
          ? { radius_meters: objectRadiusMeters }
          : zoneConfigMap(entry.zone);
        const center = active ? objectCenter : extractZoneCenter(entry.zone);
        const radius = Number(zoneConfig.radius_meters);
        if (center && Number.isFinite(radius) && radius > 0) {
          circles.push({
            key: `obj-${entry.key}`,
            center,
            radiusMeters: radius,
            color: "#A855F7",
            fillOpacity: active ? 0.14 : 0.08,
            dashArray: "3 6",
          });
        }
      }
    });

    if (
      isCreatingNewZone &&
      zoneType === "proximity" &&
      proximityCenter &&
      proximityRadiusMeters > 0
    ) {
      circles.push({
        key: "draft-proximity",
        center: proximityCenter,
        radiusMeters: proximityRadiusMeters,
        color: "#06B6D4",
        fillOpacity: 0.2,
        dashArray: "8 6",
      });
    }
    if (isCreatingNewZone && zoneType === "dynamic") {
      circles.push(
        ...dynamicCircles.flatMap((c, idx) => [
          {
            key: `draft-dmin-${c.id}-${idx}`,
            center: c.center,
            radiusMeters: Math.max(c.minRadiusMeters ?? 0, 0),
            color: "#22C55E",
            fillOpacity: 0.16,
            dashArray: "4 6",
          },
          {
            key: `draft-dmax-${c.id}-${idx}`,
            center: c.center,
            radiusMeters: Math.max(
              c.maxRadiusMeters ?? 0,
              c.minRadiusMeters ?? 0,
              c.radiusMeters,
            ),
            color: "#16A34A",
            fillOpacity: 0.1,
            dashArray: "10 6",
          },
        ]),
      );
    }
    if (
      isCreatingNewZone &&
      zoneType === "object" &&
      objectCenter &&
      objectRadiusMeters > 0
    ) {
      circles.push({
        key: "draft-object",
        center: objectCenter,
        radiusMeters: objectRadiusMeters,
        color: "#A855F7",
        fillOpacity: 0.14,
        dashArray: "3 6",
      });
    }
    return circles.filter((c) => c.radiusMeters > 0);
  }, [
    zoneEntries,
    activeSavedZoneKey,
    showAllZones,
    isCreatingNewZone,
    zoneType,
    dynamicCircles,
    proximityCenter,
    proximityRadiusMeters,
    objectCenter,
    objectRadiusMeters,
  ]);

  const focusH3Cell = useCallback((cellId: string) => {
    const corners = cornersFromH3Cell(cellId);
    if (!corners) return;
    mapFitSeq.current += 1;
    setMapFitBounds({ key: mapFitSeq.current, ...corners });
  }, []);

  const focusPolygonShape = useCallback((p: GeoPolygonShape) => {
    const corners = cornersFromPolygonShape(p);
    if (!corners) return;
    mapFitSeq.current += 1;
    setMapFitBounds({ key: mapFitSeq.current, ...corners });
  }, []);

  const focusPolygonShapes = useCallback((shapes: GeoPolygonShape[]) => {
    const corners = cornersFromPolygonShapes(shapes);
    if (corners) {
      mapFitSeq.current += 1;
      setMapFitBounds({ key: mapFitSeq.current, ...corners });
      return;
    }
    if (shapes[0]) focusPolygonShape(shapes[0]);
  }, [focusPolygonShape]);

  const applyReferenceZoneFromApi = useCallback(
    (
      result: ZoneReferenceValidateResult,
      options: {
        setCode: (value: string) => void;
        setValidation: (value: ReferenceValidationState | null) => void;
        invalidMessage: string;
        normalizeCode?: (raw: string) => string;
      },
    ) => {
      if (!result.valid) {
        options.setValidation({
          valid: false,
          message: result.message ?? options.invalidMessage,
        });
        setPolygons([]);
        setSelectedCells([]);
        return;
      }
      const normalize =
        options.normalizeCode ?? ((raw: string) => raw.trim().toUpperCase());
      const referenceId = normalize(result.reference_id);
      options.setCode(referenceId);
      options.setValidation({
        valid: true,
        referenceId,
        displayName: result.display_name ?? undefined,
        geometry: result.geometry ?? {},
        config: result.config ?? {},
        h3Cells: Array.isArray(result.h3_cells) ? [...result.h3_cells] : [],
        source: result.source ?? undefined,
      });
      const rawFence =
        result.geometry?.geo_fence_polygon ?? result.geometry;
      const shapes = geoJsonPolygonToShapes(
        normalizeGeoFencePolygonValue(rawFence),
      );
      setPolygons(shapes);
      setRemovedPolygonKeys(new Set());
      setSelectedCells(
        Array.isArray(result.h3_cells) ? [...result.h3_cells] : [],
      );
      setRemovedCellIds(new Set());
      if (!zoneName.trim() && result.display_name?.trim()) {
        setZoneName(result.display_name.trim());
      }
      focusPolygonShapes(shapes);
    },
    [focusPolygonShapes, zoneName],
  );

  const applyCommunalFromApi = useCallback(
    (result: ZoneReferenceValidateResult) => {
      applyReferenceZoneFromApi(result, {
        setCode: setCommunalCode,
        setValidation: setCommunalValidation,
        invalidMessage: "Communal ID could not be resolved.",
      });
    },
    [applyReferenceZoneFromApi],
  );

  const applyGovernmentFromApi = useCallback(
    (result: ZoneReferenceValidateResult) => {
      if (!result.valid) {
        setGovernmentValidation({
          valid: false,
          message: result.message ?? "Address could not be resolved.",
        });
        setPolygons([]);
        setSelectedCells([]);
        return;
      }
      const fields = applyGovernmentFieldsFromConfig(result.config ?? {});
      setGovernmentAddressMode(fields.addressMode);
      setGovernmentPostalCode(fields.postalCode);
      setGovernmentCity(fields.city);
      setGovernmentCountry(fields.country);
      setGovernmentStreet(fields.street);
      setGovernmentStreetNumber(fields.streetNumber);
      const referenceId = buildGovernmentReferenceId(fields);
      setGovernmentValidation({
        valid: true,
        referenceId,
        displayName: result.display_name ?? undefined,
        geometry: result.geometry ?? {},
        config: result.config ?? {},
        h3Cells: Array.isArray(result.h3_cells) ? [...result.h3_cells] : [],
        source: result.source ?? undefined,
      });
      const rawFence =
        result.geometry?.geo_fence_polygon ?? result.geometry;
      const shapes = geoJsonPolygonToShapes(
        normalizeGeoFencePolygonValue(rawFence),
      );
      setPolygons(shapes);
      setRemovedPolygonKeys(new Set());
      setSelectedCells(
        Array.isArray(result.h3_cells) ? [...result.h3_cells] : [],
      );
      setRemovedCellIds(new Set());
      if (!zoneName.trim() && result.display_name?.trim()) {
        setZoneName(result.display_name.trim());
      }
      focusPolygonShapes(shapes);
    },
    [focusPolygonShapes, zoneName],
  );

  const validateCommunalId = useCallback(async () => {
    const referenceId = communalCode.trim();
    if (!referenceId) {
      setSaveStatus("Enter a communal ID to validate.");
      return;
    }
    setCommunalValidating(true);
    setSaveStatus("Validating communal ID…");
    try {
      const { data, error } = await validateZoneReference({
        zone_type: "communal_id",
        reference_id: referenceId,
      });
      if (error || !data) {
        setCommunalValidation({
          valid: false,
          message: error ?? "Validation request failed.",
        });
        setSaveStatus(error ?? "Validation request failed.");
        return;
      }
      applyCommunalFromApi(data);
      if (data.valid) {
        setSaveStatus(
          data.display_name
            ? `Validated "${data.display_name}" — preview on map.`
            : `Validated ${data.reference_id} — preview on map.`,
        );
      } else {
        setSaveStatus(data.message ?? "Communal ID could not be resolved.");
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Validation request failed.";
      setCommunalValidation({ valid: false, message });
      setSaveStatus(message);
    } finally {
      setCommunalValidating(false);
    }
  }, [applyCommunalFromApi, communalCode]);

  const generateCommunalId = useCallback(async () => {
    setCommunalValidating(true);
    setSaveStatus("Generating communal ID…");
    try {
      const { data, error } = await generateZoneReference({
        zone_type: "communal_id",
      });
      if (error || !data) {
        setSaveStatus(error ?? "Could not generate communal ID.");
        return;
      }
      applyCommunalFromApi(data);
      setSaveStatus(`Generated ${data.reference_id} — preview on map.`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not generate communal ID.";
      setSaveStatus(message);
    } finally {
      setCommunalValidating(false);
    }
  }, [applyCommunalFromApi]);

  const validateGovernmentAddress = useCallback(async () => {
    if (!isGovernmentAddressComplete(governmentFields)) {
      setSaveStatus(
        governmentFields.addressMode === "street"
          ? "Enter street, postal code, city, and country."
          : "Enter postal code, city, and country.",
      );
      return;
    }
    setGovernmentValidating(true);
    setSaveStatus("Validating address…");
    try {
      const { data, error } = await validateZoneReference(
        governmentAddressValidatePayload(governmentFields),
      );
      if (error || !data) {
        setGovernmentValidation({
          valid: false,
          message: error ?? "Validation request failed.",
        });
        setSaveStatus(error ?? "Validation request failed.");
        return;
      }
      applyGovernmentFromApi(data);
      if (data.valid) {
        setSaveStatus(
          data.display_name
            ? `Validated "${data.display_name}" — area polygon on map.`
            : `Validated ${data.reference_id} — area polygon on map.`,
        );
      } else {
        setSaveStatus(data.message ?? "Address could not be resolved.");
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Validation request failed.";
      setGovernmentValidation({ valid: false, message });
      setSaveStatus(message);
    } finally {
      setGovernmentValidating(false);
    }
  }, [applyGovernmentFromApi, governmentFields]);

  const focusObjectZone = useCallback(
    (center: [number, number], radiusMeters: number) => {
      const corners = cornersFromCircle(center, radiusMeters);
      if (corners) {
        mapFitSeq.current += 1;
        setMapFitBounds({ key: mapFitSeq.current, ...corners });
        return;
      }
      setMapCenter(center);
    },
    [],
  );

  const focusAllZonesOnMap = useCallback(() => {
    const parts: Array<ReturnType<typeof cornersFromH3Cell>> = [];
    const circleDefaults = {
      proximityRadiusMeters: proximityRadiusMeters || 500,
      dynamicMinRadiusMeters: dynamicMinRadiusMeters || 200,
      dynamicMaxRadiusMeters: dynamicMaxRadiusMeters || 1000,
    };

    for (const entry of zoneEntries) {
      const zone = entry.zone;
      const zoneKind = normalizeZoneTypeValue(zone.type ?? zone.zone_type);

      if (isObjectZone(zone)) {
        const center = extractZoneCenter(zone);
        if (center) {
          parts.push(cornersFromCircle(center, objectZoneRadiusMeters(zone)));
        }
        continue;
      }

      const polys = zoneToPolygons(zone);
      if (polys.length > 0) {
        parts.push(cornersFromPolygonShapes(polys));
      }

      if (Array.isArray(zone.h3_cells)) {
        for (const cell of zone.h3_cells) {
          if (typeof cell !== "string") continue;
          parts.push(cornersFromH3Cell(cell));
        }
      }

      if (zoneKind === "proximity" || zoneKind === "dynamic") {
        const circles = parseCircleDraftsFromZone(
          zone,
          zoneKind,
          circleDefaults,
        );
        for (const circle of circles) {
          parts.push(cornersFromCircle(circle.center, circle.radiusMeters));
        }
      }
    }

    const merged = mergeFitBoundsCorners(parts);
    if (!merged) return;
    mapFitSeq.current += 1;
    setMapFitBounds({ key: mapFitSeq.current, ...merged });
  }, [
    zoneEntries,
    proximityRadiusMeters,
    dynamicMinRadiusMeters,
    dynamicMaxRadiusMeters,
  ]);

  const focusSavedZoneOnMap = useCallback(
    (zone: SavedZone) => {
      const zoneKind = normalizeZoneTypeValue(zone.type ?? zone.zone_type);

      if (isObjectZone(zone)) {
        const center = extractZoneCenter(zone);
        if (center) {
          focusObjectZone(center, objectZoneRadiusMeters(zone));
        }
        return;
      }

      if (zoneKind === "proximity") {
        const center = extractZoneCenter(zone);
        const radius = proximityRadiusFromZone(zone, proximityRadiusMeters || 500);
        if (center && radius > 0) {
          focusObjectZone(center, radius);
        }
        return;
      }

      const polygonsForZone = zoneToPolygons(zone);

      if (zoneKind === "geofence") {
        if (polygonsForZone.length > 0) {
          focusPolygonShapes(polygonsForZone);
        }
        return;
      }

      if (zoneKind === "grid") {
        const focusCell = Array.isArray(zone.h3_cells) ? zone.h3_cells[0] : undefined;
        if (focusCell) {
          focusH3Cell(focusCell);
          return;
        }
      }

      if (polygonsForZone.length > 0) {
        focusPolygonShapes(polygonsForZone);
        return;
      }

      const focusCell = Array.isArray(zone.h3_cells) ? zone.h3_cells[0] : undefined;
      if (focusCell) focusH3Cell(focusCell);
    },
    [focusH3Cell, focusObjectZone, focusPolygonShape, focusPolygonShapes, proximityRadiusMeters],
  );

  const didInitialZonesFitRef = useRef(false);
  useEffect(() => {
    if (zoneEntries.length === 0) {
      didInitialZonesFitRef.current = false;
      return;
    }
    if (didInitialZonesFitRef.current) return;
    didInitialZonesFitRef.current = true;
    focusAllZonesOnMap();
  }, [zoneEntries, focusAllZonesOnMap]);

  const modeBadge = usesMapGeometry
    ? mapperMode === "h3"
      ? "H3 Select"
      : drawingActive
        ? "Drawing"
        : "Polygon"
    : "Config Mode";

  const customerSummary = useMemo(() => {
    if (!contextMenu) return { h3Hits: 0, polyHits: 0 };
    const { lat, lng } = contextMenu;
    let h3Hits = 0;
    for (const id of selectedCells) {
      try {
        const ring = h3ToPolygon(id);
        const t = turf.point([lng, lat]);
        const c = ring.map(([x, y]) => [x, y] as [number, number]);
        if (c[0][0] !== c[c.length - 1][0] || c[0][1] !== c[c.length - 1][1]) {
          c.push(c[0]);
        }
        const poly = turf.polygon([c]);
        if (turf.booleanPointInPolygon(t, poly)) h3Hits += 1;
      } catch {
        /* skip */
      }
    }
    let polyHits = 0;
    for (const p of polygons) {
      if (pointInPolygon(lat, lng, p.outer)) {
        let inHole = false;
        for (const h of p.holes) {
          if (pointInPolygon(lat, lng, h)) {
            inHole = true;
            break;
          }
        }
        if (!inHole) polyHits += 1;
      }
    }
    return { h3Hits, polyHits };
  }, [contextMenu, selectedCells, polygons]);

  const labelClass =
    "mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500";

  return (
    <div className="w-full min-w-0 max-w-full overflow-x-clip rounded-lg border border-slate-800/60 bg-[#0B0E11]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 px-4 py-3 sm:px-6">
        <span className="text-xs font-bold uppercase tracking-[0.2em] text-white">
          H3 Hexagon Mapper
        </span>
        <div
          className={`flex items-center gap-2 rounded-full border border-slate-700/80 ${panel} px-3 py-1.5 font-mono text-xs text-[#00E5D1]`}
        >
          <span className="max-w-[140px] truncate sm:max-w-xs">{zoneId}</span>
          <button
            type="button"
            onClick={copyZoneId}
            className="rounded p-1 text-[#00E5D1] transition hover:bg-white/10"
            aria-label="Copy zone ID"
          >
            <Copy className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
        <span className="text-sm text-slate-300">{userLabel}</span>
      </header>

      {user?.role === "administrator" && zoneId.trim() !== "" ? (
        <GuestRequestsDashboardSection zoneId={zoneId.trim()} />
      ) : null}

      {user?.role === "administrator" && zoneId.trim() !== "" ? (
        <div className="border-b border-slate-800/80 px-4 py-4 sm:px-6">
          <GuestAccessQrSection zoneId={zoneId.trim()} compact />
        </div>
      ) : null}

      <div className="flex min-h-[min(100dvh,920px)] flex-1 flex-col lg:min-h-[calc(100dvh-11rem)] lg:flex-row lg:min-w-0">
        <aside className="flex w-full min-w-0 flex-col border-slate-800/80 lg:w-[400px] lg:max-w-[400px] lg:shrink-0 lg:border-r">
          <div className="max-h-[50vh] flex-1 space-y-4 overflow-y-auto p-4 sm:p-5 lg:max-h-none">
            <div>
              <p className={labelClass}>Zone ID</p>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={zoneId}
                  className={`min-w-0 flex-1 rounded-md border border-slate-700/80 ${panel} px-3 py-2 font-mono text-xs text-[#00E5D1]`}
                />
                <button
                  type="button"
                  onClick={copyZoneId}
                  className={`rounded-md border border-slate-700/80 ${panel} px-2.5 text-[#00E5D1]`}
                  aria-label="Copy"
                >
                  <Copy className="h-4 w-4" strokeWidth={2} />
                </button>
              </div>
            </div>

            <div>
              <label className={labelClass} htmlFor="zone-name">
                Zone name
              </label>
              <input
                id="zone-name"
                value={zoneName}
                onChange={(e) => setZoneName(e.target.value)}
                maxLength={MAX_ZONE_NAME_LENGTH}
                placeholder="Enter zone name"
                className={`w-full rounded-md border border-slate-700/80 ${panel} px-3 py-2 text-sm text-white focus:border-[#00E5D1]/60 focus:outline-none focus:ring-1 focus:ring-[#00E5D1]/25`}
              />
              <p className="mt-1 text-[10px] text-slate-500">
                Required. Max {MAX_ZONE_NAME_LENGTH} characters.
              </p>
            </div>

            <div>
              <label className={labelClass} htmlFor="zone-type">
                Zone type
              </label>
              <select
                id="zone-type"
                value={zoneType}
                onChange={(e) => {
                  const next = normalizeZoneTypeValue(e.target.value);
                  setZoneType(next);
                  if (next !== "communal_id") {
                    setCommunalValidation(null);
                  }
                  if (next !== "government_local_code") {
                    setGovernmentValidation(null);
                  }
                  if (next === "proximity") {
                    setProximitySourceMode("map_pin");
                  }
                }}
                className={`w-full rounded-md border border-slate-700/80 ${panel} px-3 py-2 text-sm text-white focus:border-[#00E5D1]/60 focus:outline-none focus:ring-1 focus:ring-[#00E5D1]/25`}
              >
                <option value="geofence">Geofence</option>
                <option value="grid">Grid zoning</option>
                <option value="proximity">Proximity-to-source</option>
                <option value="dynamic">Dynamic-size</option>
                <option value="communal_id">Communal ID</option>
                <option value="government_local_code">Government Local Code</option>
                <option value="object">Object zoning</option>
              </select>
              <p className="mt-1 text-[10px] text-slate-500">
                Geofence/Grid: draw on map. Proximity: one source + radius. Other
                types use fields below.
              </p>
              <p className="mt-1 text-[10px]" style={{ color: typeVisual.color }}>
                Active profile: {typeVisual.label}
              </p>
            </div>

            {zoneType === "proximity" && (
              <div className="space-y-3">
                <div>
                  <p className={labelClass}>Source</p>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setProximitySourceMode("current_location");
                        setSaveStatus(
                          "Tap Use current location, or switch to Pin on map.",
                        );
                      }}
                      className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-xs font-medium transition ${
                        proximitySourceMode === "current_location"
                          ? "border-[#00E5D1] bg-[#00E5D1]/10 text-[#00E5D1]"
                          : "border-slate-700/80 bg-[#151a20] text-slate-300"
                      }`}
                    >
                      <LocateFixed className="h-3.5 w-3.5" />
                      My location
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setProximitySourceMode("map_pin");
                        setSaveStatus("Click the map to set the source point.");
                      }}
                      className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-xs font-medium transition ${
                        proximitySourceMode === "map_pin"
                          ? "border-[#00E5D1] bg-[#00E5D1]/10 text-[#00E5D1]"
                          : "border-slate-700/80 bg-[#151a20] text-slate-300"
                      }`}
                    >
                      <MapPin className="h-3.5 w-3.5" />
                      Pin on map
                    </button>
                  </div>
                </div>
                {proximitySourceMode === "current_location" ? (
                  <button
                    type="button"
                    onClick={captureProximityLocation}
                    disabled={proximityLocating}
                    className="w-full rounded-md border border-slate-600 py-2 text-xs text-slate-200 hover:border-[#00E5D1]/50 disabled:opacity-60"
                  >
                    {proximityLocating
                      ? "Reading location…"
                      : "Use current location"}
                  </button>
                ) : (
                  <p className="text-[10px] text-slate-500">
                    Click the map once to place the source. One circle per zone.
                  </p>
                )}
                <div>
                  <label className={labelClass} htmlFor="zone-proximity-radius">
                    Proximity radius ({proximityRadiusMeters} m)
                  </label>
                  <input
                    id="zone-proximity-radius-slider"
                    type="range"
                    min={10}
                    max={20000}
                    step={10}
                    value={Math.min(Math.max(proximityRadiusMeters, 10), 20000)}
                    onChange={(e) =>
                      setProximityRadiusMeters(Number(e.target.value) || 10)
                    }
                    className="mt-1 w-full accent-[#00E5D1]"
                  />
                  <input
                    id="zone-proximity-radius"
                    type="number"
                    min={1}
                    value={proximityRadiusMeters}
                    onChange={(e) =>
                      setProximityRadiusMeters(Number(e.target.value) || 0)
                    }
                    className="mt-2 w-full rounded-md border border-slate-700/80 bg-[#151a20] px-3 py-2 text-sm text-white"
                  />
                </div>
              </div>
            )}

            {zoneType === "dynamic" && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelClass} htmlFor="zone-dynamic-min">
                    Min radius (m)
                  </label>
                  <input
                    id="zone-dynamic-min"
                    type="number"
                    min={1}
                    value={dynamicMinRadiusMeters}
                    onChange={(e) =>
                      setDynamicMinRadiusMeters(Number(e.target.value) || 0)
                    }
                    className="w-full rounded-md border border-slate-700/80 bg-[#151a20] px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="zone-dynamic-max">
                    Max radius (m)
                  </label>
                  <input
                    id="zone-dynamic-max"
                    type="number"
                    min={1}
                    value={dynamicMaxRadiusMeters}
                    onChange={(e) =>
                      setDynamicMaxRadiusMeters(Number(e.target.value) || 0)
                    }
                    className="w-full rounded-md border border-slate-700/80 bg-[#151a20] px-3 py-2 text-sm text-white"
                  />
                </div>
              </div>
            )}

            {zoneType === "communal_id" && (
              <div className="space-y-2">
                <label className={labelClass} htmlFor="zone-communal-id">
                  Communal ID
                </label>
                <input
                  id="zone-communal-id"
                  value={communalCode}
                  onChange={(e) => {
                    setCommunalCode(e.target.value);
                    setCommunalValidation(null);
                  }}
                  placeholder="COMM-12345"
                  className="w-full rounded-md border border-slate-700/80 bg-[#151a20] px-3 py-2 text-sm text-white uppercase"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void validateCommunalId()}
                    disabled={communalValidating || !canValidateReferenceZone}
                    className="rounded-md border border-[#8B5CF6]/50 bg-[#8B5CF6]/15 px-3 py-1.5 text-xs font-medium text-[#C4B5FD] hover:bg-[#8B5CF6]/25 disabled:opacity-50"
                  >
                    {communalValidating ? "Validating…" : "Validate ID"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void generateCommunalId()}
                    disabled={communalValidating || !canValidateReferenceZone}
                    className="rounded-md border border-slate-600/80 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700/60 disabled:opacity-50"
                  >
                    Generate ID
                  </button>
                </div>
                {communalValidation?.valid === true && communalValidated ? (
                  <p className="text-[10px] text-[#C4B5FD]">
                    {communalValidation.displayName
                      ? `${communalValidation.displayName} (${communalValidation.referenceId})`
                      : communalValidation.referenceId}{" "}
                    — map preview ready
                    {communalValidation.source
                      ? ` · ${communalValidation.source}`
                      : ""}
                  </p>
                ) : communalValidation?.valid === false ? (
                  <p className="text-[10px] text-rose-400">
                    {communalValidation.message}
                  </p>
                ) : (
                  <p className="text-[10px] text-slate-500">
                    Enter an ID or generate one, validate, then confirm the boundary on
                    the map before saving.
                  </p>
                )}
              </div>
            )}

            {zoneType === "government_local_code" && (
              <div className="space-y-3">
                <div>
                  <span className={labelClass}>Address type</span>
                  <div className="mt-1 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setGovernmentAddressMode("postal");
                        setGovernmentValidation(null);
                      }}
                      className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                        governmentAddressMode === "postal"
                          ? "border-[#0EA5E9]/60 bg-[#0EA5E9]/20 text-[#7DD3FC]"
                          : "border-slate-700/80 text-slate-400 hover:border-slate-600"
                      }`}
                    >
                      Postal area
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setGovernmentAddressMode("street");
                        setGovernmentValidation(null);
                      }}
                      className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                        governmentAddressMode === "street"
                          ? "border-[#0EA5E9]/60 bg-[#0EA5E9]/20 text-[#7DD3FC]"
                          : "border-slate-700/80 text-slate-400 hover:border-slate-600"
                      }`}
                    >
                      Street address
                    </button>
                  </div>
                </div>

                {governmentAddressMode === "street" ? (
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                      <label className={labelClass} htmlFor="zone-gov-street">
                        Street name
                      </label>
                      <input
                        id="zone-gov-street"
                        value={governmentStreet}
                        onChange={(e) => {
                          setGovernmentStreet(e.target.value);
                          setGovernmentValidation(null);
                        }}
                        placeholder="Khreshchatyk"
                        className="mt-1 w-full rounded-md border border-slate-700/80 bg-[#151a20] px-3 py-2 text-sm text-white"
                      />
                    </div>
                    <div>
                      <label className={labelClass} htmlFor="zone-gov-number">
                        No.
                      </label>
                      <input
                        id="zone-gov-number"
                        value={governmentStreetNumber}
                        onChange={(e) => {
                          setGovernmentStreetNumber(e.target.value);
                          setGovernmentValidation(null);
                        }}
                        placeholder="22"
                        className="mt-1 w-full rounded-md border border-slate-700/80 bg-[#151a20] px-3 py-2 text-sm text-white"
                      />
                    </div>
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelClass} htmlFor="zone-gov-postal">
                      Postal code
                    </label>
                    <input
                      id="zone-gov-postal"
                      value={governmentPostalCode}
                      onChange={(e) => {
                        setGovernmentPostalCode(e.target.value);
                        setGovernmentValidation(null);
                      }}
                      placeholder="M5H 2N2"
                      className="mt-1 w-full rounded-md border border-slate-700/80 bg-[#151a20] px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="zone-gov-city">
                      City
                    </label>
                    <input
                      id="zone-gov-city"
                      value={governmentCity}
                      onChange={(e) => {
                        setGovernmentCity(e.target.value);
                        setGovernmentValidation(null);
                      }}
                      placeholder="Toronto"
                      className="mt-1 w-full rounded-md border border-slate-700/80 bg-[#151a20] px-3 py-2 text-sm text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className={labelClass} htmlFor="zone-gov-country">
                    Country
                  </label>
                  <input
                    id="zone-gov-country"
                    value={governmentCountry}
                    onChange={(e) => {
                      setGovernmentCountry(e.target.value);
                      setGovernmentValidation(null);
                    }}
                    placeholder="Canada"
                    className="mt-1 w-full rounded-md border border-slate-700/80 bg-[#151a20] px-3 py-2 text-sm text-white"
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void validateGovernmentAddress()}
                    disabled={governmentValidating || !canValidateReferenceZone}
                    className="rounded-md border border-[#0EA5E9]/50 bg-[#0EA5E9]/15 px-3 py-1.5 text-xs font-medium text-[#7DD3FC] hover:bg-[#0EA5E9]/25 disabled:opacity-50"
                  >
                    {governmentValidating ? "Validating…" : "Validate address"}
                  </button>
                </div>
                {!canValidateReferenceZone ? (
                  <p className="text-[10px] text-amber-400/90">
                    Click <span className="font-medium">+ New zone</span> or select
                    an editable zone tab to validate an address.
                  </p>
                ) : null}
                {governmentValidation?.valid === true && governmentValidated ? (
                  <p className="text-[10px] text-[#7DD3FC]">
                    {governmentValidation.displayName
                      ? `${governmentValidation.displayName} (${governmentValidation.referenceId})`
                      : governmentValidation.referenceId}{" "}
                    — area polygon on map
                    {governmentValidation.source
                      ? ` · ${governmentValidation.source}`
                      : ""}
                  </p>
                ) : governmentValidation?.valid === false ? (
                  <p className="text-[10px] text-rose-400">
                    {governmentValidation.message}
                  </p>
                ) : (
                  <p className="text-[10px] text-slate-500">
                    {governmentAddressMode === "street"
                      ? "e.g. Khreshchatyk 22, 01001 Kyiv, Ukraine  ·  or Queen Street West 100, M5H 2N2 Toronto, Canada"
                      : "e.g. M5H 2N2, Toronto, Canada  ·  or 01001, Kyiv, Ukraine"}
                  </p>
                )}
              </div>
            )}

            {zoneType === "object" && (
              <div className="space-y-2">
                <AddressAutocompleteInput
                  id="zone-object-search"
                  label="Search object / place"
                  value={objectSearchQuery}
                  onChange={(label, coords, feature) => {
                    setObjectSearchQuery(label);
                    if (!coords) return;
                    const [lat, lng] = coords;
                    setObjectCenter([lat, lng]);
                    setObjectPlaceName(label);
                    setObjectReferenceId(
                      feature ? photonPlaceReferenceId(feature) : objectReferenceId,
                    );
                    setMapCenter([lat, lng]);
                    setSaveStatus(
                      `Object set to "${label}". Set radius and save the zone.`,
                    );
                  }}
                  placeholder="Building, cafe, shop, landmark…"
                  labelClassName={labelClass}
                  inputClassName="w-full rounded-md border border-slate-700/80 bg-[#151a20] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-[#00E5D1]/60 focus:outline-none focus:ring-1 focus:ring-[#00E5D1]/25"
                  className="relative z-20"
                />
                <div>
                  <label className={labelClass} htmlFor="zone-object-id">
                    Object ID / reference
                  </label>
                  <input
                    id="zone-object-id"
                    value={objectReferenceId}
                    onChange={(e) => setObjectReferenceId(e.target.value)}
                    placeholder="OSM reference or custom ID"
                    className="w-full rounded-md border border-slate-700/80 bg-[#151a20] px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="zone-object-radius">
                    Object radius (meters)
                  </label>
                  <input
                    id="zone-object-radius"
                    type="number"
                    min={1}
                    value={objectRadiusMeters}
                    onChange={(e) => setObjectRadiusMeters(Number(e.target.value) || 0)}
                    className="w-full rounded-md border border-slate-700/80 bg-[#151a20] px-3 py-2 text-sm text-white"
                  />
                </div>
                <p className="text-[10px] text-slate-500">
                  Search for a place (building, cafe, etc.), pick a result, then set the radius.
                  You can also click the map once to fine-tune the anchor point.
                </p>
              </div>
            )}

            {usesMapGeometry ? (
              <div>
                <p className={labelClass}>Mode</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMapperMode("h3");
                      setDrawingActive(false);
                      setDraftRing([]);
                    }}
                    className={`rounded-md border px-3 py-2.5 text-sm font-medium transition ${
                      mapperMode === "h3"
                        ? "border-[#00E5D1] bg-[#00E5D1]/10 text-[#00E5D1]"
                        : "border-slate-700/80 bg-[#151a20] text-slate-400"
                    }`}
                  >
                    H3
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMapperMode("polygon");
                      setActiveTool(null);
                    }}
                    className={`rounded-md border px-3 py-2.5 text-sm font-medium transition ${
                      mapperMode === "polygon"
                        ? "border-[#00E5D1] bg-[#00E5D1]/10 text-[#00E5D1]"
                        : "border-slate-700/80 bg-[#151a20] text-slate-400"
                    }`}
                  >
                    Polygon
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-[10px] text-slate-500">
                Map drawing tools are hidden for this zone type.
              </p>
            )}

            {usesMapGeometry && mapperMode === "h3" && (
              <div className="space-y-3 rounded-md border border-slate-700/80 bg-[#151a20]/50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  H3 Select settings
                </p>
                <div>
                  <label className={labelClass} htmlFor="dash-res">
                    Resolution (0–15)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="dash-res"
                      type="range"
                      min={0}
                      max={15}
                      value={resolution}
                      onChange={(e) => setResolution(Number(e.target.value))}
                      className="w-full accent-[#00E5D1]"
                    />
                    <input
                      type="number"
                      min={0}
                      max={15}
                      value={resolution}
                      onChange={(e) =>
                        setResolution(
                          Math.min(
                            15,
                            Math.max(0, Number(e.target.value) || 0),
                          ),
                        )
                      }
                      className="w-14 rounded border border-slate-600 bg-[#0d1117] px-2 py-1 text-center text-xs text-white"
                    />
                  </div>
                </div>
                <div>
                  <label className={labelClass} htmlFor="h3-op">
                    Opacity ({h3OpacityPct}%)
                  </label>
                  <input
                    id="h3-op"
                    type="range"
                    min={0}
                    max={100}
                    value={h3OpacityPct}
                    onChange={(e) => setH3OpacityPct(Number(e.target.value))}
                    className="w-full accent-[#00E5D1]"
                  />
                </div>
                <button
                  type="button"
                  onClick={clearH3}
                  className="w-full rounded-md border border-red-500/40 py-2 text-xs font-medium text-red-300 transition hover:bg-red-500/10"
                >
                  Clear All H3
                </button>
              </div>
            )}

            {usesMapGeometry && mapperMode === "polygon" && (
              <div className="space-y-3 rounded-md border border-slate-700/80 bg-[#151a20]/50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Geofence draw mode
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setGeofenceDrawTool("polygon");
                      setCircleDraft(null);
                    }}
                    className={`rounded-md border px-2 py-2 text-xs font-medium transition ${
                      geofenceDrawTool === "polygon"
                        ? "border-[#00E5D1] bg-[#00E5D1]/10 text-[#00E5D1]"
                        : "border-slate-700/80 text-slate-400"
                    }`}
                  >
                    Polygon
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setGeofenceDrawTool("circle");
                      setDraftRing([]);
                      setHoleParentId(null);
                    }}
                    className={`rounded-md border px-2 py-2 text-xs font-medium transition ${
                      geofenceDrawTool === "circle"
                        ? "border-[#00E5D1] bg-[#00E5D1]/10 text-[#00E5D1]"
                        : "border-slate-700/80 text-slate-400"
                    }`}
                  >
                    Circle
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDrawingActive((d) => {
                      const next = !d;
                      if (!next) {
                        setDraftRing([]);
                        setHoleParentId(null);
                        setCircleDraft(null);
                      } else {
                        setSelectedPolygonId(null);
                      }
                      return next;
                    });
                  }}
                  className={`w-full rounded-md py-2.5 text-sm font-bold transition ${
                    drawingActive
                      ? "bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/50"
                      : "bg-[#00E5D1] text-[#0B0E11] hover:brightness-110"
                  }`}
                >
                  {drawingActive ? "Stop drawing" : "Start drawing"}
                </button>
                {selectedPolygonId && !drawingActive && (
                  <button
                    type="button"
                    onClick={deleteSelectedPolygon}
                    className="w-full rounded-md border border-red-500/40 py-2 text-xs font-medium text-red-300 transition hover:bg-red-500/10"
                  >
                    Delete selected polygon
                  </button>
                )}
                <p className="text-[10px] text-slate-500">
                  {geofenceDrawTool === "polygon"
                    ? "Draw: tap vertices, then tap the first point to close. Edit: tap a polygon to select — click an edge to add a point, drag points, long-press a point to remove it, long-press the polygon to delete it."
                    : "Click map for circle center, move mouse for radius, click again to finish."}
                </p>
                <div>
                  <label className={labelClass} htmlFor="poly-op">
                    Opacity ({polygonOpacityPct}%)
                  </label>
                  <input
                    id="poly-op"
                    type="range"
                    min={0}
                    max={100}
                    value={polygonOpacityPct}
                    onChange={(e) =>
                      setPolygonOpacityPct(Number(e.target.value))
                    }
                    className="w-full accent-[#00E5D1]"
                  />
                </div>
                <button
                  type="button"
                  onClick={clearPolygons}
                  className="w-full rounded-md border border-red-500/40 py-2 text-xs font-medium text-red-300 transition hover:bg-red-500/10"
                >
                  Clear All Polygons
                </button>
                <div>
                  <label className={labelClass} htmlFor="paste-wkt">
                    Paste KML or WKT
                  </label>
                  <textarea
                    id="paste-wkt"
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    rows={3}
                    placeholder="POLYGON ((…)) or KML…"
                    className="w-full rounded-md border border-slate-600 bg-[#0d1117] px-2 py-1.5 font-mono text-[11px] text-slate-200"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleImportWktKml}
                    className="flex-1 rounded-md border border-slate-600 py-2 text-xs text-slate-200 hover:border-[#00E5D1]/50"
                  >
                    Import
                  </button>
                  <button
                    type="button"
                    onClick={handleExportWkt}
                    className="flex-1 rounded-md border border-slate-600 py-2 text-xs text-slate-200 hover:border-[#00E5D1]/50"
                  >
                    Export WKT
                  </button>
                  <button
                    type="button"
                    onClick={handleExportKml}
                    className="flex-1 rounded-md border border-slate-600 py-2 text-xs text-slate-200 hover:border-[#00E5D1]/50"
                  >
                    Export KML
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2 rounded-md border border-slate-700/80 bg-[#151a20]/50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                Other tools
              </p>
              <button
                type="button"
                onClick={() => {
                  if (activeTool === "measure") {
                    setActiveTool(null);
                    setMeasureA(null);
                    setMeasureB(null);
                    setMeasurePreview(null);
                    setMeasureLabelKm(null);
                  } else {
                    setActiveTool("measure");
                    setDrawingActive(false);
                  }
                }}
                className={`flex w-full items-center justify-center gap-2 rounded-md border py-2 text-sm ${
                  activeTool === "measure"
                    ? "border-[#00E5D1] bg-[#00E5D1]/15 text-[#00E5D1]"
                    : "border-slate-600 text-slate-300"
                }`}
              >
                <Ruler className="h-4 w-4" strokeWidth={2} />
                Measurement Tool
              </button>
              {activeTool === "measure" && (
                <div className="space-y-2">
                  <label className={labelClass}>Line color</label>
                  <input
                    type="color"
                    value={measureColor}
                    onChange={(e) => setMeasureColor(e.target.value)}
                    className="h-8 w-full cursor-pointer rounded border border-slate-600"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTool(null);
                      setMeasureA(null);
                      setMeasureB(null);
                      setMeasurePreview(null);
                      setMeasureLabelKm(null);
                    }}
                    className="w-full rounded-md border border-slate-600 py-1.5 text-xs text-slate-400"
                  >
                    Stop measuring
                  </button>
                </div>
              )}
              <label className="flex cursor-pointer items-center justify-between gap-2 text-sm text-slate-300">
                <span>Show all zones on map</span>
                <input
                  type="checkbox"
                  checked={showAllZones}
                  onChange={(e) => setShowAllZones(e.target.checked)}
                  className="accent-[#00E5D1]"
                />
              </label>
              <label className="flex cursor-pointer items-center justify-between gap-2 text-sm text-slate-300">
                <span>Grayscale map</span>
                <input
                  type="checkbox"
                  checked={grayscaleMap}
                  onChange={(e) => setGrayscaleMap(e.target.checked)}
                  className="accent-[#00E5D1]"
                />
              </label>
              <AddressAutocompleteInput
                id="dash-loc"
                label="Search location"
                value={locationQuery}
                onChange={(address, coords) => {
                  setLocationQuery(address);
                  if (coords) {
                    const [lat, lng] = coords;
                    setMapCenter([lat, lng]);
                  }
                }}
                required={false}
                placeholder="Search for a street or place…"
                labelClassName={labelClass}
                inputClassName={`w-full rounded-md border border-slate-700/80 ${panel} px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-[#00E5D1]/60 focus:outline-none focus:ring-1 focus:ring-[#00E5D1]/25`}
                className="relative z-10"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleExportWorkspaceJson}
                  className="flex flex-1 items-center justify-center gap-1 rounded-md bg-[#00E5D1] px-3 py-2 text-xs font-bold text-[#0B0E11]"
                >
                  <Download className="h-3.5 w-3.5" />
                  Save JSON
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-1 items-center justify-center gap-1 rounded-md border border-slate-600 px-3 py-2 text-xs text-slate-200"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Load JSON
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleLoadWorkspaceJson(f);
                    e.target.value = "";
                  }}
                />
              </div>
            </div>

            <div>
              <div className="mb-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Zones ({zones.length})
                  </p>
                  <div className="flex items-center gap-2">
                    {loadingZones && (
                      <span className="text-[10px] text-slate-500">Loading…</span>
                    )}
                    {isCreatingNewZone && (
                      <button
                        type="button"
                        onClick={cancelNewZoneDraft}
                        className="rounded border border-red-500/40 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-red-300 transition hover:bg-red-500/10"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
                <div className="rounded-md border border-slate-700/80 bg-[#0d1117] p-2">
                  {zonesError ? (
                    <p className="text-xs text-red-300">{zonesError}</p>
                  ) : (
                    <>
                      <div className="flex w-full min-w-0 gap-2 overflow-x-auto pb-1">
                        {zoneEntries.map((entry) => {
                          const zone = entry.zone;
                          const isActive =
                            !isCreatingNewZone &&
                            activeSavedZoneKey != null &&
                            activeSavedZoneKey === entry.key;
                          return (
                            <button
                              key={entry.key}
                              type="button"
                              onClick={() => {
                                loadSavedZone(entry);
                                focusSavedZoneOnMap(entry.zone);
                              }}
                              className={`shrink-0 rounded-md border px-2.5 py-1.5 text-xs transition ${
                                isActive
                                  ? "border-[#00E5D1] bg-[#00E5D1]/20 text-white"
                                  : "border-slate-700/80 text-slate-300 hover:border-[#00E5D1]/60"
                              }`}
                            >
                              <span>{zone.name || `Zone ${savedZoneId(zone)}`}</span>
                              {!entry.editable && (
                                <span className="ml-2 text-[10px] uppercase text-slate-500">
                                  read-only
                                </span>
                              )}
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          onClick={startNewZoneDraft}
                          disabled={isCreatingNewZone || !canCreateZone}
                          className={`shrink-0 rounded-md border px-2.5 py-1.5 text-xs transition ${
                            isCreatingNewZone
                              ? "border-[#00E5D1] bg-[#00E5D1]/15 text-[#00E5D1]"
                              : !canCreateZone
                                ? "cursor-not-allowed border-slate-700/80 text-slate-500"
                                : "border-slate-700/80 text-slate-200 hover:border-[#00E5D1]/60"
                          }`}
                        >
                          + New zone
                        </button>
                      </div>
                      {zones.length === 0 && !isCreatingNewZone && (
                        <p className="mt-2 text-xs text-slate-500">
                          {canCreateZone
                            ? "No saved zones yet. Use + New zone to create your first zone."
                            : createBlockedReason || "No editable zones are currently available."}
                        </p>
                      )}
                      {!canCreateZone && (
                        <p className="mt-2 text-xs text-amber-300">
                          {createBlockedReason || "You cannot create more zones."}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>

              {usesMapGeometry && (
                <>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                      Selected H3 cells ({selectedCells.length})
                    </p>
                  </div>
                  <div className="max-h-36 overflow-y-auto rounded-md border border-slate-700/80 bg-[#0d1117] p-2">
                    {selectedCells.length === 0 ? (
                      <p className="text-xs text-slate-500">
                        Click the map in H3 mode to add cells at resolution{" "}
                        {resolution}.
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {selectedCells.map((id) => (
                          <li key={id}>
                            <button
                              type="button"
                              onClick={() => focusH3Cell(id)}
                              className="w-full rounded px-2 py-1.5 text-left font-mono text-[10px] leading-snug text-[#00E5D1] transition hover:bg-[#00E5D1]/15 hover:text-white"
                            >
                              <span className="break-all">{id}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}

              {usesMapGeometry && (
                <div className="mt-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    All working H3 cells ({allWorkingCells.length})
                  </p>
                </div>
                <div className="max-h-36 overflow-y-auto rounded-md border border-slate-700/80 bg-[#0d1117] p-2">
                  {allWorkingCells.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      No working cells. Add cells or load saved zones.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {allWorkingCells.map((id) => (
                        <li key={`all-${id}`}>
                          <button
                            type="button"
                            onClick={() => focusH3Cell(id)}
                            className="w-full rounded px-2 py-1.5 text-left font-mono text-[10px] leading-snug text-[#00E5D1] transition hover:bg-[#00E5D1]/15 hover:text-white"
                          >
                            <span className="break-all">{id}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                </div>
              )}

              {usesMapGeometry && (
                <div className="mt-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Polygons ({allWorkingPolygons.length})
                    {allWorkingPolygons.length > 0 ? (
                      <span className="ml-1 font-normal normal-case tracking-normal text-slate-600">
                        · {totalPolyAreaKm2.toFixed(3)} km² total
                      </span>
                    ) : null}
                  </p>
                </div>
                <div className="max-h-36 overflow-y-auto rounded-md border border-slate-700/80 bg-[#0d1117] p-2">
                  {allWorkingPolygons.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      Draw in polygon mode or load workspace JSON.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {allWorkingPolygons.map((p, i) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => {
                              focusPolygonShape(p);
                              setSelectedPolygonId(p.id);
                              setMapperMode("polygon");
                              setDrawingActive(false);
                              setSaveStatus(
                                "Polygon selected — drag handles to edit.",
                              );
                            }}
                            className={`w-full rounded px-2 py-1.5 text-left text-[10px] leading-snug transition hover:bg-[#00E5D1]/15 hover:text-white ${
                              selectedPolygonId === p.id
                                ? "bg-[#00E5D1]/20 text-white"
                                : "text-[#00E5D1]"
                            }`}
                          >
                            <div className="flex items-baseline gap-2 font-mono">
                              <span className="shrink-0 text-slate-500">
                                #{i + 1}
                              </span>
                              <span className="min-w-0 break-all">{p.id}</span>
                            </div>
                            <div className="mt-0.5 font-mono text-[9px] text-slate-500">
                              {geoPolygonAreaKm2(p).toFixed(3)} km²
                              {p.holes.length > 0
                                ? ` · ${p.holes.length} hole(s)`
                                : ""}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-slate-800/80 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  clearH3();
                  clearPolygons();
                  setSaveStatus("");
                }}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-md border border-slate-600 bg-transparent px-3 py-2.5 text-sm text-slate-300 sm:flex-none"
              >
                <Trash2 className="h-4 w-4" strokeWidth={2} />
                Clear all
              </button>
              <button
                type="button"
                onClick={handleExportCsv}
                className="rounded-md border border-slate-700/80 bg-[#151a20] p-2.5 text-slate-300"
                aria-label="Export CSV"
              >
                <Download className="h-4 w-4" strokeWidth={2} />
              </button>
                <button
                type="button"
                onClick={handleSave}
                className="ml-auto min-w-[120px] flex-1 rounded-md bg-[#00E5D1] px-4 py-2.5 text-sm font-bold text-[#0B0E11] sm:flex-none"
              >
                {isCreatingNewZone ? "Create zone" : "Save zone"}
              </button>
            </div>
            {saveStatus ? (
              <p className="mt-2 text-center text-xs text-slate-500">
                {saveStatus}
              </p>
            ) : null}
          </div>
        </aside>

        <div className="relative min-h-[360px] min-w-0 flex-1 lg:min-h-0">
          <HexMapperMap
            center={mapCenter}
            mapFitBounds={mapFitBounds}
            resolution={resolution}
            selectedCells={selectedCells}
            savedZoneCellLayers={savedZoneCellLayers}
            savedZonePolygonLayers={savedZonePolygonLayers}
            helperCircles={helperCircles}
            h3Color={effectiveH3Color}
            h3FillOpacity={h3FillOpacity}
            polygons={polygons}
            polygonColor={effectivePolygonColor}
            polygonFillOpacity={polygonFillOpacity}
            draftRing={draftRing}
            draftLineColor={effectivePolygonColor}
            measureA={measureA}
            measureB={measureB}
            measurePreview={measurePreview}
            measureColor={measureColor}
            grayscale={grayscaleMap}
            interactionMode={mapInteraction}
            drawingActive={drawingActive}
            selectedPolygonId={selectedPolygonId}
            onVertexMove={handleVertexMove}
            onVertexDelete={handleVertexDelete}
            onEdgeVertexAdd={handleEdgeVertexAdd}
            onPolygonDelete={handlePolygonLongPressDelete}
            circleDraft={circleDraft}
            onMapClick={handleMapClick}
            onMapMouseMove={(lat, lng) => {
              handleMapMouseMove(lat, lng);
              setCursor({ lat, lng });
            }}
            onContextMenu={(lat, lng, cx, cy) => {
              setContextMenu({ x: cx, y: cy, lat, lng });
              setContextPanel(null);
            }}
            onCursorCoords={(lat, lng) => setCursor({ lat, lng })}
            interactive
            passMapClicks={passMapClicks}
          />

          {drawingActive && usesMapGeometry && mapperMode === "polygon" && (
            <div className="pointer-events-none absolute left-1/2 top-4 z-[500] -translate-x-1/2 rounded-md border border-amber-500/40 bg-[#0B0E11]/95 px-4 py-2 text-center text-xs text-amber-100 shadow-lg backdrop-blur">
              {geofenceDrawTool === "circle"
                ? "Circle: click center, move for radius, click again to finish"
                : "Polygon: tap vertices, tap first point to close · "}
              {geofenceDrawTool === "polygon" && (
                <>
                  <kbd className="rounded bg-white/10 px-1">Esc</kbd> undo ·{" "}
                  {holeParentId ? "Hole ring" : "Outer ring"}
                </>
              )}
            </div>
          )}

          {activeTool === "measure" && (
            <div className="pointer-events-none absolute left-1/2 top-4 z-[500] -translate-x-1/2 rounded-md border border-[#00E5D1]/40 bg-[#0B0E11]/95 px-4 py-2 text-xs text-[#00E5D1] shadow-lg">
              {!measureA && "Click first point"}
              {measureA && !measureB && "Click second point"}
              {measureB && measureLabelKm != null && (
                <span className="font-mono">
                  {(measureLabelKm * 1000).toFixed(1)} m ·{" "}
                  {measureLabelKm.toFixed(3)} km
                </span>
              )}
            </div>
          )}

          {contextMenu && !contextPanel && (
            <div
              data-context-menu-root
              className="fixed z-[2000] min-w-[180px] rounded-md border border-slate-600 bg-[#1a222c] py-1 text-sm shadow-xl"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-slate-200 hover:bg-white/5"
                onClick={() => setContextPanel("h3info")}
              >
                H3 Info Here
              </button>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-slate-200 hover:bg-white/5"
                onClick={() => setContextPanel("customer")}
              >
                Customer Info Here
              </button>
            </div>
          )}

          {contextMenu && contextPanel === "h3info" && (
            <div
              data-context-menu-root
              className="fixed z-[2001] max-h-64 max-w-sm overflow-auto rounded-md border border-slate-600 bg-[#1a222c] p-3 text-xs shadow-xl"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <p className="mb-2 font-semibold text-[#00E5D1]">
                H3 at click (res 0–15)
              </p>
              <ul className="space-y-1 font-mono text-[10px] text-slate-300">
                {h3CellsAtPoint(contextMenu.lat, contextMenu.lng).map((row) => (
                  <li key={row.res}>
                    r{row.res}:{" "}
                    <span className="break-all text-[#00E5D1]">{row.id}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="mt-2 text-[10px] text-slate-500 underline"
                onClick={() => setContextMenu(null)}
              >
                Close
              </button>
            </div>
          )}

          {contextMenu && contextPanel === "customer" && (
            <div
              data-context-menu-root
              className="fixed z-[2001] max-w-xs rounded-md border border-slate-600 bg-[#1a222c] p-3 text-xs shadow-xl"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <p className="font-semibold text-white">Coverage summary</p>
              <p className="mt-2 text-slate-400">
                Selected H3 cells covering point:{" "}
                <span className="text-[#00E5D1]">{customerSummary.h3Hits}</span>
              </p>
              <p className="text-slate-400">
                Polygons covering point:{" "}
                <span className="text-[#00E5D1]">
                  {customerSummary.polyHits}
                </span>
              </p>
              <button
                type="button"
                className="mt-2 text-[10px] text-slate-500 underline"
                onClick={() => setContextMenu(null)}
              >
                Close
              </button>
            </div>
          )}

          <div className="pointer-events-none absolute bottom-3 left-3 z-[400] rounded-md border border-slate-700/80 bg-[#0B0E11]/90 px-2 py-1 font-mono text-[10px] text-slate-400">
            {cursor ? (
              <>
                {cursor.lat.toFixed(6)}, {cursor.lng.toFixed(6)}
              </>
            ) : (
              "Move cursor…"
            )}
          </div>

          <div className="pointer-events-none absolute right-3 top-14 z-[400] flex flex-col gap-2">
            <span className="inline-flex items-center gap-2 rounded-md border border-[#00E5D1]/35 bg-[#0B0E11]/95 px-3 py-1.5 text-xs font-medium text-[#00E5D1] shadow-lg backdrop-blur-sm">
              <MapPin className="h-3.5 w-3.5" strokeWidth={2} />
              {modeBadge}
            </span>
          </div>

          <p className="pointer-events-none absolute bottom-2 right-3 z-[400] text-[10px] text-slate-500">
            Leaflet · © OSM / Esri / CARTO
          </p>
        </div>
      </div>
    </div>
  );
}
