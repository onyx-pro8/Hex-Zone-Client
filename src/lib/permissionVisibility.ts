/**
 * PERMISSION rows from GET /messages may include `permission_visibility`.
 * Tolerate casing; treat unknown non-empty strings as unbadged legacy-style lines.
 */

export const PERMISSION_VISIBILITY_DIRECT = "direct";
export const PERMISSION_VISIBILITY_ZONE_PENDING_BROADCAST = "zone_pending_broadcast";

export function normalizePermissionVisibilityToken(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

export function isPermissionDirectVisibility(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim().toLowerCase() === PERMISSION_VISIBILITY_DIRECT;
}

export function isPermissionZonePendingBroadcastVisibility(
  v: string | null | undefined,
): boolean {
  return (
    typeof v === "string" &&
    v.trim().toLowerCase() === PERMISSION_VISIBILITY_ZONE_PENDING_BROADCAST
  );
}
