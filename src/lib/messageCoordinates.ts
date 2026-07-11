import type { Message } from "../services/api/messages";

type CoordinateFields = Pick<Message, "latitude" | "longitude">;

/** Compact sender coordinates for inbox rows. */
export function formatMessageCoordinatesLabel(
  message: CoordinateFields,
  options?: { missingLabel?: string; precision?: number },
): string {
  const precision = options?.precision ?? 4;
  const missing = options?.missingLabel ?? "No location";
  if (
    message.latitude != null &&
    message.longitude != null &&
    Number.isFinite(message.latitude) &&
    Number.isFinite(message.longitude)
  ) {
    return `${message.latitude.toFixed(precision)}, ${message.longitude.toFixed(precision)}`;
  }
  return missing;
}

/** Google Maps link when sender coordinates are available. */
export function messageCoordinatesMapsUrl(message: CoordinateFields): string | null {
  if (
    message.latitude != null &&
    message.longitude != null &&
    Number.isFinite(message.latitude) &&
    Number.isFinite(message.longitude)
  ) {
    return `https://www.google.com/maps?q=${message.latitude},${message.longitude}`;
  }
  return null;
}
