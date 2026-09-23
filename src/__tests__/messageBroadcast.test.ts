import { describe, expect, it } from "vitest";
import { messageBroadcastLabel } from "../lib/messageBroadcast";
import type { Message } from "../services/api/messages";

function baseMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    zone_id: "ZONE-1",
    sender_id: 42,
    receiver_id: null,
    type: "CHAT",
    category: "Alert",
    scope: "public",
    visibility: "public",
    message: "hello",
    created_at: "2026-01-01T00:00:00Z",
    raw_payload: null,
    ...overrides,
  };
}

describe("messageBroadcastLabel", () => {
  it("shows ME for the current owner's own messages", () => {
    const message = baseMessage({
      sender_id: 7,
      raw_payload: { broadcast_name: "Alex" },
    });
    expect(
      messageBroadcastLabel(message, {
        selfOwnerId: 7,
        selfBroadcastName: "Alex",
      }),
    ).toBe("ME");
  });

  it("shows embedded broadcast name for other senders", () => {
    const message = baseMessage({
      sender_id: 9,
      raw_payload: { broadcast_name: "Neighbor" },
    });
    expect(messageBroadcastLabel(message, { selfOwnerId: 7 })).toBe("Neighbor");
  });

  it("falls back to resolved owner name when no embedded broadcast name", () => {
    const message = baseMessage({ sender_id: 9 });
    expect(
      messageBroadcastLabel(message, {
        selfOwnerId: 7,
        resolveOwnerName: (id) => (id === 9 ? "Sam" : null),
      }),
    ).toBe("Sam");
  });

  it("shows the guest real name instead of a generic Guest label", () => {
    const message = baseMessage({
      sender_id: 0,
      guest_sender_id: "g-3",
      raw_payload: { guest_name: "Guest 3" },
    });
    expect(messageBroadcastLabel(message, { selfOwnerId: 7 })).toBe("Guest 3");
  });
});
