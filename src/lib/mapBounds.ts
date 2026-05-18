import L from "leaflet";
import { h3ToPolygon } from "./h3";
import type { GeoPolygonShape } from "./geoPoly";

/** Serializable corners for react state → Leaflet fitBounds */
export type FitBoundsCorners = {
  southWest: [number, number];
  northEast: [number, number];
};

export function cornersFromH3Cell(cellId: string): FitBoundsCorners | null {
  try {
    const ring = h3ToPolygon(cellId);
    const latlngs = ring.map(([lng, lat]) => L.latLng(lat, lng));
    const b = L.latLngBounds(latlngs);
    const sw = b.getSouthWest();
    const ne = b.getNorthEast();
    return {
      southWest: [sw.lat, sw.lng],
      northEast: [ne.lat, ne.lng],
    };
  } catch {
    return null;
  }
}

export function cornersFromPolygonShape(p: GeoPolygonShape): FitBoundsCorners | null {
  const ring = p.outer;
  if (ring.length < 2) return null;
  const latlngs = ring.map(([lat, lng]) => L.latLng(lat, lng));
  const b = L.latLngBounds(latlngs);
  const sw = b.getSouthWest();
  const ne = b.getNorthEast();
  return {
    southWest: [sw.lat, sw.lng],
    northEast: [ne.lat, ne.lng],
  };
}

/** Bounding box covering every polygon in a geofence zone. */
export function cornersFromPolygonShapes(
  polygons: GeoPolygonShape[],
): FitBoundsCorners | null {
  const latlngs: L.LatLng[] = [];
  for (const poly of polygons) {
    for (const [lat, lng] of poly.outer) {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      latlngs.push(L.latLng(lat, lng));
    }
  }
  if (latlngs.length < 2) return null;
  const b = L.latLngBounds(latlngs);
  if (!b.isValid()) return null;
  const sw = b.getSouthWest();
  const ne = b.getNorthEast();
  return {
    southWest: [sw.lat, sw.lng],
    northEast: [ne.lat, ne.lng],
  };
}

/** Bounding box for a circle zone (object / proximity preview). */
/** Union of multiple fit-bounds boxes (e.g. all saved zones on first load). */
export function mergeFitBoundsCorners(
  parts: Array<FitBoundsCorners | null | undefined>,
): FitBoundsCorners | null {
  let swLat = Infinity;
  let swLng = Infinity;
  let neLat = -Infinity;
  let neLng = -Infinity;
  let any = false;

  for (const c of parts) {
    if (!c) continue;
    any = true;
    swLat = Math.min(swLat, c.southWest[0]);
    swLng = Math.min(swLng, c.southWest[1]);
    neLat = Math.max(neLat, c.northEast[0]);
    neLng = Math.max(neLng, c.northEast[1]);
  }

  if (!any) return null;
  return {
    southWest: [swLat, swLng],
    northEast: [neLat, neLng],
  };
}

export function cornersFromCircle(
  center: [number, number],
  radiusMeters: number,
): FitBoundsCorners | null {
  const [lat, lng] = center;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) return null;
  const dLat = radiusMeters / 111_320;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const dLng = radiusMeters / (111_320 * Math.max(0.2, Math.abs(cosLat)));
  return {
    southWest: [lat - dLat, lng - dLng],
    northEast: [lat + dLat, lng + dLng],
  };
}
