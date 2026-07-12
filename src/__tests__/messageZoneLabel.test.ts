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
      relevant_zone_label: "Primary (ZN-6DV321)",
    });
    expect(messageZoneLabel(message)).toBe("Primary (ZN-6DV321)");
  });

  it("composes name and network id from API fields", () => {
    const message = baseMessage({
      relevant_zone_name: "Primary",
      relevant_zone_network_id: "ZN-6DV321",
    });
    expect(messageZoneLabel(message)).toBe("Primary (ZN-6DV321)");
  });

  it("resolves name from zone lookup when API omits name", () => {
    const zoneNames = buildZoneNameLookup([
      { name: "Primary", zone_id: "ZN-6DV321", id: 401 },
    ]);
    expect(messageZoneLabel(baseMessage(), { zoneNames })).toBe(
      "Primary (ZN-6DV321)",
    );
  });

  it("reads recipient relevant zone from raw_payload metadata", () => {
    const message = baseMessage({
      raw_payload: {
        recipient_relevant_zones: {
          "5": {
            name: "East wing",
            network_id: "ZN-ABC123",
            label: "East wing (ZN-ABC123)",
          },
        },
      },
    });
    expect(messageZoneLabel(message, { viewerOwnerId: 5 })).toBe(
      "East wing (ZN-ABC123)",
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
