import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import GuestMessages from "../pages/guest/GuestMessages";

vi.mock("../lib/guestAccessToken", () => ({
  getGuestAccessToken: () => "guest-token",
  getGuestSessionMeta: () => ({
    zone_id: "ZONE-1",
    zone_ids: ["ZONE-1"],
    allowed_message_types: ["CHAT", "PERMISSION"],
  }),
  persistGuestSessionMeta: vi.fn(),
}));

vi.mock("../hooks/useGuestRealtime", () => ({
  useGuestRealtime: () => ({
    isPeerOnline: () => false,
    lastMessage: null,
  }),
}));

vi.mock("../services/api/guestMessages", () => ({
  fetchGuestMe: vi.fn().mockResolvedValue({
    data: { guest_id: "g1", display_name: "Guest", zone_ids: ["ZONE-1"], allowed_message_types: ["CHAT", "PERMISSION"] },
    error: null,
  }),
  fetchGuestPeers: vi.fn().mockResolvedValue({
    data: [
      { owner_id: "owner-1", display_name: "Admin", role: "administrator" },
      { owner_id: "owner-2", display_name: "Member", role: "user" },
    ],
    error: null,
  }),
  listGuestThreadMessages: vi.fn().mockResolvedValue({
    data: [{ id: "m1", zone_id: "ZONE-1", type: "PERMISSION", text: "Auto permission", created_at: "2026-01-01" }],
    error: null,
  }),
  sendGuestMessage: vi.fn().mockResolvedValue({ data: null, error: null }),
  isOwnGuestChatMessage: (item: { type?: string; from_kind?: string; from_owner_id?: string }) => {
    const t = String(item.type ?? "").toUpperCase();
    if (t === "PERMISSION") return false;
    if (item.from_kind === "guest") return true;
    if (item.from_kind === "owner" || item.from_kind === "zone_broadcast") return false;
    return t === "CHAT" && !item.from_owner_id;
  },
}));

describe("Guest messages composer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends CHAT only to the administrator while still rendering PERMISSION thread rows", async () => {
    const { sendGuestMessage } = await import("../services/api/guestMessages");
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/guest/messages?zone=ZONE-1"]}>
        <GuestMessages />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByText(/guests can send chat only to the network administrator/i)).toBeInTheDocument(),
    );
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.queryByText("Member")).not.toBeInTheDocument();
    await user.type(screen.getByPlaceholderText(/write a message/i), "hello");
    await user.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(vi.mocked(sendGuestMessage)).toHaveBeenCalledWith(
        expect.objectContaining({ type: "CHAT", to_owner_id: "owner-1" }),
      );
    });
  });
});
