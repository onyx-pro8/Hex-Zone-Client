import { describe, expect, it } from "vitest";
import { countUniqueUnreadAlarmBadge } from "../lib/alarmRead";
import type { Message } from "../services/api/messages";

function alarm(id: string, read = false): Message {
  return {
    id,
    zone_id: "zone-1",
    sender_id: 1,
    receiver_id: null,
    type: "PANIC",
    category: "Alarm",
    scope: "public",
    visibility: "public",
    message: "Help",
    created_at: "2026-01-01T00:00:00.000Z",
    is_read_by_viewer: read,
  };
}

describe("countUniqueUnreadAlarmBadge", () => {
  it("counts a live alarm only once when it is already in the unread inbox", () => {
    const messages = [alarm("alarm-1")];
    const live = [{ id: "alarm-1" }];
    expect(countUniqueUnreadAlarmBadge(messages, live, 42)).toBe(1);
  });

  it("includes live alarms that have not reached the inbox yet", () => {
    expect(countUniqueUnreadAlarmBadge([], [{ id: "alarm-2" }], 42)).toBe(1);
  });

  it("ignores read inbox rows even if they are still in the live list", () => {
    const messages = [alarm("alarm-1", true)];
    const live = [{ id: "alarm-1" }];
    expect(countUniqueUnreadAlarmBadge(messages, live, 42)).toBe(0);
  });
});
