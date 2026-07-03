import { describe, expect, it } from "vitest";
import {
  getMessageScopeForType,
  groupMessageTypesForUI,
  isPrivateMessageType,
  toMessageType,
  toMessageTypeLabel,
} from "../lib/messageTypes";

describe("messageTypes model", () => {
  it("maps API-safe constants to user-facing labels", () => {
    expect(toMessageTypeLabel("NS_PANIC")).toBe("NS PANIC");
    expect(toMessageTypeLabel("WELLNESS_CHECK")).toBe("WELLNESS CHECK");
  });

  it("derives private scope from private/direct message types", () => {
    expect(isPrivateMessageType("PRIVATE")).toBe(true);
    expect(isPrivateMessageType("PERMISSION")).toBe(true);
    expect(isPrivateMessageType("CHAT")).toBe(true);
    expect(isPrivateMessageType("PANIC")).toBe(false);
  });

  it("returns expected scope for each group boundary", () => {
    expect(getMessageScopeForType("PRIVATE")).toBe("private");
    expect(getMessageScopeForType("CHAT")).toBe("private");
    expect(getMessageScopeForType("SERVICE")).toBe("public");
    expect(getMessageScopeForType("UNKNOWN")).toBe("public");
  });

  it("groups options by Alarm, Alert, Access for UI selectors", () => {
    const grouped = groupMessageTypesForUI();
    expect(grouped.map((g) => g.category)).toEqual(["Alarm", "Alert", "Access"]);
    expect(grouped[0]?.options.map((option) => option.type)).toContain("NS_PANIC");
    expect(grouped[0]?.options.map((option) => option.type)).toContain("WELLNESS_CHECK");
    expect(grouped[1]?.options.map((option) => option.type)).toContain("PRIVATE");
    expect(grouped[2]?.options.map((option) => option.type)).toEqual(
      expect.arrayContaining(["PERMISSION", "CHAT"]),
    );
  });

  it("accepts known types and rejects unknown strings", () => {
    expect(toMessageType("PANIC")).toBe("PANIC");
    expect(toMessageType("nope")).toBeNull();
  });
});
