import { describe, expect, it } from "vitest";
import { mapGuestAccessErrorCode } from "../services/api/accessPermissions";

describe("guest access error code mapping", () => {
  it("maps backend error codes to user-facing messages", () => {
    expect(mapGuestAccessErrorCode("PERMISSION_MANUAL_DISABLED")).toMatch(/automatic/i);
    expect(mapGuestAccessErrorCode("GUEST_MESSAGE_TYPE_NOT_ALLOWED")).toBe(
      "Guests can send CHAT only",
    );
    expect(mapGuestAccessErrorCode("INVALID_GUEST_TOKEN")).toMatch(/invalid/i);
    expect(mapGuestAccessErrorCode("TOKEN_ZONE_MISMATCH")).toMatch(/invalid/i);
    expect(mapGuestAccessErrorCode("GUEST_NOT_AUTHORIZED_FOR_ZONE")).toMatch(/access denied/i);
    expect(mapGuestAccessErrorCode("GUEST_CHAT_QUEUE_WAITING")).toMatch(
      /administrator to message you first/i,
    );
  });
});

