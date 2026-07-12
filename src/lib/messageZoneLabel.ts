import type { Message } from "../services/api/messages";

export type ZoneNameLookup = Map<string, string>;

type ZoneRow = {
  name?: string | null;
  zone_id?: string | number | null;
  id?: string | number | null;
};

export function buildZoneNameLookup(zones: ZoneRow[]): ZoneNameLookup {
  const lookup: ZoneNameLookup = new Map();
  for (const zone of zones) {
    const name = typeof zone.name === "string" ? zone.name.trim() : "";
    if (!name) continue;
    const networkId =
      zone.zone_id != null && String(zone.zone_id).trim()
        ? String(zone.zone_id).trim()
        : "";
    const recordId =
      zone.id != null && String(zone.id).trim() ? String(zone.id).trim() : "";
    if (networkId) lookup.set(networkId, name);
    if (recordId) lookup.set(recordId, name);
  }
  return lookup;
}

function embeddedZoneLabel(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const label = row.label;
  if (typeof label === "string" && label.trim()) return label.trim();
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const networkId =
    typeof row.network_id === "string" ? row.network_id.trim() : "";
  if (name && networkId) return `${name} (${networkId})`;
  return name || networkId || null;
}

function relevantZoneFromMetadata(
  message: Message,
  viewerOwnerId?: number | null,
): Pick<Message, "relevant_zone_name" | "relevant_zone_network_id" | "relevant_zone_label"> {
  const meta = message.raw_payload;
  if (!meta || typeof meta !== "object") return {};

  const record = meta as Record<string, unknown>;
  if (viewerOwnerId != null && viewerOwnerId > 0) {
    const recipientZones = record.recipient_relevant_zones;
    if (recipientZones && typeof recipientZones === "object") {
      const entry = (recipientZones as Record<string, unknown>)[String(viewerOwnerId)];
      const label = embeddedZoneLabel(entry);
      if (label) {
        const payload = entry as Record<string, unknown>;
        return {
          relevant_zone_label: label,
          relevant_zone_name:
            typeof payload.name === "string" ? payload.name : undefined,
          relevant_zone_network_id:
            typeof payload.network_id === "string" ? payload.network_id : undefined,
        };
      }
    }
  }

  const senderZone = record.sender_relevant_zone;
  const senderLabel = embeddedZoneLabel(senderZone);
  if (senderLabel && senderZone && typeof senderZone === "object") {
    const payload = senderZone as Record<string, unknown>;
    return {
      relevant_zone_label: senderLabel,
      relevant_zone_name:
        typeof payload.name === "string" ? payload.name : undefined,
      relevant_zone_network_id:
        typeof payload.network_id === "string" ? payload.network_id : undefined,
    };
  }

  return {};
}

function composeZoneNameAndId(name: string, zoneId: string): string {
  if (name && zoneId) return `${name} (${zoneId})`;
  return name || zoneId;
}

/** Display label: `Zone Name (Zone ID)` for message list/detail chips. */
export function messageZoneLabel(
  message: Message,
  options?: {
    viewerOwnerId?: number | null;
    zoneNames?: ZoneNameLookup;
  },
): string {
  const fromApiLabel = message.relevant_zone_label?.trim();
  if (fromApiLabel) return fromApiLabel;

  const fromMeta = relevantZoneFromMetadata(message, options?.viewerOwnerId);
  if (fromMeta.relevant_zone_label?.trim()) return fromMeta.relevant_zone_label.trim();

  const apiName = message.relevant_zone_name?.trim() || fromMeta.relevant_zone_name?.trim();
  const zoneId =
    message.relevant_zone_network_id?.trim() ||
    fromMeta.relevant_zone_network_id?.trim() ||
    message.zone_id?.trim() ||
    "";

  if (apiName && zoneId) return composeZoneNameAndId(apiName, zoneId);

  const lookup = options?.zoneNames;
  if (lookup && zoneId) {
    const lookedUpName = lookup.get(zoneId);
    if (lookedUpName) return composeZoneNameAndId(lookedUpName, zoneId);
  }

  return zoneId || "Zone";
}
