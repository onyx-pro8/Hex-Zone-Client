import { describe, expect, it } from "vitest";
import { parseInboxSocketRefetchSignal } from "../services/socket/messageSocket";

describe("parseInboxSocketRefetchSignal", () => {
  it("returns true for inbox refresh signal types", () => {
    expect(parseInboxSocketRefetchSignal(JSON.stringify({ type: "NEW_MESSAGE" }))).toBe(true);
    expect(parseInboxSocketRefetchSignal(JSON.stringify({ type: "PERMISSION_MESSAGE" }))).toBe(
      true,
    );
    expect(parseInboxSocketRefetchSignal(JSON.stringify({ type: "NEW_GEO_MESSAGE" }))).toBe(true);
    expect(parseInboxSocketRefetchSignal(JSON.stringify({ type: "unexpected_guest" }))).toBe(
      true,
    );
    expect(parseInboxSocketRefetchSignal(JSON.stringify({ type: "guest_is_here" }))).toBe(true);
  });

  it("returns false for unrelated frames", () => {
    expect(parseInboxSocketRefetchSignal(JSON.stringify({ type: "PING" }))).toBe(false);
    expect(parseInboxSocketRefetchSignal("not json")).toBe(false);
  });
});
