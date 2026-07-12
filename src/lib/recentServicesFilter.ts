import type { Message } from "../services/api/messages";

/** Collect network / zone identifiers attached to a geo-propagated inbox row. */
export function collectServiceZoneIdentifiers(row: Message): Set<string> {
  const ids = new Set<string>();
  const push = (value: unknown) => {
    if (typeof value === "string" && value.trim()) ids.add(value.trim());
  };

  push(row.zone_id);
  push((row as Message & { relevant_zone_network_id?: string | null }).relevant_zone_network_id);

  const meta = row.raw_payload;
  if (!meta || typeof meta !== "object") return ids;

  const record = meta as Record<string, unknown>;
  const fanout = record.fanout;
  if (fanout && typeof fanout === "object") {
    const f = fanout as Record<string, unknown>;
    push(f.network_zone_id);
    if (Array.isArray(f.matched_network_zone_ids)) {
      for (const z of f.matched_network_zone_ids) push(z);
    }
  }
  if (Array.isArray(record.zone_ids)) {
    for (const z of record.zone_ids) push(z);
  }

  return ids;
}

/**
 * SERVICE rows for the Overview dashboard.
 *
 * Geo-propagated events often store an acceptable-zone label on `zone_id` (e.g. `ZN-…`)
 * while the dashboard passes the member network id (`owners.zone_id`, e.g. `NETWORK-…`).
 * The inbox is already scoped to the signed-in viewer, so include all SERVICE rows when
 * identifiers do not line up exactly.
 */
export function filterDashboardServiceMessages(
  batch: Message[],
  networkZoneId: string,
): Message[] {
  const services = batch.filter((row) => row.type === "SERVICE");
  const nid = networkZoneId.trim();
  if (!nid) return services;

  const matched = services.filter((row) => collectServiceZoneIdentifiers(row).has(nid));
  return matched.length > 0 ? matched : services;
}

export function dashboardServiceMatchesNetwork(
  row: Message,
  networkZoneId: string,
): boolean {
  if (row.type !== "SERVICE") return false;
  const nid = networkZoneId.trim();
  if (!nid) return true;
  const ids = collectServiceZoneIdentifiers(row);
  return ids.has(nid) || ids.size === 0;
}
