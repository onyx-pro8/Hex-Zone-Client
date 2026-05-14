import { describe, expect, it } from "vitest";
import {
  normalizeMessage,
  sortInboxAccessMessages,
  type Message,
} from "../services/api/messages";

describe("normalizeMessage", () => {
  it("keeps PERMISSION rows when top-level message body is empty but msg carries metadata", () => {
    const m = normalizeMessage({
      id: "p1",
      zone_id: "ZONE-9",
      sender_id: "42",
      created_at: "2026-03-01T12:00:00Z",
      type: "permission",
      message: "",
      msg: { status: "PENDING_APPROVAL", guest_id: "g-uuid" },
    });
    expect(m).not.toBeNull();
    expect(m?.type).toBe("PERMISSION");
    expect(m?.message).toContain("PENDING_APPROVAL");
    expect(m?.sender_id).toBe(42);
  });

  it("accepts lowercase message_type alias", () => {
    const m = normalizeMessage({
      id: "c1",
      zone_id: "ZONE-9",
      sender_id: 7,
      created_at: "2026-03-01T12:00:00Z",
      message_type: "chat",
      message: "",
      msg: { note: "x" },
    });
    expect(m?.type).toBe("CHAT");
    expect(m?.message.length).toBeGreaterThan(0);
  });

  it("accepts mixed-case type string for CHAT", () => {
    const m = normalizeMessage({
      id: "c2",
      zone_id: "ZONE-9",
      sender_id: 1,
      created_at: "2026-03-01T12:00:00Z",
      type: "Chat",
      message: "hello",
    });
    expect(m?.type).toBe("CHAT");
    expect(m?.category).toBe("Access");
    expect(m?.scope).toBe("private");
  });

  it("applies category and scope hints from msg for CHAT when backend sends lowercase", () => {
    const m = normalizeMessage({
      id: "c3",
      zone_id: "ZONE-9",
      sender_id: 1,
      created_at: "2026-03-01T12:00:00Z",
      type: "CHAT",
      message: "x",
      msg: { category: "access", scope: "private" },
    });
    expect(m?.category).toBe("Access");
    expect(m?.scope).toBe("private");
  });

  it("accepts inbound CHAT when guest_id is present and numeric sender is missing", () => {
    const m = normalizeMessage({
      id: "in-1",
      zone_id: "ZONE-G",
      created_at: "2026-03-01T12:00:00Z",
      type: "CHAT",
      guest_id: "550e8400-e29b-41d4-a716-446655440000",
      message: "Hello from guest",
    });
    expect(m).not.toBeNull();
    expect(m?.message).toBe("Hello from guest");
    expect(m?.guest_sender_id).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(m?.sender_id).toBe(0);
  });

  it("accepts guest CHAT when guest id is only under msg or raw_payload", () => {
    const fromMsg = normalizeMessage({
      id: "in-2",
      zone_id: "Z1",
      created_at: "2026-03-01T12:00:00Z",
      type: "CHAT",
      message: "nested",
      msg: { guestId: "uuid-from-msg" },
    });
    expect(fromMsg?.guest_sender_id).toBe("uuid-from-msg");

    const fromPayload = normalizeMessage({
      id: "in-3",
      zone_id: "Z1",
      created_at: "2026-03-01T12:00:00Z",
      type: "CHAT",
      message: "payload guest",
      raw_payload: { guest_id: "uuid-from-raw" },
    });
    expect(fromPayload?.guest_sender_id).toBe("uuid-from-raw");
  });

  it("keeps admin CHAT with sender_id unchanged (no guest_sender_id)", () => {
    const m = normalizeMessage({
      id: "out-1",
      zone_id: "ZONE-9",
      sender_id: 42,
      created_at: "2026-03-01T12:00:00Z",
      type: "CHAT",
      message: "Admin reply",
    });
    expect(m?.sender_id).toBe(42);
    expect(m?.guest_sender_id).toBeUndefined();
    expect(m?.message).toBe("Admin reply");
  });

  it("still rejects non–Access-channel rows without numeric sender", () => {
    const sensor = normalizeMessage({
      id: "bad-s",
      zone_id: "Z",
      created_at: "2026-01-01T00:00:00Z",
      type: "SENSOR",
      guest_id: "should-not-save-sensor",
      message: "motion",
    });
    expect(sensor).toBeNull();

    const legacyPrivate = normalizeMessage({
      id: "bad-p",
      zone_id: "Z",
      visibility: "private",
      guest_id: "should-not-save-private",
      message: "hi",
      created_at: "2026-01-01T00:00:00Z",
    });
    expect(legacyPrivate).toBeNull();
  });

  it("maps PERMISSION permission_visibility and guest_id null from API", () => {
    const m = normalizeMessage({
      id: "uuid-perm-1",
      zone_id: "ZN-1",
      sender_id: 10,
      receiver_id: 20,
      created_at: "2026-03-01T12:00:00Z",
      type: "PERMISSION",
      message: "Walk-in waiting",
      guest_id: null,
      permission_visibility: "direct",
    });
    expect(m?.permission_visibility).toBe("direct");
    expect(m?.guest_id).toBeNull();
    expect(m?.message).toBe("Walk-in waiting");
  });

  it("reads permission_visibility from msg / raw_payload when typed PERMISSION", () => {
    const fromMsg = normalizeMessage({
      id: "p2",
      zone_id: "ZN-1",
      sender_id: 1,
      receiver_id: null,
      created_at: "2026-03-01T12:00:00Z",
      type: "PERMISSION",
      message: "x",
      msg: { permission_visibility: "zone_pending_broadcast" },
    });
    expect(fromMsg?.permission_visibility).toBe("zone_pending_broadcast");

    const fromRaw = normalizeMessage({
      id: "p3",
      zone_id: "ZN-1",
      sender_id: 1,
      receiver_id: null,
      created_at: "2026-03-01T12:00:00Z",
      type: "PERMISSION",
      message: "y",
      raw_payload: { permission_visibility: "direct" },
    });
    expect(fromRaw?.permission_visibility).toBe("direct");
  });
});

describe("sortInboxAccessMessages", () => {
  it("pins zone_pending_broadcast PERMISSION rows to the top", () => {
    const older: Message = {
      id: "a",
      zone_id: "Z",
      sender_id: 1,
      receiver_id: null,
      type: "PERMISSION",
      category: "Access",
      scope: "private",
      visibility: "private",
      message: "old",
      created_at: "2026-01-01T00:00:00Z",
      raw_payload: null,
      permission_visibility: "direct",
    };
    const newerBroadcast: Message = {
      id: "b",
      zone_id: "Z",
      sender_id: 1,
      receiver_id: null,
      type: "PERMISSION",
      category: "Access",
      scope: "private",
      visibility: "private",
      message: "walk-in",
      created_at: "2026-01-02T00:00:00Z",
      raw_payload: null,
      permission_visibility: "zone_pending_broadcast",
    };
    const sorted = sortInboxAccessMessages([older, newerBroadcast]);
    expect(sorted[0]?.id).toBe("b");
    expect(sorted[1]?.id).toBe("a");
  });
});
