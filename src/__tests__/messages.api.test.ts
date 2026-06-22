import { beforeEach, describe, expect, it, vi } from "vitest";
import { listMessages, normalizeMessage, sendMessage } from "../services/api/messages";
import { request } from "../services/api/client";

vi.mock("../services/api/client", async () => {
  const actual = await vi.importActual("../services/api/client");
  return {
    ...actual,
    request: vi.fn(),
  };
});

const requestMock = vi.mocked(request);

describe("messages api adapter", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("normalizes typed records without dropping category/scope metadata", () => {
    const normalized = normalizeMessage({
      id: "m-1",
      zone_id: "ZONE-1",
      sender_id: 123,
      receiver_id: null,
      message_type: "NS_PANIC",
      message: "Need support",
      created_at: "2026-04-26T00:00:00Z",
    });

    expect(normalized).toMatchObject({
      id: "m-1",
      type: "NS_PANIC",
      category: "Alarm",
      scope: "public",
      visibility: "public",
      message: "Need support",
    });
  });

  it("maps legacy visibility-only records into fallback message types", () => {
    const privateLegacy = normalizeMessage({
      id: "legacy-private",
      zone_id: "ZONE-2",
      sender_id: 5,
      visibility: "private",
      message: "legacy private message",
      created_at: "2026-01-01T00:00:00Z",
    });
    const publicLegacy = normalizeMessage({
      id: "legacy-public",
      zone_id: "ZONE-2",
      sender_id: 6,
      visibility: "public",
      message: "legacy public message",
      created_at: "2026-01-01T00:00:00Z",
    });

    expect(privateLegacy?.type).toBe("PRIVATE");
    expect(privateLegacy?.scope).toBe("private");
    expect(publicLegacy?.type).toBe("SERVICE");
    expect(publicLegacy?.scope).toBe("public");
  });

  it("keeps rendering unknown/malformed type records as UNKNOWN instead of crashing", () => {
    const row = normalizeMessage({
      id: "m-unknown",
      zone_id: "ZONE-3",
      sender_id: 7,
      message_type: "SOME_NEW_TYPE",
      message: "still show this",
      created_at: "2026-01-01T00:00:00Z",
    });
    expect(row?.type).toBe("UNKNOWN");
    expect(row?.scope).toBe("public");
  });

  it("adapts send payload to typed contract with derived visibility", async () => {
    requestMock.mockResolvedValue({
      data: {
        id: "m-2",
        zone_id: "ZONE-1",
        sender_id: 123,
        receiver_id: 456,
        message_type: "CHAT",
        message: "hello",
        created_at: "2026-04-26T00:00:00Z",
      },
      error: null,
      loading: false,
    });

    await sendMessage({
      type: "CHAT",
      zone_id: "ZONE-1",
      receiver_id: 456,
      message: "hello",
      latitude: 47.62,
      longitude: -122.35,
    });

    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "/messages",
        data: expect.objectContaining({
          message_type: "CHAT",
          visibility: "private",
          receiver_id: 456,
          zone_id: "ZONE-1",
          latitude: 47.62,
          longitude: -122.35,
          msg: {
            latitude: 47.62,
            longitude: -122.35,
          },
        }),
      }),
    );
  });

  it("normalizes sender coordinates from geo-propagation metadata", () => {
    const normalized = normalizeMessage({
      id: "m-geo",
      zone_id: "ZONE-1",
      sender_id: 9,
      receiver_id: null,
      message_type: "PANIC",
      message: "help",
      created_at: "2026-04-26T00:00:00Z",
      raw_payload: {
        position: { latitude: 34.05, longitude: -118.24 },
      },
    });

    expect(normalized).toMatchObject({
      latitude: 34.05,
      longitude: -118.24,
    });
  });

  it("sends guest_id for access channel and omits receiver_id", async () => {
    requestMock.mockResolvedValue({
      data: {
        id: "m-g",
        zone_id: "ZONE-1",
        sender_id: 1,
        receiver_id: null,
        message_type: "PERMISSION",
        message: "gate",
        created_at: "2026-04-26T00:00:00Z",
      },
      error: null,
      loading: false,
    });

    await sendMessage({
      type: "PERMISSION",
      zone_id: "ZONE-1",
      message: "gate",
      guest_id: "guest-uuid-9",
    });

    const call = requestMock.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data).toMatchObject({
      message_type: "PERMISSION",
      visibility: "private",
      guest_id: "guest-uuid-9",
      zone_id: "ZONE-1",
    });
    expect(call.data.receiver_id).toBeUndefined();
  });

  it("list normalization accepts full supported type taxonomy", async () => {
    requestMock.mockResolvedValue({
      data: [
        {
          id: "1",
          zone_id: "Z",
          sender_id: 1,
          message_type: "SENSOR",
          message: "a",
          created_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "2",
          zone_id: "Z",
          sender_id: 1,
          message_type: "WELLNESS_CHECK",
          message: "b",
          created_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "3",
          zone_id: "Z",
          sender_id: 1,
          message_type: "PERMISSION",
          receiver_id: 2,
          message: "c",
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
      error: null,
      loading: false,
    });

    const result = await listMessages({ owner_id: 1 });
    expect(result.data?.map((m) => m.type)).toEqual([
      "SENSOR",
      "WELLNESS_CHECK",
      "PERMISSION",
    ]);
  });
});
