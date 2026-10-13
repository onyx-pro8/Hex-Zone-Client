import { beforeEach, describe, expect, it, vi } from "vitest";
import * as guestAccessToken from "../lib/guestAccessToken";
import {
  exchangeGuestSession,
  guestExchangeAxios,
  guestSessionAxios,
  normalizeGuestSessionExchangeData,
} from "../services/api/guestSession";
import {
  fetchGuestMe,
  normalizeGuestMe,
  normalizeGuestPeers,
} from "../services/api/guestMessages";

describe("guest session exchange normalization", () => {
  it("parses envelope + nested guest", () => {
    const raw = {
      status: "success",
      data: {
        access_token: "jwt-1",
        token_type: "Bearer",
        expires_in: 7200,
        guest: {
          guest_id: "g-99",
          display_name: "Pat",
          zone_ids: ["z-a", "z-b"],
          allowed_message_types: ["CHAT", "PERMISSION"],
        },
      },
    };
    const n = normalizeGuestSessionExchangeData(raw);
    expect(n).toMatchObject({
      access_token: "jwt-1",
      expires_in: 7200,
      guest: {
        guest_id: "g-99",
        display_name: "Pat",
        zone_ids: ["z-a", "z-b"],
        allowed_message_types: ["CHAT", "PERMISSION"],
      },
    });
  });

  it("returns null when access_token missing", () => {
    expect(normalizeGuestSessionExchangeData({ guest: {} })).toBeNull();
  });
});

describe("guest /me normalization", () => {
  it("maps camelCase fields", () => {
    const n = normalizeGuestMe({
      guestId: "g1",
      displayName: "Sam",
      zoneIds: ["z1"],
      allowedMessageTypes: ["chat"],
    });
    expect(n).toEqual({
      guest_id: "g1",
      display_name: "Sam",
      zone_ids: ["z1"],
      allowed_message_types: ["CHAT"],
    });
  });

  it("normalizes peer list from hosts key", () => {
    expect(
      normalizeGuestPeers({
        status: "success",
        data: { hosts: [{ owner_id: "7", display_name: "Desk" }] },
      }),
    ).toEqual([{ owner_id: "7", display_name: "Desk" }]);
  });

  it("accepts numeric owner_id in peers payload", () => {
    expect(
      normalizeGuestPeers({
        status: "success",
        data: {
          zone_id: "ZN-1",
          peers: [
            { peer_kind: "owner", owner_id: 86, display_name: "Admin", role: "administrator" },
            { peer_kind: "owner", owner_id: 87, display_name: "User", role: "user" },
          ],
        },
      }),
    ).toEqual([
      { owner_id: "86", display_name: "Admin", role: "administrator" },
      { owner_id: "87", display_name: "User", role: "user" },
    ]);
  });

  it("reads nested guest + zone objects", () => {
    const n = normalizeGuestMe({
      status: "success",
      data: {
        guest: {
          id: "gx-2",
          display_name: "Pat",
          zones: [{ id: "z99" }],
          allowed_message_types: ["CHAT"],
        },
      },
    });
    expect(n).toEqual({
      guest_id: "gx-2",
      display_name: "Pat",
      zone_ids: ["z99"],
      allowed_message_types: ["CHAT"],
    });
  });
});

describe("guest session HTTP (mocked axios instances)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("exchangeGuestSession posts to configured URL and maps 404", async () => {
    const post = vi.spyOn(guestExchangeAxios, "post").mockResolvedValue({
      status: 404,
      data: {},
    } as never);
    const r = await exchangeGuestSession({
      guest_id: "g",
      zone_id: "z",
      exchange_code: "c",
    });
    expect(r.status).toBe(404);
    expect(r.data).toBeNull();
    expect(r.error).toMatch(/404/);
    expect(post).toHaveBeenCalledWith(
      "/api/access/guest-session",
      { guest_id: "g", zone_id: "z", exchange_code: "c" },
      expect.any(Object),
    );
  });

  it("fetchGuestMe uses guestSessionAxios with Bearer from storage", async () => {
    vi.spyOn(guestAccessToken, "getGuestAccessToken").mockReturnValue("guest-jwt");
    const get = vi.spyOn(guestSessionAxios, "get").mockResolvedValue({
      status: 200,
      data: {
        status: "success",
        data: {
          guest_id: "gx",
          display_name: "Alex",
          zone_ids: ["zz"],
          allowed_message_types: ["PERMISSION"],
        },
      },
    } as never);
    const r = await fetchGuestMe();
    expect(r.error).toBeNull();
    expect(r.data?.guest_id).toBe("gx");
    expect(get).toHaveBeenCalledWith("/api/guest/me", expect.any(Object));
  });
});
