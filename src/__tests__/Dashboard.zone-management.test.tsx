import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard from "../pages/Dashboard";

const mockMap = vi.fn((props?: unknown) => (
  <div data-testid="hex-map" {...(props as object)} />
));

const mockUseZones = vi.fn();

vi.mock("../components/HexMapperMap", () => ({
  __esModule: true,
  default: (props: unknown) => mockMap(props),
  h3CellsAtPoint: () => [],
}));

vi.mock("../hooks/useWebSocket", () => ({
  useWebSocket: () => ({
    lastMessage: null,
    sendMessage: vi.fn(),
    status: "closed" as const,
  }),
}));

vi.mock("../services/api/accessPermissions", () => ({
  listGuestRequestsForZone: vi.fn().mockResolvedValue({ data: [], error: null }),
  approveGuestPermissionRequestRemote: vi.fn().mockResolvedValue({ data: null, error: null }),
  denyGuestPermissionRequestRemote: vi.fn().mockResolvedValue({ data: null, error: null }),
  createGuestChatThreadPlaceholder: vi
    .fn()
    .mockResolvedValue({ data: null, error: null }),
}));

vi.mock("../components/AddressAutocompleteInput", () => ({
  AddressAutocompleteInput: () => <div data-testid="address-input" />,
}));

const mockValidateZoneReference = vi.fn();
const mockGenerateZoneReference = vi.fn();

vi.mock("../services/api/zoneReferences", () => ({
  validateZoneReference: (...args: unknown[]) => mockValidateZoneReference(...args),
  generateZoneReference: (...args: unknown[]) => mockGenerateZoneReference(...args),
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    user: {
      id: "u-1",
      role: "standard",
      zone_id: "owner-zone",
      first_name: "Test",
      last_name: "User",
      email: "test@example.com",
    },
  }),
}));

vi.mock("../hooks/useZones", () => ({
  useZones: (...args: unknown[]) => mockUseZones(...args),
}));

const communalValidationResponse = {
  valid: true,
  zone_type: "communal_id",
  reference_id: "COMM-1",
  display_name: "Test Community",
  geometry: {
    geo_fence_polygon: {
      type: "Polygon",
      coordinates: [
        [
          [106.812, -6.198],
          [106.822, -6.198],
          [106.822, -6.208],
          [106.812, -6.208],
          [106.812, -6.198],
        ],
      ],
    },
  },
  config: { communal_id: "COMM-1" },
  h3_cells: [] as string[],
  source: "catalog",
};

const baseZones = [
  {
    id: "1",
    zone_id: "owner-zone",
    name: "Alpha",
    h3_cells: ["a"],
    can_edit: true,
  },
  {
    id: "2",
    zone_id: "owner-zone",
    name: "Beta",
    h3_cells: ["b"],
    can_edit: true,
  },
];

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
}

describe("Dashboard zone management", () => {
  beforeEach(() => {
    mockMap.mockClear();
    mockUseZones.mockReset();
    mockValidateZoneReference.mockReset();
    mockGenerateZoneReference.mockReset();
    mockValidateZoneReference.mockResolvedValue({
      data: communalValidationResponse,
      error: null,
    });
  });

  it("switches active tab and show-all toggle controls rendered layers", async () => {
    mockUseZones.mockReturnValue({
      zones: baseZones,
      capabilities: { can_create_zone: true },
      loading: false,
      error: null,
      saveZone: vi.fn(),
      updateSavedZone: vi.fn(),
    });

    renderDashboard();

    await waitFor(() => expect(mockMap).toHaveBeenCalled());
    const latestProps = (): Record<string, unknown> =>
      (mockMap.mock.calls.at(-1)?.[0] as unknown as Record<string, unknown>) ??
      {};

    await waitFor(() => {
      const layers = latestProps().savedZoneCellLayers as Array<{
        cells: string[];
      }>;
      expect(layers).toHaveLength(2);
    });

    fireEvent.click(screen.getByLabelText("Show all zones on map"));
    await waitFor(() => {
      const layers = latestProps().savedZoneCellLayers as Array<{
        cells: string[];
      }>;
      expect(layers).toHaveLength(1);
      expect(layers[0].cells).toEqual(["a"]);
    });

    fireEvent.click(screen.getByRole("button", { name: "Beta" }));
    await waitFor(() => {
      const layers = latestProps().savedZoneCellLayers as Array<{
        cells: string[];
      }>;
      expect(layers).toHaveLength(1);
      expect(layers[0].cells).toEqual(["b"]);
    });

    fireEvent.click(screen.getByLabelText("Show all zones on map"));
    await waitFor(() => {
      const layers = latestProps().savedZoneCellLayers as Array<{
        cells: string[];
      }>;
      expect(layers).toHaveLength(2);
    });
  });

  it("disables new-zone action when backend capability blocks create", () => {
    mockUseZones.mockReturnValue({
      zones: [],
      capabilities: {
        can_create_zone: false,
        reason: "You have reached the zone limit for this user.",
      },
      loading: false,
      error: null,
      saveZone: vi.fn(),
      updateSavedZone: vi.fn(),
    });

    renderDashboard();

    const newZoneButton = screen.getByRole("button", { name: /\+ New zone/i });
    expect(newZoneButton).toBeDisabled();
    expect(
      screen.getAllByText("You have reached the zone limit for this user.").length,
    ).toBeGreaterThan(0);
  });

  it("persists trimmed zone name when creating a zone", async () => {
    const saveZone = vi.fn().mockResolvedValue({});
    mockUseZones.mockReturnValue({
      zones: [],
      capabilities: { can_create_zone: true },
      loading: false,
      error: null,
      saveZone,
      updateSavedZone: vi.fn(),
    });

    renderDashboard();

    fireEvent.click(screen.getByRole("button", { name: /\+ New zone/i }));
    fireEvent.change(screen.getByLabelText("Zone name"), {
      target: { value: "  Operations West  " },
    });
    fireEvent.change(screen.getByLabelText("Zone type"), {
      target: { value: "communal_id" },
    });
    fireEvent.change(screen.getByLabelText("Communal ID"), {
      target: { value: "COMM-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Validate ID/i }));
    await waitFor(() => expect(mockValidateZoneReference).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Create zone/i }));

    await waitFor(() => expect(saveZone).toHaveBeenCalledTimes(1));
    const payload = saveZone.mock.calls[0][0] as { name: string };
    expect(payload.name).toBe("Operations West");
  });

  it("shows backend quota errors when save is blocked", async () => {
    const updateSavedZone = vi
      .fn()
      .mockRejectedValue(new Error("zone quota exceeded"));
    mockUseZones.mockReturnValue({
      zones: [baseZones[0]],
      capabilities: { can_create_zone: true },
      loading: false,
      error: null,
      saveZone: vi.fn(),
      updateSavedZone,
    });

    renderDashboard();

    fireEvent.change(screen.getByLabelText("Zone type"), {
      target: { value: "communal_id" },
    });
    fireEvent.change(screen.getByLabelText("Communal ID"), {
      target: { value: "COMM-2" },
    });
    mockValidateZoneReference.mockResolvedValueOnce({
      data: { ...communalValidationResponse, reference_id: "COMM-2" },
      error: null,
    });
    fireEvent.click(screen.getByRole("button", { name: /Validate ID/i }));
    await waitFor(() => expect(mockValidateZoneReference).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Save zone/i }));

    await waitFor(() => expect(updateSavedZone).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/Quota limit:/i)).toBeInTheDocument();
  });
});
