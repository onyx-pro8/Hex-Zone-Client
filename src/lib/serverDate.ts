/**
 * Server datetimes are UTC. Values often arrive without a timezone suffix;
 * JS would treat those as local, so we normalize to UTC before formatting
 * for the device's local timezone.
 */

export function parseServerDate(value?: string | null): Date | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;
  const hasZone = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(raw);
  const normalized = hasZone ? raw : `${raw.replace(" ", "T")}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Format a server UTC datetime in the device's local timezone. */
export function formatServerDateTime(
  value?: string | null,
  options?: Intl.DateTimeFormatOptions,
  fallback = "",
): string {
  const parsed = parseServerDate(value);
  if (!parsed) return fallback || (value?.trim() ? value : "");
  return options
    ? parsed.toLocaleString(undefined, options)
    : parsed.toLocaleString();
}

/** Format a server UTC datetime as a local time-of-day. */
export function formatServerTime(
  value?: string | null,
  options?: Intl.DateTimeFormatOptions,
  fallback = "",
): string {
  const parsed = parseServerDate(value);
  if (!parsed) return fallback || (value?.trim() ? value : "");
  return parsed.toLocaleTimeString(undefined, options);
}

/** Format a server UTC datetime as a local calendar date. */
export function formatServerDate(
  value?: string | null,
  options?: Intl.DateTimeFormatOptions,
  fallback = "",
): string {
  const parsed = parseServerDate(value);
  if (!parsed) return fallback || (value?.trim() ? value : "");
  return parsed.toLocaleDateString(undefined, options);
}
