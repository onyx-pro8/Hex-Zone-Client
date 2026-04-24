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
