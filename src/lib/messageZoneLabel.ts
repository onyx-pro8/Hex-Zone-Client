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

function composeHeadingLabel(name: string, senderNetworkId: string): string {
  if (name && senderNetworkId) return `${name} (${senderNetworkId})`;
  return name || senderNetworkId;
}

function multiZoneSenderLabel(matchedCount: number): string {
  const more = Math.max(matchedCount - 1, 0);
  return `My zone and ${more} more zones`;
}

function readSenderNetworkId(meta: Record<string, unknown> | null): string {
  if (!meta) return "";
  const top = meta.sender_network_id;
  if (typeof top === "string" && top.trim()) return top.trim();
  const senderZone = meta.sender_relevant_zone;
  if (senderZone && typeof senderZone === "object") {
    const nested = (senderZone as Record<string, unknown>).sender_network_id;
    if (typeof nested === "string" && nested.trim()) return nested.trim();
  }
  return "";
}

function readSenderMatchedZoneCount(meta: Record<string, unknown> | null): number {
  if (!meta) return 0;
  const stored = meta.sender_matched_zone_count;
  if (typeof stored === "number" && stored > 0) return stored;
  const fanout =
    meta.fanout && typeof meta.fanout === "object"
      ? (meta.fanout as Record<string, unknown>)
      : null;
  const rawIds = fanout?.sender_zone_record_ids;
  if (Array.isArray(rawIds)) {
    const unique = new Set(
      rawIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id)),
    );
    return unique.size;
  }
  return 0;
}

function embeddedZoneFields(raw: unknown): {
  name?: string;
  zoneNetworkId?: string;
  senderNetworkId?: string;
  label?: string;
} {
  if (!raw || typeof raw !== "object") return {};
  const row = raw as Record<string, unknown>;
  return {
    label: typeof row.label === "string" ? row.label.trim() : undefined,
    name: typeof row.name === "string" ? row.name.trim() : undefined,
    zoneNetworkId:
      typeof row.network_id === "string" ? row.network_id.trim() : undefined,
    senderNetworkId:
      typeof row.sender_network_id === "string"
        ? row.sender_network_id.trim()
        : undefined,
  };
}

function relevantZoneFromMetadata(
  message: Message,
  viewerOwnerId?: number | null,
): Pick<Message, "relevant_zone_name" | "relevant_zone_network_id" | "relevant_zone_label"> & {
  matched_zone_count?: number;
} {
  const meta =
    message.raw_payload && typeof message.raw_payload === "object"
      ? (message.raw_payload as Record<string, unknown>)
      : null;
  if (!meta) return {};

  const senderNetworkId = readSenderNetworkId(meta);
  const matchedCount = readSenderMatchedZoneCount(meta);
  const isSender =
    viewerOwnerId != null &&
    viewerOwnerId > 0 &&
    message.sender_id === viewerOwnerId;

  if (isSender && matchedCount > 1) {
    return {
      relevant_zone_name: "My zone",
      relevant_zone_network_id: senderNetworkId || undefined,
      relevant_zone_label: multiZoneSenderLabel(matchedCount),
      matched_zone_count: matchedCount,
    };
  }

  let embedded: ReturnType<typeof embeddedZoneFields> = {};
  if (viewerOwnerId != null && viewerOwnerId > 0) {
    const recipientZones = meta.recipient_relevant_zones;
    if (recipientZones && typeof recipientZones === "object") {
      embedded = embeddedZoneFields(
        (recipientZones as Record<string, unknown>)[String(viewerOwnerId)],
      );
    }
  }
  if (!embedded.name && !embedded.label) {
    embedded = embeddedZoneFields(meta.sender_relevant_zone);
  }

  const name = embedded.name;
  const resolvedSenderNet =
    senderNetworkId || embedded.senderNetworkId || embedded.zoneNetworkId || "";
  const label =
    name || resolvedSenderNet
      ? composeHeadingLabel(name || "", resolvedSenderNet)
      : embedded.label;

  return {
    relevant_zone_name: name,
    relevant_zone_network_id: resolvedSenderNet || undefined,
    relevant_zone_label: label,
    matched_zone_count: matchedCount || undefined,
  };
}

/** Display label: `{delivery zone} ({sender network id})`, or multi-zone sender summary. */
export function messageZoneLabel(
  message: Message,
  options?: {
    viewerOwnerId?: number | null;
    zoneNames?: ZoneNameLookup;
  },
): string {
  const fromMeta = relevantZoneFromMetadata(message, options?.viewerOwnerId);
  if (
    fromMeta.matched_zone_count != null &&
    fromMeta.matched_zone_count > 1 &&
    options?.viewerOwnerId != null &&
    message.sender_id === options.viewerOwnerId &&
    fromMeta.relevant_zone_label?.trim()
  ) {
    return fromMeta.relevant_zone_label.trim();
  }

  const fromApiLabel = message.relevant_zone_label?.trim();
  if (fromApiLabel) return fromApiLabel;

  if (fromMeta.relevant_zone_label?.trim()) return fromMeta.relevant_zone_label.trim();

  const apiName = message.relevant_zone_name?.trim() || fromMeta.relevant_zone_name?.trim();
  const senderNetworkId =
    message.relevant_zone_network_id?.trim() ||
    fromMeta.relevant_zone_network_id?.trim() ||
    "";

  if (apiName && senderNetworkId) return composeHeadingLabel(apiName, senderNetworkId);

  const zoneId = message.zone_id?.trim() || "";
  const lookup = options?.zoneNames;
  if (lookup && zoneId) {
    const lookedUpName = lookup.get(zoneId);
    if (lookedUpName) {
      return composeHeadingLabel(lookedUpName, senderNetworkId || zoneId);
    }
  }

  if (apiName) return apiName;
  return senderNetworkId || zoneId || "Zone";
}
