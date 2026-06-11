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
import {
  previewDynamicZone,
  type DynamicZonePreviewResult,
} from "../services/api/zones";
import { updateLocation as updateMemberLocation } from "../services/api/members";

const accent = "#00E5D1";
const panel = "bg-[#F7FAFE]";
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

type DynamicTriggerOperator = ">=" | ">" | "<=" | "<" | "==";
type DynamicTriggerResize = "min" | "max" | number;

type DynamicMemberCountTrigger = {
  type: "member_count";
  operator: DynamicTriggerOperator;
  value: number;
  lookback_seconds: number;
  resize_to: DynamicTriggerResize;
};

type DynamicTimeOfDayTrigger = {
  type: "time_of_day";
  start: string;
  end: string;
  resize_to: DynamicTriggerResize;
};

type DynamicSensorTrigger = {
  type: "sensor";
  message_types: string[];
  lookback_seconds: number;
  min_count: number;
  resize_to: DynamicTriggerResize;
};

type DynamicTrigger =
  | DynamicMemberCountTrigger
  | DynamicTimeOfDayTrigger
  | DynamicSensorTrigger;

type DynamicTriggerDraft = DynamicTrigger & { id: string };

const DYNAMIC_TRIGGER_OPERATORS: DynamicTriggerOperator[] = [
  ">=",
  ">",
  "<=",
  "<",
  "==",
];

function makeDynamicTriggerId(): string {
  return `trigger-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultDynamicTriggerForType(
  ttype: DynamicTrigger["type"],
): DynamicTriggerDraft {
  if (ttype === "member_count") {
    return {
      id: makeDynamicTriggerId(),
      type: "member_count",
      operator: ">=",
      value: 5,
      lookback_seconds: 300,
      resize_to: "max",
    };
  }
  if (ttype === "time_of_day") {
    return {
      id: makeDynamicTriggerId(),
      type: "time_of_day",
      start: "22:00",
      end: "06:00",
      resize_to: "min",
    };
  }
  return {
    id: makeDynamicTriggerId(),
    type: "sensor",
    message_types: ["SENSOR"],
    lookback_seconds: 600,
    min_count: 1,
    resize_to: "max",
  };
}

function parseDynamicTriggersFromConfig(
  config: Record<string, unknown>,
): DynamicTriggerDraft[] {
  const raw = config.triggers;
  if (!Array.isArray(raw)) return [];
  const drafts: DynamicTriggerDraft[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const resize = row.resize_to;
    const resizeValue: DynamicTriggerResize =
      resize === "min" || resize === "max"
        ? resize
        : typeof resize === "number" && Number.isFinite(resize)
          ? resize
          : "max";
    if (row.type === "member_count") {
      const operator = DYNAMIC_TRIGGER_OPERATORS.includes(
        row.operator as DynamicTriggerOperator,
      )
        ? (row.operator as DynamicTriggerOperator)
        : ">=";
      drafts.push({
        id: makeDynamicTriggerId(),
        type: "member_count",
        operator,
        value: typeof row.value === "number" ? row.value : 0,
        lookback_seconds:
          typeof row.lookback_seconds === "number" && row.lookback_seconds > 0
            ? row.lookback_seconds
            : 300,
        resize_to: resizeValue,
      });
    } else if (row.type === "time_of_day") {
      drafts.push({
        id: makeDynamicTriggerId(),
        type: "time_of_day",
        start: typeof row.start === "string" ? row.start : "22:00",
        end: typeof row.end === "string" ? row.end : "06:00",
        resize_to: resizeValue,
      });
    } else if (row.type === "sensor") {
      const types = Array.isArray(row.message_types)
        ? row.message_types.filter(
            (t): t is string => typeof t === "string" && t.trim().length > 0,
          )
        : ["SENSOR"];
      drafts.push({
        id: makeDynamicTriggerId(),
        type: "sensor",
        message_types: types.length > 0 ? types : ["SENSOR"],
        lookback_seconds:
          typeof row.lookback_seconds === "number" && row.lookback_seconds > 0
            ? row.lookback_seconds
            : 600,
        min_count:
          typeof row.min_count === "number" && row.min_count > 0
            ? row.min_count
            : 1,
        resize_to: resizeValue,
      });
    }
  }
  return drafts;
}

type DynamicInputsFromConfig = {
  targetUserCount: number;
  minRadiusMeters: number;
  maxRadiusMeters: number;
  resolvedCenter: [number, number] | null;
  resolvedRadiusMeters: number | null;
  matchedUserCount: number | null;
};

/**
 * Read the three operator-supplied dynamic inputs (target, min, max) plus the
 * server-derived center/radius/matched count from a saved zone's config.
 * Falls back to sensible defaults when fields are missing so previously-saved
 * zones from older shapes still hydrate without crashing.
 */
function readDynamicInputsFromConfig(
  config: Record<string, unknown>,
  geometry: Record<string, unknown> | null,
): DynamicInputsFromConfig {
  const target = Number((config as Record<string, unknown>).target_user_count);
  const min = Number((config as Record<string, unknown>).min_radius_meters);
  const max = Number((config as Record<string, unknown>).max_radius_meters);
  const resolved = Number(
    (config as Record<string, unknown>).resolved_radius_meters,
  );
  const matched = Number(
    (config as Record<string, unknown>).matched_user_count,
  );
  const centerRaw =
    geometry && typeof (geometry as Record<string, unknown>).center === "object"
      ? ((geometry as Record<string, unknown>).center as Record<string, unknown>)
      : null;
  const centerLat = centerRaw ? Number(centerRaw.latitude) : NaN;
  const centerLng = centerRaw ? Number(centerRaw.longitude) : NaN;
  const resolvedCenter: [number, number] | null =
    Number.isFinite(centerLat) && Number.isFinite(centerLng)
      ? [centerLat, centerLng]
      : null;
  return {
    targetUserCount: Number.isFinite(target) && target >= 1 ? Math.trunc(target) : 5,
    minRadiusMeters: Number.isFinite(min) && min > 0 ? min : 200,
    maxRadiusMeters: Number.isFinite(max) && max > 0 ? max : 1000,
    resolvedCenter,
    resolvedRadiusMeters:
      Number.isFinite(resolved) && resolved > 0 ? resolved : null,
    matchedUserCount: Number.isFinite(matched) && matched >= 0 ? Math.trunc(matched) : null,
  };
}

function serializeDynamicTrigger(draft: DynamicTriggerDraft): DynamicTrigger {
  if (draft.type === "member_count") {
    return {
      type: "member_count",
      operator: draft.operator,
      value: draft.value,
      lookback_seconds: draft.lookback_seconds,
      resize_to: draft.resize_to,
    };
  }
  if (draft.type === "time_of_day") {
    return {
      type: "time_of_day",
      start: draft.start,
      end: draft.end,
      resize_to: draft.resize_to,
    };
  }
  return {
    type: "sensor",
    message_types: draft.message_types,
    lookback_seconds: draft.lookback_seconds,
    min_count: draft.min_count,
    resize_to: draft.resize_to,
  };
}

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
  const [dynamicDefaultRadiusMeters, setDynamicDefaultRadiusMeters] = useState<
    number | null
  >(null);
  const [dynamicTriggers, setDynamicTriggers] = useState<DynamicTriggerDraft[]>(
    [],
  );
  /**
   * Number of nearest users the server-resolved circle must cover. The server
   * picks the center; the operator only specifies the count + radius band.
   */
  const [dynamicTargetUserCount, setDynamicTargetUserCount] = useState(5);
  const [dynamicPreview, setDynamicPreview] =
    useState<DynamicZonePreviewResult | null>(null);
  const [dynamicPreviewLoading, setDynamicPreviewLoading] = useState(false);
  const [dynamicPreviewError, setDynamicPreviewError] = useState<string | null>(
    null,
  );
  /** Monotonic token so stale debounced previews don't overwrite the latest result. */
  const dynamicPreviewSeqRef = useRef(0);

  /**
   * Apply dynamic inputs read from a saved zone (or its draft snapshot) into the
   * three operator-facing fields, and seed `dynamicPreview` from the stored
   * server-resolved center+radius so the map shows the disk immediately instead
   * of flashing empty until the next preview round-trip lands.
   */
  const hydrateDynamicInputsFromConfig = useCallback(
    (config: Record<string, unknown>, geometry?: Record<string, unknown> | null) => {
      const parsed = readDynamicInputsFromConfig(config, geometry ?? null);
      setDynamicTargetUserCount(parsed.targetUserCount);
      setDynamicMinRadiusMeters(parsed.minRadiusMeters);
      setDynamicMaxRadiusMeters(parsed.maxRadiusMeters);
      if (parsed.resolvedCenter && parsed.resolvedRadiusMeters != null) {
        setDynamicPreview({
          infeasible: false,
          reason: null,
          center: {
            latitude: parsed.resolvedCenter[0],
            longitude: parsed.resolvedCenter[1],
          },
          resolved_radius_meters: parsed.resolvedRadiusMeters,
          tight_radius_meters: null,
          matched_user_count: parsed.matchedUserCount ?? parsed.targetUserCount,
          matched_owner_ids: [],
          population_size: 0,
          target_user_count: parsed.targetUserCount,
          min_radius_meters: parsed.minRadiusMeters,
          max_radius_meters: parsed.maxRadiusMeters,
        });
      } else {
        setDynamicPreview(null);
      }
      setDynamicPreviewError(null);
    },
    [],
  );
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

  /**
   * Monotonically incremented whenever we successfully publish the operator's
   * own location to `owners.latitude / longitude`. The dynamic-preview effect
   * watches this so the next cluster search reflects the freshly-published
   * coordinates without waiting for an input change.
   */
  const [dynamicLocationVersion, setDynamicLocationVersion] = useState(0);

  /**
   * When the operator enters dynamic-zone mode, push their browser geolocation
   * to the server once so `owners.latitude / longitude` is populated. Without
   * this, the resolver returns "no users found" for fresh accounts because the
   * web Dashboard had no other path to write the canonical owner location.
   * Failures (no geolocation API, denied permission, network) are swallowed —
   * the preview UI will surface its own infeasible message.
   */
  const dynamicSelfLocationPushedRef = useRef(false);
  useEffect(() => {
    if (zoneType !== "dynamic") {
      dynamicSelfLocationPushedRef.current = false;
      return;
    }
    if (dynamicSelfLocationPushedRef.current) return;
    if (!navigator.geolocation) return;
    dynamicSelfLocationPushedRef.current = true;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void updateMemberLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }).then((result) => {
          if (!result.error) {
            setDynamicLocationVersion((v) => v + 1);
          }
        });
      },
      () => {
        /* permission denied / geolocation failed — keep flag set to avoid prompt loops */
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, [zoneType]);

  /**
   * Live dynamic-zone preview. The server scans active members of the caller's
   * zone, picks the tightest cluster of `target_user_count` nearest users whose
   * smallest enclosing circle fits within `[min, max]`, and returns the
   * resolved center + radius. We debounce input changes (~300ms) and discard
   * stale responses via a monotonic sequence token. No client-supplied center.
   */
  useEffect(() => {
    if (zoneType !== "dynamic") {
      setDynamicPreview(null);
      setDynamicPreviewError(null);
      setDynamicPreviewLoading(false);
      return;
    }
    if (
      !Number.isFinite(dynamicMinRadiusMeters) ||
      !Number.isFinite(dynamicMaxRadiusMeters) ||
      dynamicMinRadiusMeters <= 0 ||
      dynamicMaxRadiusMeters < dynamicMinRadiusMeters
    ) {
      setDynamicPreview(null);
      setDynamicPreviewError(
        "Min radius must be > 0 and max radius must be >= min radius.",
      );
      setDynamicPreviewLoading(false);
      return;
    }
    if (
      !Number.isFinite(dynamicTargetUserCount) ||
      dynamicTargetUserCount < 1 ||
      dynamicTargetUserCount > 500
    ) {
      setDynamicPreview(null);
      setDynamicPreviewError("Enter a target user count between 1 and 500.");
      setDynamicPreviewLoading(false);
      return;
    }

    const seq = (dynamicPreviewSeqRef.current += 1);
    setDynamicPreviewLoading(true);
    setDynamicPreviewError(null);

    const timer = window.setTimeout(() => {
      previewDynamicZone({
        target_user_count: Math.trunc(dynamicTargetUserCount),
        min_radius_meters: dynamicMinRadiusMeters,
        max_radius_meters: dynamicMaxRadiusMeters,
      })
        .then((result) => {
          if (seq !== dynamicPreviewSeqRef.current) return;
          if (result.error || !result.data) {
            setDynamicPreview(null);
            setDynamicPreviewError(result.error ?? "Preview failed.");
          } else {
            setDynamicPreview(result.data);
            setDynamicPreviewError(null);
          }
        })
        .finally(() => {
          if (seq !== dynamicPreviewSeqRef.current) return;
          setDynamicPreviewLoading(false);
        });
    }, 300);

    return () => window.clearTimeout(timer);
  }, [
    zoneType,
    dynamicMinRadiusMeters,
    dynamicMaxRadiusMeters,
    dynamicTargetUserCount,
    dynamicLocationVersion,
  ]);

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
    const chosenConfig = zoneConfigMap(chosen.zone);
    if (normalizedType === "dynamic") {
      setDynamicTriggers(parseDynamicTriggersFromConfig(chosenConfig));
      const defaultRadius = chosenConfig.default_radius_meters;
      setDynamicDefaultRadiusMeters(
        typeof defaultRadius === "number" && Number.isFinite(defaultRadius)
          ? defaultRadius
          : null,
      );
      hydrateDynamicInputsFromConfig(
        chosenConfig,
        chosen.zone.geometry && typeof chosen.zone.geometry === "object"
          ? (chosen.zone.geometry as Record<string, unknown>)
          : null,
      );
    } else {
      setDynamicTriggers([]);
      setDynamicDefaultRadiusMeters(null);
      setDynamicPreview(null);
      setDynamicPreviewError(null);
    }
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
    if (zoneType === "proximity" || zoneType === "object") {
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
        if (zoneType === "proximity") {
          const point: [number, number] = [lat, lng];
          if (proximitySourceMode !== "map_pin") {
            setProximitySourceMode("map_pin");
          }
          setProximityCenter(point);
          setSaveStatus("Source pinned. Adjust radius to resize the zone.");
          return;
        }
        if (zoneType === "dynamic") {
          setSaveStatus(
            "Dynamic zones are placed by the server. Adjust target users / min / max to refresh the preview.",
          );
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
    const dynamicReady =
      dynamicMinRadiusMeters > 0 &&
      dynamicMaxRadiusMeters >= dynamicMinRadiusMeters &&
      dynamicTargetUserCount >= 1 &&
      dynamicPreview != null &&
      !dynamicPreview.infeasible &&
      dynamicPreview.center != null &&
      dynamicPreview.resolved_radius_meters != null;
    const canSaveByType =
      usesMapGeometry
        ? canSaveGeometry
        : zoneType === "proximity"
          ? proximityRadiusMeters > 0 && proximityCenter != null
          : zoneType === "dynamic"
            ? dynamicReady
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
              ? dynamicPreview?.infeasible
                ? dynamicPreview.reason ??
                  "Server could not find a cluster matching the current dynamic inputs."
                : "Enter target users + min/max radii and wait for the live preview to resolve."
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
      // Dynamic: server is authoritative for center+radius. We forward what the
      // live preview already returned so the freshly-saved zone hydrates with a
      // matching disk if the resolver is briefly unavailable; the server will
      // re-resolve on save and overwrite these values.
      const dynamicResolvedCenter =
        zoneType === "dynamic" && dynamicPreview?.center
          ? {
              latitude: dynamicPreview.center.latitude,
              longitude: dynamicPreview.center.longitude,
            }
          : null;
      const dynamicResolvedRadius =
        zoneType === "dynamic" &&
        dynamicPreview?.resolved_radius_meters != null
          ? dynamicPreview.resolved_radius_meters
          : null;
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
            ? dynamicResolvedCenter
              ? { center: dynamicResolvedCenter }
              : {}
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
              target_user_count: Math.trunc(dynamicTargetUserCount),
              min_radius_meters: dynamicMinRadiusMeters,
              max_radius_meters: dynamicMaxRadiusMeters,
              ...(dynamicResolvedRadius != null
                ? { resolved_radius_meters: dynamicResolvedRadius }
                : {}),
              ...(dynamicDefaultRadiusMeters != null &&
              dynamicDefaultRadiusMeters >= dynamicMinRadiusMeters &&
              dynamicDefaultRadiusMeters <= dynamicMaxRadiusMeters
                ? { default_radius_meters: dynamicDefaultRadiusMeters }
                : {}),
              ...(dynamicTriggers.length > 0
                ? {
                    triggers: dynamicTriggers.map(serializeDynamicTrigger),
                  }
                : {}),
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
    const config = zoneConfigMap(zone);
    if (normalizedType === "dynamic") {
      setDynamicTriggers(parseDynamicTriggersFromConfig(config));
      const defaultRadius = config.default_radius_meters;
      setDynamicDefaultRadiusMeters(
        typeof defaultRadius === "number" && Number.isFinite(defaultRadius)
          ? defaultRadius
          : null,
      );
      hydrateDynamicInputsFromConfig(
        config,
        zone.geometry && typeof zone.geometry === "object"
          ? (zone.geometry as Record<string, unknown>)
          : null,
      );
    } else {
      setDynamicTriggers([]);
      setDynamicDefaultRadiusMeters(null);
      setDynamicPreview(null);
      setDynamicPreviewError(null);
    }
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
    setDynamicTargetUserCount(5);
    setDynamicMinRadiusMeters(200);
    setDynamicMaxRadiusMeters(1000);
    setDynamicPreview(null);
    setDynamicPreviewError(null);
    setDynamicTriggers([]);
    setDynamicDefaultRadiusMeters(null);
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
    setDynamicPreview(null);
    setDynamicPreviewError(null);
    setDynamicTriggers([]);
    setDynamicDefaultRadiusMeters(null);
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
        // Active dynamic draft renders from the live preview circle further
        // down; this block only paints SAVED dynamic zones from their
        // persisted server-resolved center + radius.
        if (!active) {
          const cfg = zoneConfigMap(entry.zone);
          const center = extractZoneCenter(entry.zone);
          const resolved = Number(cfg.resolved_radius_meters);
          const fallback = Number(cfg.max_radius_meters);
          const radius = Number.isFinite(resolved) && resolved > 0
            ? resolved
            : Number.isFinite(fallback) && fallback > 0
              ? fallback
              : 0;
          if (center && radius > 0) {
            circles.push({
              key: `dyn-${entry.key}`,
              center,
              radiusMeters: radius,
              color: "#22C55E",
              fillOpacity: 0.12,
              dashArray: "6 6",
            });
          }
        }
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
    if (
      zoneType === "dynamic" &&
      dynamicPreview &&
      !dynamicPreview.infeasible &&
      dynamicPreview.center &&
      dynamicPreview.resolved_radius_meters != null
    ) {
      const center: [number, number] = [
        dynamicPreview.center.latitude,
        dynamicPreview.center.longitude,
      ];
      const resolved = dynamicPreview.resolved_radius_meters;
      circles.push({
        key: "draft-dynamic-resolved",
        center,
        radiusMeters: resolved,
        color: "#22C55E",
        fillOpacity: 0.16,
        dashArray: "6 6",
      });
      // Outer ring shows the operator's max bound so the user can see how much
      // slack remained against the upper limit; rendered fainter than the disk.
      if (dynamicMaxRadiusMeters > resolved) {
        circles.push({
          key: "draft-dynamic-max",
          center,
          radiusMeters: dynamicMaxRadiusMeters,
          color: "#16A34A",
          fillOpacity: 0.04,
          dashArray: "12 8",
        });
      }
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
    dynamicPreview,
    dynamicMaxRadiusMeters,
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

      if (zoneKind === "proximity") {
        const circles = parseCircleDraftsFromZone(
          zone,
          "proximity",
          circleDefaults,
        );
        for (const circle of circles) {
          parts.push(cornersFromCircle(circle.center, circle.radiusMeters));
        }
      }
      if (zoneKind === "dynamic") {
        const cfg = zoneConfigMap(zone);
        const center = extractZoneCenter(zone);
        const resolved = Number(cfg.resolved_radius_meters);
        const fallback = Number(cfg.max_radius_meters);
        const radius =
          Number.isFinite(resolved) && resolved > 0
            ? resolved
            : Number.isFinite(fallback) && fallback > 0
              ? fallback
              : 0;
        if (center && radius > 0) {
          parts.push(cornersFromCircle(center, radius));
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

      if (zoneKind === "dynamic") {
        const cfg = zoneConfigMap(zone);
        const center = extractZoneCenter(zone);
        const resolved = Number(cfg.resolved_radius_meters);
        const fallback = Number(cfg.max_radius_meters);
        const radius =
          Number.isFinite(resolved) && resolved > 0
            ? resolved
            : Number.isFinite(fallback) && fallback > 0
              ? fallback
              : 0;
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
    "mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8694AC]";

  return (
    <div className="w-full min-w-0 max-w-full overflow-x-clip rounded-lg border border-[#DCE6F2] bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DCE6F2] px-4 py-3 sm:px-6">
        <span className="text-xs font-bold uppercase tracking-[0.2em] text-[#0F2C5C]">
          H3 Hexagon Mapper
        </span>
        <div
          className={`flex items-center gap-2 rounded-full border border-[#DCE6F2] ${panel} px-3 py-1.5 font-mono text-xs text-[#2F80ED]`}
        >
          <span className="max-w-[140px] truncate sm:max-w-xs">{zoneId}</span>
          <button
            type="button"
            onClick={copyZoneId}
            className="rounded p-1 text-[#2F80ED] transition hover:bg-[#EDF3FB]"
            aria-label="Copy zone ID"
          >
            <Copy className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
        <span className="text-sm text-[#566784]">{userLabel}</span>
      </header>

      {user?.role === "administrator" && zoneId.trim() !== "" ? (
        <GuestRequestsDashboardSection zoneId={zoneId.trim()} />
      ) : null}

      {user?.role === "administrator" && zoneId.trim() !== "" ? (
        <div className="border-b border-[#DCE6F2] px-4 py-4 sm:px-6">
          <GuestAccessQrSection zoneId={zoneId.trim()} compact />
        </div>
      ) : null}

      <div className="flex min-h-[min(100dvh,920px)] flex-1 flex-col lg:min-h-[calc(100dvh-11rem)] lg:flex-row lg:min-w-0">
        <aside className="flex w-full min-w-0 flex-col border-[#DCE6F2] lg:w-[400px] lg:max-w-[400px] lg:shrink-0 lg:border-r">
          <div className="max-h-[50vh] flex-1 space-y-4 overflow-y-auto p-4 sm:p-5 lg:max-h-none">
            <div>
              <p className={labelClass}>Zone ID</p>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={zoneId}
                  className={`min-w-0 flex-1 rounded-md border border-[#DCE6F2] ${panel} px-3 py-2 font-mono text-xs text-[#2F80ED]`}
                />
                <button
                  type="button"
                  onClick={copyZoneId}
                  className={`rounded-md border border-[#DCE6F2] ${panel} px-2.5 text-[#2F80ED]`}
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
                className={`w-full rounded-md border border-[#DCE6F2] ${panel} px-3 py-2 text-sm text-[#0F2C5C] focus:border-[#2F80ED]/60 focus:outline-none focus:ring-1 focus:ring-[#2F80ED]/25`}
              />
              <p className="mt-1 text-[10px] text-[#8694AC]">
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
                className={`w-full rounded-md border border-[#DCE6F2] ${panel} px-3 py-2 text-sm text-[#0F2C5C] focus:border-[#2F80ED]/60 focus:outline-none focus:ring-1 focus:ring-[#2F80ED]/25`}
              >
                <option value="geofence">Geofence</option>
                <option value="grid">Grid zoning</option>
                <option value="proximity">Proximity-to-source</option>
                <option value="dynamic">Dynamic-size</option>
                <option value="communal_id">Communal ID</option>
                <option value="government_local_code">Government Local Code</option>
                <option value="object">Object zoning</option>
              </select>
              <p className="mt-1 text-[10px] text-[#8694AC]">
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
                          ? "border-[#2F80ED] bg-[#EDF3FB] text-[#2F80ED]"
                          : "border-[#DCE6F2] bg-[#F7FAFE] text-[#566784]"
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
                          ? "border-[#2F80ED] bg-[#EDF3FB] text-[#2F80ED]"
                          : "border-[#DCE6F2] bg-[#F7FAFE] text-[#566784]"
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
                    className="w-full rounded-md border border-[#E4ECF7] py-2 text-xs text-[#566784] hover:border-[#2F80ED]/50 disabled:opacity-60"
                  >
                    {proximityLocating
                      ? "Reading location…"
                      : "Use current location"}
                  </button>
                ) : (
                  <p className="text-[10px] text-[#8694AC]">
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
                    className="mt-1 w-full accent-[#2F80ED]"
                  />
                  <input
                    id="zone-proximity-radius"
                    type="number"
                    min={1}
                    value={proximityRadiusMeters}
                    onChange={(e) =>
                      setProximityRadiusMeters(Number(e.target.value) || 0)
                    }
                    className="mt-2 w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm text-[#0F2C5C]"
                  />
                </div>
              </div>
            )}

            {zoneType === "dynamic" && (
              <div className="space-y-3">
                <p className="text-[10px] text-[#8694AC]">
                  Enter the number of nearest users and the radius bounds. The
                  server finds the tightest cluster of that many users in this
                  zone and picks the circle's center.
                </p>
                <div>
                  <label
                    className={labelClass}
                    htmlFor="zone-dynamic-target-users"
                  >
                    Number of nearest users
                  </label>
                  <input
                    id="zone-dynamic-target-users"
                    type="number"
                    min={1}
                    max={500}
                    value={dynamicTargetUserCount}
                    onChange={(e) =>
                      setDynamicTargetUserCount(
                        Math.max(
                          1,
                          Math.min(500, Math.trunc(Number(e.target.value) || 0)),
                        ),
                      )
                    }
                    className="w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm text-[#0F2C5C]"
                  />
                </div>
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
                      className="w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm text-[#0F2C5C]"
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
                      className="w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm text-[#0F2C5C]"
                    />
                  </div>
                </div>

                <div
                  className={`rounded-md border p-2 text-[11px] ${
                    dynamicPreviewError || dynamicPreview?.infeasible
                      ? "border-rose-200 bg-rose-50 text-rose-600"
                      : dynamicPreview && !dynamicPreview.infeasible
                        ? "border-[#22C55E]/40 bg-[#22C55E]/10 text-[#15803D]"
                        : "border-[#DCE6F2] bg-[#F7FAFE] text-[#8694AC]"
                  }`}
                >
                  {dynamicPreviewLoading ? (
                    <span>Resolving cluster…</span>
                  ) : dynamicPreviewError ? (
                    <span>{dynamicPreviewError}</span>
                  ) : dynamicPreview?.infeasible ? (
                    <span>
                      {dynamicPreview.reason ??
                        "Could not find a cluster that matches the current inputs."}
                    </span>
                  ) : dynamicPreview &&
                    dynamicPreview.center &&
                    dynamicPreview.resolved_radius_meters != null ? (
                    <>
                      <div>
                        Cluster found: {dynamicPreview.matched_user_count} users
                        inside a {Math.round(dynamicPreview.resolved_radius_meters)} m
                        circle
                        {dynamicPreview.tight_radius_meters != null &&
                        dynamicPreview.tight_radius_meters <
                          dynamicPreview.resolved_radius_meters
                          ? ` (cluster spans ${Math.round(dynamicPreview.tight_radius_meters)} m, padded to min)`
                          : ""}
                        .
                      </div>
                      <div className="mt-0.5 text-[#8694AC]">
                        Center {dynamicPreview.center.latitude.toFixed(5)},{" "}
                        {dynamicPreview.center.longitude.toFixed(5)} · Pool{" "}
                        {dynamicPreview.population_size} users
                      </div>
                    </>
                  ) : (
                    <span>
                      Adjust the inputs above to ask the server for a cluster.
                    </span>
                  )}
                </div>

                {/* <div>
                  <label
                    className={labelClass}
                    htmlFor="zone-dynamic-default"
                  >
                    Default radius (m){" "}
                    <span className="text-[#8694AC]">(used when no trigger fires)</span>
                  </label>
                  <input
                    id="zone-dynamic-default"
                    type="number"
                    min={0}
                    value={dynamicDefaultRadiusMeters ?? ""}
                    placeholder={String(dynamicMinRadiusMeters)}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDynamicDefaultRadiusMeters(
                        v === "" ? null : Number(v) || 0,
                      );
                    }}
                    className="w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm text-[#0F2C5C]"
                  />
                </div>

                <div className="rounded-md border border-[#DCE6F2] bg-[#F7FAFE] p-2">
                  <div className="mb-2 flex items-center justify-between">
                    <p className={labelClass}>Resize rules</p>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setDynamicTriggers((prev) => [
                            ...prev,
                            defaultDynamicTriggerForType("member_count"),
                          ])
                        }
                        className="rounded-md border border-[#22C55E]/40 bg-[#22C55E]/10 px-2 py-1 text-[10px] font-medium text-[#15803D] hover:bg-[#22C55E]/20"
                      >
                        + Members
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDynamicTriggers((prev) => [
                            ...prev,
                            defaultDynamicTriggerForType("time_of_day"),
                          ])
                        }
                        className="rounded-md border border-[#06B6D4]/40 bg-[#06B6D4]/10 px-2 py-1 text-[10px] font-medium text-[#0E7490] hover:bg-[#06B6D4]/20"
                      >
                        + Time
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDynamicTriggers((prev) => [
                            ...prev,
                            defaultDynamicTriggerForType("sensor"),
                          ])
                        }
                        className="rounded-md border border-[#F59E0B]/40 bg-[#F59E0B]/10 px-2 py-1 text-[10px] font-medium text-[#B45309] hover:bg-[#F59E0B]/20"
                      >
                        + Sensor
                      </button>
                    </div>
                  </div>

                  {dynamicTriggers.length === 0 ? (
                    <p className="text-[10px] text-[#8694AC]">
                      No rules — zone stays an annulus between min and max. Add a rule to enable live resize.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {dynamicTriggers.map((trigger, idx) => (
                        <div
                          key={trigger.id}
                          className="rounded-md border border-[#DCE6F2] bg-[#F7FAFE] p-2 text-[11px]"
                        >
                          <div className="mb-1 flex items-center justify-between">
                            <span className="text-[#566784]">
                              {idx + 1}.{" "}
                              {trigger.type === "member_count"
                                ? "Members nearby"
                                : trigger.type === "time_of_day"
                                  ? "Time of day"
                                  : "Sensor activity"}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setDynamicTriggers((prev) =>
                                  prev.filter((t) => t.id !== trigger.id),
                                )
                              }
                              className="text-rose-600 hover:text-rose-700"
                              aria-label="Remove rule"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          {trigger.type === "member_count" && (
                            <div className="grid grid-cols-3 gap-1.5">
                              <select
                                value={trigger.operator}
                                onChange={(e) =>
                                  setDynamicTriggers((prev) =>
                                    prev.map((t) =>
                                      t.id === trigger.id && t.type === "member_count"
                                        ? {
                                            ...t,
                                            operator: e.target
                                              .value as DynamicTriggerOperator,
                                          }
                                        : t,
                                    ),
                                  )
                                }
                                className="rounded border border-[#DCE6F2] bg-[#F7FAFE] px-1.5 py-1 text-[11px] text-[#0F2C5C]"
                              >
                                {DYNAMIC_TRIGGER_OPERATORS.map((op) => (
                                  <option key={op} value={op}>
                                    {op}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="number"
                                min={0}
                                value={trigger.value}
                                onChange={(e) =>
                                  setDynamicTriggers((prev) =>
                                    prev.map((t) =>
                                      t.id === trigger.id && t.type === "member_count"
                                        ? { ...t, value: Number(e.target.value) || 0 }
                                        : t,
                                    ),
                                  )
                                }
                                placeholder="count"
                                className="rounded border border-[#DCE6F2] bg-[#F7FAFE] px-1.5 py-1 text-[11px] text-[#0F2C5C]"
                              />
                              <input
                                type="number"
                                min={1}
                                value={trigger.lookback_seconds}
                                onChange={(e) =>
                                  setDynamicTriggers((prev) =>
                                    prev.map((t) =>
                                      t.id === trigger.id && t.type === "member_count"
                                        ? {
                                            ...t,
                                            lookback_seconds:
                                              Number(e.target.value) || 60,
                                          }
                                        : t,
                                    ),
                                  )
                                }
                                placeholder="window s"
                                className="rounded border border-[#DCE6F2] bg-[#F7FAFE] px-1.5 py-1 text-[11px] text-[#0F2C5C]"
                              />
                            </div>
                          )}

                          {trigger.type === "time_of_day" && (
                            <div className="grid grid-cols-2 gap-1.5">
                              <input
                                type="time"
                                value={trigger.start}
                                onChange={(e) =>
                                  setDynamicTriggers((prev) =>
                                    prev.map((t) =>
                                      t.id === trigger.id && t.type === "time_of_day"
                                        ? { ...t, start: e.target.value }
                                        : t,
                                    ),
                                  )
                                }
                                className="rounded border border-[#DCE6F2] bg-[#F7FAFE] px-1.5 py-1 text-[11px] text-[#0F2C5C]"
                              />
                              <input
                                type="time"
                                value={trigger.end}
                                onChange={(e) =>
                                  setDynamicTriggers((prev) =>
                                    prev.map((t) =>
                                      t.id === trigger.id && t.type === "time_of_day"
                                        ? { ...t, end: e.target.value }
                                        : t,
                                    ),
                                  )
                                }
                                className="rounded border border-[#DCE6F2] bg-[#F7FAFE] px-1.5 py-1 text-[11px] text-[#0F2C5C]"
                              />
                            </div>
                          )}

                          {trigger.type === "sensor" && (
                            <div className="grid grid-cols-3 gap-1.5">
                              <input
                                type="text"
                                value={trigger.message_types.join(",")}
                                onChange={(e) =>
                                  setDynamicTriggers((prev) =>
                                    prev.map((t) =>
                                      t.id === trigger.id && t.type === "sensor"
                                        ? {
                                            ...t,
                                            message_types: e.target.value
                                              .split(",")
                                              .map((s) => s.trim().toUpperCase())
                                              .filter(Boolean),
                                          }
                                        : t,
                                    ),
                                  )
                                }
                                placeholder="SENSOR,PANIC"
                                className="rounded border border-[#DCE6F2] bg-[#F7FAFE] px-1.5 py-1 text-[11px] text-[#0F2C5C]"
                              />
                              <input
                                type="number"
                                min={1}
                                value={trigger.min_count}
                                onChange={(e) =>
                                  setDynamicTriggers((prev) =>
                                    prev.map((t) =>
                                      t.id === trigger.id && t.type === "sensor"
                                        ? {
                                            ...t,
                                            min_count: Number(e.target.value) || 1,
                                          }
                                        : t,
                                    ),
                                  )
                                }
                                placeholder="min count"
                                className="rounded border border-[#DCE6F2] bg-[#F7FAFE] px-1.5 py-1 text-[11px] text-[#0F2C5C]"
                              />
                              <input
                                type="number"
                                min={1}
                                value={trigger.lookback_seconds}
                                onChange={(e) =>
                                  setDynamicTriggers((prev) =>
                                    prev.map((t) =>
                                      t.id === trigger.id && t.type === "sensor"
                                        ? {
                                            ...t,
                                            lookback_seconds:
                                              Number(e.target.value) || 60,
                                          }
                                        : t,
                                    ),
                                  )
                                }
                                placeholder="window s"
                                className="rounded border border-[#DCE6F2] bg-[#F7FAFE] px-1.5 py-1 text-[11px] text-[#0F2C5C]"
                              />
                            </div>
                          )}

                          <div className="mt-1.5 flex items-center gap-1.5">
                            <span className="text-[10px] text-[#8694AC]">→ resize to</span>
                            <select
                              value={
                                trigger.resize_to === "min" || trigger.resize_to === "max"
                                  ? trigger.resize_to
                                  : "custom"
                              }
                              onChange={(e) => {
                                const v = e.target.value;
                                setDynamicTriggers((prev) =>
                                  prev.map((t) =>
                                    t.id === trigger.id
                                      ? {
                                          ...t,
                                          resize_to:
                                            v === "min" || v === "max"
                                              ? v
                                              : typeof t.resize_to === "number"
                                                ? t.resize_to
                                                : dynamicMaxRadiusMeters,
                                        }
                                      : t,
                                  ),
                                );
                              }}
                              className="rounded border border-[#DCE6F2] bg-[#F7FAFE] px-1.5 py-1 text-[11px] text-[#0F2C5C]"
                            >
                              <option value="min">min</option>
                              <option value="max">max</option>
                              <option value="custom">custom (m)</option>
                            </select>
                            {trigger.resize_to !== "min" &&
                              trigger.resize_to !== "max" && (
                                <input
                                  type="number"
                                  min={0}
                                  value={Number(trigger.resize_to) || 0}
                                  onChange={(e) =>
                                    setDynamicTriggers((prev) =>
                                      prev.map((t) =>
                                        t.id === trigger.id
                                          ? {
                                              ...t,
                                              resize_to:
                                                Number(e.target.value) || 0,
                                            }
                                          : t,
                                      ),
                                    )
                                  }
                                  className="w-20 rounded border border-[#DCE6F2] bg-[#F7FAFE] px-1.5 py-1 text-[11px] text-[#0F2C5C]"
                                />
                              )}
                          </div>
                        </div>
                      ))}
                      <p className="text-[10px] text-[#8694AC]">
                        Rules evaluate top-down on the server. First match sets the live radius.
                      </p>
                    </div>
                  )}
                </div> */}
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
                  className="w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm text-[#0F2C5C] uppercase"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void validateCommunalId()}
                    disabled={communalValidating || !canValidateReferenceZone}
                    className="rounded-md border border-[#8B5CF6]/50 bg-[#8B5CF6]/15 px-3 py-1.5 text-xs font-medium text-[#6D28D9] hover:bg-[#8B5CF6]/25 disabled:opacity-50"
                  >
                    {communalValidating ? "Validating…" : "Validate ID"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void generateCommunalId()}
                    disabled={communalValidating || !canValidateReferenceZone}
                    className="rounded-md border border-[#E4ECF7] bg-[#EDF3FB] px-3 py-1.5 text-xs font-medium text-[#566784] hover:bg-[#E4ECF7] disabled:opacity-50"
                  >
                    Generate ID
                  </button>
                </div>
                {communalValidation?.valid === true && communalValidated ? (
                  <p className="text-[10px] text-[#6D28D9]">
                    {communalValidation.displayName
                      ? `${communalValidation.displayName} (${communalValidation.referenceId})`
                      : communalValidation.referenceId}{" "}
                    — map preview ready
                    {communalValidation.source
                      ? ` · ${communalValidation.source}`
                      : ""}
                  </p>
                ) : communalValidation?.valid === false ? (
                  <p className="text-[10px] text-rose-600">
                    {communalValidation.message}
                  </p>
                ) : (
                  <p className="text-[10px] text-[#8694AC]">
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
                          ? "border-[#0EA5E9]/60 bg-[#0EA5E9]/20 text-[#0369A1]"
                          : "border-[#DCE6F2] text-[#8694AC] hover:border-[#E4ECF7]"
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
                          ? "border-[#0EA5E9]/60 bg-[#0EA5E9]/20 text-[#0369A1]"
                          : "border-[#DCE6F2] text-[#8694AC] hover:border-[#E4ECF7]"
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
                        placeholder="Queen Street West"
                        className="mt-1 w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm text-[#0F2C5C]"
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
                        placeholder="100"
                        className="mt-1 w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm text-[#0F2C5C]"
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
                      className="mt-1 w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm text-[#0F2C5C]"
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
                      className="mt-1 w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm text-[#0F2C5C]"
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
                    className="mt-1 w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm text-[#0F2C5C]"
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void validateGovernmentAddress()}
                    disabled={governmentValidating || !canValidateReferenceZone}
                    className="rounded-md border border-[#0EA5E9]/50 bg-[#0EA5E9]/15 px-3 py-1.5 text-xs font-medium text-[#0369A1] hover:bg-[#0EA5E9]/25 disabled:opacity-50"
                  >
                    {governmentValidating ? "Validating…" : "Validate address"}
                  </button>
                </div>
                {!canValidateReferenceZone ? (
                  <p className="text-[10px] text-[#E0992A]">
                    Click <span className="font-medium">+ New zone</span> or select
                    an editable zone tab to validate an address.
                  </p>
                ) : null}
                {governmentValidation?.valid === true && governmentValidated ? (
                  <p className="text-[10px] text-[#0369A1]">
                    {governmentValidation.displayName
                      ? `${governmentValidation.displayName} (${governmentValidation.referenceId})`
                      : governmentValidation.referenceId}{" "}
                    — area polygon on map
                    {governmentValidation.source
                      ? ` · ${governmentValidation.source}`
                      : ""}
                  </p>
                ) : governmentValidation?.valid === false ? (
                  <p className="text-[10px] text-rose-600">
                    {governmentValidation.message}
                  </p>
                ) : (
                  <p className="text-[10px] text-[#8694AC]">
                    {governmentAddressMode === "street"
                      ? "Example: Queen Street West 100, M5H 2N2, Toronto, Canada — any country via OpenStreetMap."
                      : "Example: 00510, Helsinki, Finland — any country name or ISO code (FI)."}
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
                  inputClassName="w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm text-[#0F2C5C] placeholder:text-[#8694AC] focus:border-[#2F80ED]/60 focus:outline-none focus:ring-1 focus:ring-[#2F80ED]/25"
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
                    className="w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm text-[#0F2C5C]"
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
                    className="w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm text-[#0F2C5C]"
                  />
                </div>
                <p className="text-[10px] text-[#8694AC]">
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
                        ? "border-[#2F80ED] bg-[#EDF3FB] text-[#2F80ED]"
                        : "border-[#DCE6F2] bg-[#F7FAFE] text-[#8694AC]"
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
                        ? "border-[#2F80ED] bg-[#EDF3FB] text-[#2F80ED]"
                        : "border-[#DCE6F2] bg-[#F7FAFE] text-[#8694AC]"
                    }`}
                  >
                    Polygon
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-[10px] text-[#8694AC]">
                Map drawing tools are hidden for this zone type.
              </p>
            )}

            {usesMapGeometry && mapperMode === "h3" && (
              <div className="space-y-3 rounded-md border border-[#DCE6F2] bg-[#F7FAFE]/50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8694AC]">
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
                      className="w-full accent-[#2F80ED]"
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
                      className="w-14 rounded border border-[#E4ECF7] bg-white px-2 py-1 text-center text-xs text-[#0F2C5C]"
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
                    className="w-full accent-[#2F80ED]"
                  />
                </div>
                <button
                  type="button"
                  onClick={clearH3}
                  className="w-full rounded-md border border-[#E23B4E]/30 py-2 text-xs font-medium text-[#E23B4E] transition hover:bg-[#FCE7EA]"
                >
                  Clear All H3
                </button>
              </div>
            )}

            {usesMapGeometry && mapperMode === "polygon" && (
              <div className="space-y-3 rounded-md border border-[#DCE6F2] bg-[#F7FAFE]/50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8694AC]">
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
                        ? "border-[#2F80ED] bg-[#EDF3FB] text-[#2F80ED]"
                        : "border-[#DCE6F2] text-[#8694AC]"
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
                        ? "border-[#2F80ED] bg-[#EDF3FB] text-[#2F80ED]"
                        : "border-[#DCE6F2] text-[#8694AC]"
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
                      ? "bg-[#FBEFD8] text-[#E0992A] ring-1 ring-[#E0992A]/50"
                      : "bg-[#2F80ED] text-white hover:brightness-110"
                  }`}
                >
                  {drawingActive ? "Stop drawing" : "Start drawing"}
                </button>
                {selectedPolygonId && !drawingActive && (
                  <button
                    type="button"
                    onClick={deleteSelectedPolygon}
                    className="w-full rounded-md border border-[#E23B4E]/30 py-2 text-xs font-medium text-[#E23B4E] transition hover:bg-[#FCE7EA]"
                  >
                    Delete selected polygon
                  </button>
                )}
                <p className="text-[10px] text-[#8694AC]">
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
                    className="w-full accent-[#2F80ED]"
                  />
                </div>
                <button
                  type="button"
                  onClick={clearPolygons}
                  className="w-full rounded-md border border-[#E23B4E]/30 py-2 text-xs font-medium text-[#E23B4E] transition hover:bg-[#FCE7EA]"
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
                    className="w-full rounded-md border border-[#E4ECF7] bg-white px-2 py-1.5 font-mono text-[11px] text-[#566784]"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleImportWktKml}
                    className="flex-1 rounded-md border border-[#E4ECF7] py-2 text-xs text-[#566784] hover:border-[#2F80ED]/50"
                  >
                    Import
                  </button>
                  <button
                    type="button"
                    onClick={handleExportWkt}
                    className="flex-1 rounded-md border border-[#E4ECF7] py-2 text-xs text-[#566784] hover:border-[#2F80ED]/50"
                  >
                    Export WKT
                  </button>
                  <button
                    type="button"
                    onClick={handleExportKml}
                    className="flex-1 rounded-md border border-[#E4ECF7] py-2 text-xs text-[#566784] hover:border-[#2F80ED]/50"
                  >
                    Export KML
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2 rounded-md border border-[#DCE6F2] bg-[#F7FAFE]/50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8694AC]">
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
                    ? "border-[#2F80ED] bg-[#EDF3FB] text-[#2F80ED]"
                    : "border-[#E4ECF7] text-[#566784]"
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
                    className="h-8 w-full cursor-pointer rounded border border-[#E4ECF7]"
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
                    className="w-full rounded-md border border-[#E4ECF7] py-1.5 text-xs text-[#8694AC]"
                  >
                    Stop measuring
                  </button>
                </div>
              )}
              <label className="flex cursor-pointer items-center justify-between gap-2 text-sm text-[#566784]">
                <span>Show all zones on map</span>
                <input
                  type="checkbox"
                  checked={showAllZones}
                  onChange={(e) => setShowAllZones(e.target.checked)}
                  className="accent-[#2F80ED]"
                />
              </label>
              <label className="flex cursor-pointer items-center justify-between gap-2 text-sm text-[#566784]">
                <span>Grayscale map</span>
                <input
                  type="checkbox"
                  checked={grayscaleMap}
                  onChange={(e) => setGrayscaleMap(e.target.checked)}
                  className="accent-[#2F80ED]"
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
                inputClassName={`w-full rounded-md border border-[#DCE6F2] ${panel} px-3 py-2 text-sm text-[#0F2C5C] placeholder:text-[#8694AC] focus:border-[#2F80ED]/60 focus:outline-none focus:ring-1 focus:ring-[#2F80ED]/25`}
                className="relative z-10"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleExportWorkspaceJson}
                  className="flex flex-1 items-center justify-center gap-1 rounded-md bg-[#2F80ED] px-3 py-2 text-xs font-bold text-white"
                >
                  <Download className="h-3.5 w-3.5" />
                  Save JSON
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-1 items-center justify-center gap-1 rounded-md border border-[#E4ECF7] px-3 py-2 text-xs text-[#566784]"
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
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8694AC]">
                    Zones ({zones.length})
                  </p>
                  <div className="flex items-center gap-2">
                    {loadingZones && (
                      <span className="text-[10px] text-[#8694AC]">Loading…</span>
                    )}
                    {isCreatingNewZone && (
                      <button
                        type="button"
                        onClick={cancelNewZoneDraft}
                        className="rounded border border-[#E23B4E]/30 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-[#E23B4E] transition hover:bg-[#FCE7EA]"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
                <div className="rounded-md border border-[#DCE6F2] bg-white p-2">
                  {zonesError ? (
                    <p className="text-xs text-[#E23B4E]">{zonesError}</p>
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
                                  ? "border-[#2F80ED] bg-[#EDF3FB] text-[#0F2C5C]"
                                  : "border-[#DCE6F2] text-[#566784] hover:border-[#2F80ED]/60"
                              }`}
                            >
                              <span>{zone.name || `Zone ${savedZoneId(zone)}`}</span>
                              {!entry.editable && (
                                <span className="ml-2 text-[10px] uppercase text-[#8694AC]">
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
                              ? "border-[#2F80ED] bg-[#EDF3FB] text-[#2F80ED]"
                              : !canCreateZone
                                ? "cursor-not-allowed border-[#DCE6F2] text-[#8694AC]"
                                : "border-[#DCE6F2] text-[#566784] hover:border-[#2F80ED]/60"
                          }`}
                        >
                          + New zone
                        </button>
                      </div>
                      {zones.length === 0 && !isCreatingNewZone && (
                        <p className="mt-2 text-xs text-[#8694AC]">
                          {canCreateZone
                            ? "No saved zones yet. Use + New zone to create your first zone."
                            : createBlockedReason || "No editable zones are currently available."}
                        </p>
                      )}
                      {!canCreateZone && (
                        <p className="mt-2 text-xs text-[#E0992A]">
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
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8694AC]">
                      Selected H3 cells ({selectedCells.length})
                    </p>
                  </div>
                  <div className="max-h-36 overflow-y-auto rounded-md border border-[#DCE6F2] bg-white p-2">
                    {selectedCells.length === 0 ? (
                      <p className="text-xs text-[#8694AC]">
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
                              className="w-full rounded px-2 py-1.5 text-left font-mono text-[10px] leading-snug text-[#2F80ED] transition hover:bg-[#EDF3FB] hover:text-[#0F2C5C]"
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
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8694AC]">
                    All working H3 cells ({allWorkingCells.length})
                  </p>
                </div>
                <div className="max-h-36 overflow-y-auto rounded-md border border-[#DCE6F2] bg-white p-2">
                  {allWorkingCells.length === 0 ? (
                    <p className="text-xs text-[#8694AC]">
                      No working cells. Add cells or load saved zones.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {allWorkingCells.map((id) => (
                        <li key={`all-${id}`}>
                          <button
                            type="button"
                            onClick={() => focusH3Cell(id)}
                            className="w-full rounded px-2 py-1.5 text-left font-mono text-[10px] leading-snug text-[#2F80ED] transition hover:bg-[#EDF3FB] hover:text-[#0F2C5C]"
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
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8694AC]">
                    Polygons ({allWorkingPolygons.length})
                    {allWorkingPolygons.length > 0 ? (
                      <span className="ml-1 font-normal normal-case tracking-normal text-[#8694AC]">
                        · {totalPolyAreaKm2.toFixed(3)} km² total
                      </span>
                    ) : null}
                  </p>
                </div>
                <div className="max-h-36 overflow-y-auto rounded-md border border-[#DCE6F2] bg-white p-2">
                  {allWorkingPolygons.length === 0 ? (
                    <p className="text-xs text-[#8694AC]">
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
                            className={`w-full rounded px-2 py-1.5 text-left text-[10px] leading-snug transition hover:bg-[#EDF3FB] hover:text-[#0F2C5C] ${
                              selectedPolygonId === p.id
                                ? "bg-[#EDF3FB] text-[#0F2C5C]"
                                : "text-[#2F80ED]"
                            }`}
                          >
                            <div className="flex items-baseline gap-2 font-mono">
                              <span className="shrink-0 text-[#8694AC]">
                                #{i + 1}
                              </span>
                              <span className="min-w-0 break-all">{p.id}</span>
                            </div>
                            <div className="mt-0.5 font-mono text-[9px] text-[#8694AC]">
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

          <div className="border-t border-[#DCE6F2] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  clearH3();
                  clearPolygons();
                  setSaveStatus("");
                }}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-md border border-[#E4ECF7] bg-transparent px-3 py-2.5 text-sm text-[#566784] sm:flex-none"
              >
                <Trash2 className="h-4 w-4" strokeWidth={2} />
                Clear all
              </button>
              <button
                type="button"
                onClick={handleExportCsv}
                className="rounded-md border border-[#DCE6F2] bg-[#F7FAFE] p-2.5 text-[#566784]"
                aria-label="Export CSV"
              >
                <Download className="h-4 w-4" strokeWidth={2} />
              </button>
                <button
                type="button"
                onClick={handleSave}
                className="ml-auto min-w-[120px] flex-1 rounded-md bg-[#2F80ED] px-4 py-2.5 text-sm font-bold text-white sm:flex-none"
              >
                {isCreatingNewZone ? "Create zone" : "Save zone"}
              </button>
            </div>
            {saveStatus ? (
              <p className="mt-2 text-center text-xs text-[#8694AC]">
                {saveStatus}
              </p>
            ) : null}
          </div>
        </aside>

        <div className="relative h-[65dvh] min-h-[360px] min-w-0 shrink-0 lg:h-auto lg:min-h-0 lg:shrink lg:flex-1">
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
            <div className="pointer-events-none absolute left-1/2 top-4 z-[500] -translate-x-1/2 rounded-md border border-[#E0992A]/40 bg-white/95 px-4 py-2 text-center text-xs text-[#8A5A12] shadow-lg backdrop-blur">
              {geofenceDrawTool === "circle"
                ? "Circle: click center, move for radius, click again to finish"
                : "Polygon: tap vertices, tap first point to close · "}
              {geofenceDrawTool === "polygon" && (
                <>
                  <kbd className="rounded bg-[#EDF3FB] px-1">Esc</kbd> undo ·{" "}
                  {holeParentId ? "Hole ring" : "Outer ring"}
                </>
              )}
            </div>
          )}

          {activeTool === "measure" && (
            <div className="pointer-events-none absolute left-1/2 top-4 z-[500] -translate-x-1/2 rounded-md border border-[#2F80ED]/45 bg-white/95 px-4 py-2 text-xs text-[#2F80ED] shadow-lg">
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
              className="fixed z-[2000] min-w-[180px] rounded-md border border-[#E4ECF7] bg-white py-1 text-sm shadow-xl"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-[#566784] hover:bg-[#EDF3FB]"
                onClick={() => setContextPanel("h3info")}
              >
                H3 Info Here
              </button>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-[#566784] hover:bg-[#EDF3FB]"
                onClick={() => setContextPanel("customer")}
              >
                Customer Info Here
              </button>
            </div>
          )}

          {contextMenu && contextPanel === "h3info" && (
            <div
              data-context-menu-root
              className="fixed z-[2001] max-h-64 max-w-sm overflow-auto rounded-md border border-[#E4ECF7] bg-white p-3 text-xs shadow-xl"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <p className="mb-2 font-semibold text-[#2F80ED]">
                H3 at click (res 0–15)
              </p>
              <ul className="space-y-1 font-mono text-[10px] text-[#566784]">
                {h3CellsAtPoint(contextMenu.lat, contextMenu.lng).map((row) => (
                  <li key={row.res}>
                    r{row.res}:{" "}
                    <span className="break-all text-[#2F80ED]">{row.id}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="mt-2 text-[10px] text-[#8694AC] underline"
                onClick={() => setContextMenu(null)}
              >
                Close
              </button>
            </div>
          )}

          {contextMenu && contextPanel === "customer" && (
            <div
              data-context-menu-root
              className="fixed z-[2001] max-w-xs rounded-md border border-[#E4ECF7] bg-white p-3 text-xs shadow-xl"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <p className="font-semibold text-[#0F2C5C]">Coverage summary</p>
              <p className="mt-2 text-[#8694AC]">
                Selected H3 cells covering point:{" "}
                <span className="text-[#2F80ED]">{customerSummary.h3Hits}</span>
              </p>
              <p className="text-[#8694AC]">
                Polygons covering point:{" "}
                <span className="text-[#2F80ED]">
                  {customerSummary.polyHits}
                </span>
              </p>
              <button
                type="button"
                className="mt-2 text-[10px] text-[#8694AC] underline"
                onClick={() => setContextMenu(null)}
              >
                Close
              </button>
            </div>
          )}

          <div className="pointer-events-none absolute bottom-3 left-3 z-[400] rounded-md border border-[#DCE6F2] bg-white/90 px-2 py-1 font-mono text-[10px] text-[#8694AC]">
            {cursor ? (
              <>
                {cursor.lat.toFixed(6)}, {cursor.lng.toFixed(6)}
              </>
            ) : (
              "Move cursor…"
            )}
          </div>

          <div className="pointer-events-none absolute right-3 top-14 z-[400] flex flex-col gap-2">
            <span className="inline-flex items-center gap-2 rounded-md border border-[#2F80ED]/45 bg-white/95 px-3 py-1.5 text-xs font-medium text-[#2F80ED] shadow-lg backdrop-blur-sm">
              <MapPin className="h-3.5 w-3.5" strokeWidth={2} />
              {modeBadge}
            </span>
          </div>

          <p className="pointer-events-none absolute bottom-2 right-3 z-[400] text-[10px] text-[#8694AC]">
            Leaflet · © OSM / Esri / CARTO
          </p>
        </div>
      </div>
    </div>
  );
}
