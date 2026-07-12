import { describe, expect, it } from "vitest";
import type { Message } from "../services/api/messages";
import { filterDashboardServiceMessages } from "../lib/recentServicesFilter";

function serviceRow(overrides: Partial<Message> = {}): Message {
  return {
    id: "svc-1",
    zone_id: "ZN-6DV321",
    sender_id: 2,
    receiver_id: null,
    type: "SERVICE",
    category: "Alert",
    scope: "public",
    visibility: "public",
    message: "Hello",
    created_at: "2026-06-28T12:41:17.000Z",
    raw_payload: {
      fanout: { network_zone_id: "NETWORK-Q32AbZ" },
    },
    ...overrides,
  };
}

describe("filterDashboardServiceMessages", () => {
  it("includes SERVICE rows when network id is in propagation metadata", () => {
    const rows = filterDashboardServiceMessages(
      [serviceRow(), serviceRow({ id: "pa-1", type: "PA" })],
      "NETWORK-Q32AbZ",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("svc-1");
  });

  it("falls back to all inbox SERVICE rows when zone labels differ from network id", () => {
    const rows = filterDashboardServiceMessages(
      [serviceRow({ raw_payload: null })],
      "NETWORK-Q32AbZ",
    );
    expect(rows).toHaveLength(1);
  });
});
