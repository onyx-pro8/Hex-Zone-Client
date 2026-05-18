import * as turf from "@turf/turf";

export type LatLng = [number, number]; // lat, lng

/** One polygon: outer ring + optional inner rings (holes), all closed rings */
export type GeoPolygonShape = {
  id: string;
  outer: LatLng[];
  holes: LatLng[][];
};

export function newPolygonId() {
  return `poly-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function pointInPolygon(lat: number, lng: number, outer: LatLng[]): boolean {
  if (outer.length < 3) return false;
  const pt = turf.point([lng, lat]);
  const c = [...outer];
  const [lat0, lng0] = c[0];
  const last = c[c.length - 1];
  if (last[0] !== lat0 || last[1] !== lng0) {
    c.push([lat0, lng0]);
  }
  const coords = c.map(([la, ln]) => [ln, la] as [number, number]);
  const poly = turf.polygon([coords]);
  return turf.booleanPointInPolygon(pt, poly);
}

/** First polygon whose outer ring contains this point (for hole assignment) */
export function findPolygonContainingPoint(
  lat: number,
  lng: number,
  polygons: GeoPolygonShape[],
): GeoPolygonShape | null {
  for (const p of polygons) {
    if (pointInPolygon(lat, lng, p.outer)) {
      let inHole = false;
      for (const h of p.holes) {
        if (pointInPolygon(lat, lng, h)) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return p;
    }
  }
  return null;
}

export function distanceMeters(a: LatLng, b: LatLng): number {
  const from = turf.point([a[1], a[0]]);
  const to = turf.point([b[1], b[0]]);
  return turf.distance(from, to, { units: "meters" });
}

export function ringsNearlyClosed(
  ring: LatLng[],
  click: LatLng,
  maxM = 85,
): boolean {
  if (ring.length < 3) return false;
  return distanceMeters(click, ring[0]) <= maxM;
}

export function movePolygonOuterVertex(
  polygons: GeoPolygonShape[],
  polygonId: string,
  vertexIndex: number,
  lat: number,
  lng: number,
): GeoPolygonShape[] {
  return polygons.map((poly) => {
    if (poly.id !== polygonId) return poly;
    const outer = poly.outer.map((pt, idx) =>
      idx === vertexIndex ? ([lat, lng] as LatLng) : pt,
    );
    return { ...poly, outer };
  });
}

export function deletePolygonOuterVertex(
  polygons: GeoPolygonShape[],
  polygonId: string,
  vertexIndex: number,
): GeoPolygonShape[] {
  return polygons.map((poly) => {
    if (poly.id !== polygonId) return poly;
    if (poly.outer.length <= 3) return poly;
    return {
      ...poly,
      outer: poly.outer.filter((_, idx) => idx !== vertexIndex),
    };
  });
}

/** Index of a vertex within maxDistanceMeters of the click, or null. */
export function nearestOuterVertexIndex(
  lat: number,
  lng: number,
  outer: LatLng[],
  maxDistanceMeters: number,
): number | null {
  let bestIdx: number | null = null;
  let bestDist = maxDistanceMeters;
  for (let i = 0; i < outer.length; i += 1) {
    const d = distanceMeters([lat, lng], outer[i]);
    if (d <= bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function projectPointOntoSegment(p: LatLng, a: LatLng, b: LatLng): LatLng {
  const [lat, lng] = p;
  const [lat1, lng1] = a;
  const [lat2, lng2] = b;
  const dx = lng2 - lng1;
  const dy = lat2 - lat1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return a;
  const t = Math.max(
    0,
    Math.min(1, ((lng - lng1) * dx + (lat - lat1) * dy) / lenSq),
  );
  return [lat1 + t * dy, lng1 + t * dx];
}

/** Closest edge segment on the outer ring within maxDistanceMeters. */
export function findClosestOuterEdge(
  lat: number,
  lng: number,
  outer: LatLng[],
  maxDistanceMeters: number,
): {
  segmentIndex: number;
  lat: number;
  lng: number;
  distanceMeters: number;
} | null {
  if (outer.length < 2) return null;
  const click: LatLng = [lat, lng];
  let best: {
    segmentIndex: number;
    lat: number;
    lng: number;
    distanceMeters: number;
  } | null = null;

  for (let i = 0; i < outer.length; i += 1) {
    const a = outer[i];
    const b = outer[(i + 1) % outer.length];
    const snap = projectPointOntoSegment(click, a, b);
    const dist = distanceMeters(click, snap);
    if (dist > maxDistanceMeters) continue;
    if (!best || dist < best.distanceMeters) {
      best = {
        segmentIndex: i,
        lat: snap[0],
        lng: snap[1],
        distanceMeters: dist,
      };
    }
  }
  return best;
}

/** Insert a vertex after segmentIndex (between outer[i] and outer[i+1]). */
export function insertPolygonOuterVertex(
  polygons: GeoPolygonShape[],
  polygonId: string,
  segmentIndex: number,
  lat: number,
  lng: number,
): GeoPolygonShape[] {
  return polygons.map((poly) => {
    if (poly.id !== polygonId) return poly;
    const insertAt = segmentIndex + 1;
    const outer = [...poly.outer];
    outer.splice(insertAt, 0, [lat, lng]);
    return { ...poly, outer };
  });
}

/** Approximate circle as a polygon ring (meters). Pure math — avoids @turf/circle types. */
export function circleToPolygonRing(
  center: LatLng,
  radiusMeters: number,
  steps = 64,
): LatLng[] {
  const [lat, lng] = center;
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) return [];
  const ring: LatLng[] = [];
  const latRad = (lat * Math.PI) / 180;
  const angular = radiusMeters / 6371000;
  const cosLat = Math.cos(latRad);
  for (let i = 0; i <= steps; i++) {
    const bearing = (2 * Math.PI * i) / steps;
    const lat2 = Math.asin(
      Math.sin(latRad) * Math.cos(angular) +
        cosLat * Math.sin(angular) * Math.cos(bearing),
    );
    const lng2 =
      (lng * Math.PI) / 180 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angular) * cosLat,
        Math.cos(angular) - Math.sin(latRad) * Math.sin(lat2),
      );
    ring.push([(lat2 * 180) / Math.PI, (lng2 * 180) / Math.PI]);
  }
  return ring;
}
