import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MessageList } from "../components/messages/MessageList";

describe("MessageList", () => {
  it("renders friendly type labels and derived scope/category badges", () => {
    render(
      <MessageList
        activeId={null}
        onSelect={() => {}}
        messages={[
          {
            id: "m1",
            zone_id: "ZONE-1",
            sender_id: 1,
            receiver_id: null,
            type: "NS_PANIC",
            category: "Alarm",
            scope: "public",
            visibility: "public",
            message: "alert message",
            created_at: "2026-01-01T00:00:00Z",
            raw_payload: null,
          },
          {
            id: "m2",
            zone_id: "ZONE-2",
            sender_id: 2,
            receiver_id: 99,
            type: "WELLNESS_CHECK",
            category: "Alert",
            scope: "public",
            visibility: "public",
            message: "wellness message",
            created_at: "2026-01-01T00:00:00Z",
            raw_payload: null,
          },
          {
            id: "m3",
            zone_id: "ZONE-3",
            sender_id: 2,
            receiver_id: 99,
            type: "PERMISSION",
            category: "Access",
            scope: "private",
            visibility: "private",
            message: "permission workflow event",
            created_at: "2026-01-01T00:00:00Z",
            raw_payload: null,
          },
        ]}
      />,
    );

    expect(screen.getByText("NS PANIC")).toBeInTheDocument();
    expect(screen.getByText("WELLNESS CHECK")).toBeInTheDocument();
    expect(screen.getByText("PERMISSION")).toBeInTheDocument();
    expect(screen.getByText("Alarm")).toBeInTheDocument();
    expect(screen.getAllByText("public")[0]).toBeInTheDocument();
  });

  it("shows Zone alert and Private badges for PERMISSION visibility hints", () => {
    render(
      <MessageList
        activeId={null}
        onSelect={() => {}}
        messages={[
          {
            id: "m4",
            zone_id: "ZONE-4",
            sender_id: 2,
            receiver_id: 99,
            type: "PERMISSION",
            category: "Access",
            scope: "private",
            visibility: "private",
            message: "Walk-in pending",
            created_at: "2026-01-01T00:00:00Z",
            raw_payload: null,
            permission_visibility: "zone_pending_broadcast",
          },
          {
            id: "m5",
            zone_id: "ZONE-5",
            sender_id: 2,
            receiver_id: 3,
            type: "PERMISSION",
            category: "Access",
            scope: "private",
            visibility: "private",
            message: "Staff audit",
            created_at: "2026-01-01T00:00:00Z",
            raw_payload: null,
            permission_visibility: "direct",
          },
        ]}
      />,
    );

    expect(screen.getByText("Zone alert")).toBeInTheDocument();
    expect(screen.getByText("Private")).toBeInTheDocument();
  });
});
