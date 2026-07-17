import { describe, expect, it } from "vitest";
import { wellnessResponseTrackingEnabled } from "../lib/messageWorkflow";
import type { MessageType } from "../lib/messageTypes";

function wellnessMessage(
  raw_payload: Record<string, unknown> | null,
): { type: MessageType; raw_payload: Record<string, unknown> | null } {
  return { type: "WELLNESS_CHECK", raw_payload };
}

describe("wellnessResponseTrackingEnabled", () => {
  it("is enabled for smart-home sender hid", () => {
    expect(
      wellnessResponseTrackingEnabled(
        wellnessMessage({ hid: "HOME-SENSOR-01", response_tracking_enabled: true }),
      ),
    ).toBe(true);
  });

  it("is disabled for mobile sender hid", () => {
    expect(
      wellnessResponseTrackingEnabled(
        wellnessMessage({ hid: "MOB-ABCDEFGH", response_tracking_enabled: false }),
      ),
    ).toBe(false);
  });

  it("infers smart-home from hid when flag is absent", () => {
    expect(
      wellnessResponseTrackingEnabled(wellnessMessage({ hid: "DEVICE-123" })),
    ).toBe(true);
    expect(
      wellnessResponseTrackingEnabled(wellnessMessage({ hid: "MOB-123" })),
    ).toBe(false);
  });
});
