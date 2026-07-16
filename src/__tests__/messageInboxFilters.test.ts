import { describe, expect, it } from "vitest";
import {
  applyMessageInboxFilters,
  messageMatchesDateRange,
  messageMatchesKeyword,
  messageTypesForCategories,
  type InboxFilterableMessage,
} from "../lib/messageInboxFilters";

function msg(
  overrides: Partial<InboxFilterableMessage> &
    Pick<InboxFilterableMessage, "type" | "category">,
): InboxFilterableMessage {
  return {
    zone_id: "ZONE-A",
    sender_id: 1,
    receiver_id: 2,
    scope: "public",
    message: "Hello world",
    created_at: "2026-07-10T12:00:00Z",
    ...overrides,
  };
}

describe("messageInboxFilters", () => {
  it("matches keyword across text and zone", () => {
    const row = msg({ type: "PA", category: "Alert", message: "Road closed" });
    expect(messageMatchesKeyword(row, "road")).toBe(true);
    expect(messageMatchesKeyword(row, "ZONE-A")).toBe(true);
    expect(messageMatchesKeyword(row, "missing")).toBe(false);
  });

  it("applies inclusive date range on UTC day", () => {
    const row = msg({
      type: "PANIC",
      category: "Alarm",
      created_at: "2026-07-10T23:30:00Z",
    });
    expect(messageMatchesDateRange(row, "2026-07-10", "2026-07-10")).toBe(true);
    expect(messageMatchesDateRange(row, "2026-07-11", "")).toBe(false);
    expect(messageMatchesDateRange(row, "", "2026-07-09")).toBe(false);
  });

  it("excludes Alarm on Messages-style filters and keeps Alert types", () => {
    const rows = [
      msg({ type: "PANIC", category: "Alarm", message: "panic" }),
      msg({ type: "PA", category: "Alert", message: "announce" }),
      msg({ type: "CHAT", category: "Access", scope: "private", message: "hi" }),
    ];
    const filtered = applyMessageInboxFilters(rows, {
      excludeCategories: ["Alarm"],
      search: "announce",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.type).toBe("PA");
  });

  it("restricts Incoming Alarms to Alarm category and type", () => {
    const rows = [
      msg({ type: "PANIC", category: "Alarm", message: "panic" }),
      msg({ type: "SENSOR", category: "Alarm", message: "sensor" }),
      msg({ type: "PA", category: "Alert", message: "pa" }),
    ];
    const filtered = applyMessageInboxFilters(rows, {
      includeCategories: ["Alarm"],
      typeFilter: "PANIC",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.type).toBe("PANIC");
  });

  it("lists types for Alert/Access vs Alarm", () => {
    const alertTypes = messageTypesForCategories(["Alert", "Access"]).map(
      (t) => t.type,
    );
    expect(alertTypes).toContain("PA");
    expect(alertTypes).toContain("CHAT");
    expect(alertTypes).not.toContain("PANIC");

    const alarmTypes = messageTypesForCategories(["Alarm"]).map((t) => t.type);
    expect(alarmTypes).toContain("PANIC");
    expect(alarmTypes).not.toContain("PA");
  });
});
