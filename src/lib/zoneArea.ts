import { cellArea } from "h3-js";

type LngLat = [number, number];

function ringAreaM2(ring: LngLat[]): number {
  const points = ring.filter((point) => point.length >= 2);
  const open =
    points.length >= 2 &&
    points[0][0] === points[points.length - 1][0] &&
    points[0][1] === points[points.length - 1][1]
      ? points.slice(0, -1)
      : points;
  if (open.length < 3) return 0;
  const radius = 6378137;
  let total = 0;
  for (let index = 0; index < open.length; index += 1) {
    const [lng, lat] = open[index];
    const [lng2, lat2] = open[(index + 1) % open.length];
    total +=
      ((lng2 - lng) * Math.PI) / 180 *
      (2 + Math.sin((lat * Math.PI) / 180) + Math.sin((lat2 * Math.PI) / 180));
  }
  return Math.abs((total * radius * radius) / 2);
}

export function formatArea(m2: number): string {
  const meters = Math.max(0, m2);
  const km = meters / 1_000_000;
  const meterLabel = `${Math.round(meters).toLocaleString()} m²`;
  const kmLabel = `${km.toLocaleString(undefined, { maximumFractionDigits: 2 })} km²`;
  return `${kmLabel} (${meterLabel})`;
}

export function draftZoneAreaM2(input: {
  zoneType: string;
  polygons: { outer: [number, number][]; holes: [number, number][][] }[];
  cells: string[];
  radiusMeters?: number | null;
  governmentPolygon?: unknown;
}): number {
  if (input.zoneType === "government_local_code" && input.governmentPolygon) {
    return polygonAreaM2(input.governmentPolygon);
  }
  if (input.zoneType === "proximity" || input.zoneType === "object" || input.zoneType === "dynamic") {
    const radius = Number(input.radiusMeters ?? 0);
    return radius > 0 ? Math.PI * radius * radius : 0;
  }
  if (input.zoneType === "grid") {
    return input.cells.reduce((sum, cell) => {
      try {
        return sum + cellArea(cell, "m2");
      } catch {
        return sum;
      }
    }, 0);
  }
  let area = 0;
  for (const shape of input.polygons) {
    const outer = shape.outer.map(([lat, lng]) => [lng, lat] as LngLat);
    area += ringAreaM2(outer);
    for (const hole of shape.holes) {
      area -= ringAreaM2(hole.map(([lat, lng]) => [lng, lat] as LngLat));
    }
  }
  return Math.max(0, area);
}

function polygonAreaM2(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const polygon = value as { type?: string; coordinates?: unknown };
  if (polygon.type === "Polygon" && Array.isArray(polygon.coordinates)) {
    const rings = polygon.coordinates as LngLat[][];
    if (!rings.length) return 0;
    let area = ringAreaM2(rings[0]);
    for (const hole of rings.slice(1)) area -= ringAreaM2(hole);
    return Math.max(0, area);
  }
  if (polygon.type === "MultiPolygon" && Array.isArray(polygon.coordinates)) {
    return (polygon.coordinates as LngLat[][][]).reduce(
      (sum, part) => sum + polygonAreaM2({ type: "Polygon", coordinates: part }),
      0,
    );
  }
  return 0;
}

export function areaBlockReason(input: {
  draftM2: number;
  eachZoneM2: number | null;
  remainingTotalM2: number | null;
}): string | null {
  if (input.eachZoneM2 != null && input.draftM2 > input.eachZoneM2 + 1) {
    return "This zone is bigger than the each-zone limit.";
  }
  if (input.remainingTotalM2 != null && input.draftM2 > input.remainingTotalM2 + 1) {
    return "Not enough total size left.";
  }
  return null;
}
