import { describe, expect, it } from "vitest";
import {
  buildZoneNameLookup,
  messageZoneLabel,
} from "../lib/messageZoneLabel";
import type { Message } from "../services/api/messages";

function baseMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "1",
    zone_id: "ZN-6DV321",
    sender_id: 2,
    receiver_id: null,
    type: "NS_PANIC",
    category: "Alarm",
    scope: "public",
    visibility: "public",
    message: "test",
    created_at: "2026-07-12T00:40:46Z",
    raw_payload: null,
    ...overrides,
  };
}

describe("messageZoneLabel", () => {
  it("prefers relevant_zone_label from API", () => {
    const message = baseMessage({
      relevant_zone_label: "Primary (ZN-HOME)",
    });
    expect(messageZoneLabel(message)).toBe("Primary (ZN-HOME)");
  });

  it("composes delivery zone name with sender network id from API fields", () => {
    const message = baseMessage({
      relevant_zone_name: "Downtown Grid",
      relevant_zone_network_id: "ZN-HOME",
    });
    expect(messageZoneLabel(message)).toBe("Downtown Grid (ZN-HOME)");
  });

  it("uses sender network id when delivery zone belongs to another network", () => {
    const message = baseMessage({
      sender_id: 2,
      raw_payload: {
        sender_network_id: "ZN-HOME",
        recipient_relevant_zones: {
          "5": {
            name: "Other district zone",
            network_id: "ZN-OTHER",
            sender_network_id: "ZN-HOME",
            label: "Other district zone (ZN-HOME)",
          },
        },
      },
    });
    expect(messageZoneLabel(message, { viewerOwnerId: 5 })).toBe(
      "Other district zone (ZN-HOME)",
    );
  });

  it("summarizes multi-zone sends for the sender", () => {
    const message = baseMessage({
      sender_id: 2,
      relevant_zone_label: "Primary (ZN-HOME)",
      raw_payload: {
        sender_network_id: "ZN-HOME",
        sender_matched_zone_count: 4,
        sender_relevant_zone: {
          name: "Primary",
          network_id: "ZN-HOME",
          sender_network_id: "ZN-HOME",
          label: "Primary (ZN-HOME)",
        },
      },
    });
    expect(messageZoneLabel(message, { viewerOwnerId: 2 })).toBe(
      "My zone and 3 more zones",
    );
  });

  it("keeps single-zone label for recipients even when sender matched several", () => {
    const message = baseMessage({
      sender_id: 2,
      raw_payload: {
        sender_network_id: "ZN-HOME",
        sender_matched_zone_count: 4,
        recipient_relevant_zones: {
          "5": {
            name: "East wing",
            network_id: "ZN-ABC123",
            sender_network_id: "ZN-HOME",
            label: "East wing (ZN-HOME)",
          },
        },
      },
    });
    expect(messageZoneLabel(message, { viewerOwnerId: 5 })).toBe(
      "East wing (ZN-HOME)",
    );
  });

  it("resolves name from zone lookup when API omits name", () => {
    const zoneNames = buildZoneNameLookup([
      { name: "Primary", zone_id: "ZN-6DV321", id: 401 },
    ]);
    expect(messageZoneLabel(baseMessage(), { zoneNames })).toBe(
      "Primary (ZN-6DV321)",
    );
  });

  it("falls back to zone id when no name is available", () => {
    expect(messageZoneLabel(baseMessage())).toBe("ZN-6DV321");
  });
});

describe("buildZoneNameLookup", () => {
  it("indexes both network id and record id", () => {
    const lookup = buildZoneNameLookup([
      { name: "Primary", zone_id: "ZN-1", id: 99 },
    ]);
    expect(lookup.get("ZN-1")).toBe("Primary");
    expect(lookup.get("99")).toBe("Primary");
  });
});
