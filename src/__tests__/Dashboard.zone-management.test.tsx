import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard from "../pages/Dashboard";

const mockMap = vi.fn((props?: unknown) => (
  <div data-testid="hex-map" {...(props as object)} />
));

const mockUseZones = vi.fn();
const mockUseAuth = vi.fn();

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
const mockListCommunalIds = vi.fn();
const mockListZonesForCommunalId = vi.fn();

vi.mock("../services/api/zoneReferences", () => ({
  validateZoneReference: (...args: unknown[]) => mockValidateZoneReference(...args),
  generateZoneReference: (...args: unknown[]) => mockGenerateZoneReference(...args),
  listCommunalIds: (...args: unknown[]) => mockListCommunalIds(...args),
  listZonesForCommunalId: (...args: unknown[]) => mockListZonesForCommunalId(...args),
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("../hooks/useZones", () => ({
  useZones: (...args: unknown[]) => mockUseZones(...args),
}));

vi.mock("../services/api/members", () => ({
  getMembers: vi.fn().mockResolvedValue({ data: [], error: null }),
  updateLocation: vi.fn().mockResolvedValue({ data: null, error: null }),
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
    creator_id: "u-1",
    type: "grid",
  },
  {
    id: "2",
    zone_id: "owner-zone",
    name: "Beta",
    h3_cells: ["b"],
    creator_id: "u-1",
    type: "grid",
  },
];

const standardUser = {
  id: "u-1",
  role: "standard",
  zone_id: "owner-zone",
  accountType: "PRIVATE_PLUS",
  first_name: "Test",
  last_name: "User",
  email: "test@example.com",
};

const adminUser = {
  ...standardUser,
  role: "administrator",
  accountType: "PRIVATE_PLUS",
};

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
    mockUseAuth.mockReset();
    mockValidateZoneReference.mockReset();
    mockGenerateZoneReference.mockReset();
    mockListCommunalIds.mockReset();
    mockListZonesForCommunalId.mockReset();
    mockUseAuth.mockReturnValue({ user: standardUser });
    mockListCommunalIds.mockResolvedValue({ data: [], error: null });
    mockListZonesForCommunalId.mockResolvedValue({ data: [], error: null });
    mockValidateZoneReference.mockResolvedValue({
      data: communalValidationResponse,
      error: null,
    });
    mockGenerateZoneReference.mockResolvedValue({
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
      deleteSavedZone: vi.fn(),
      refresh: vi.fn(),
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

    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
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
      deleteSavedZone: vi.fn(),
      refresh: vi.fn(),
    });

    renderDashboard();

    const newZoneButton = screen.getByRole("button", { name: /\+ New zone/i });
    expect(newZoneButton).toBeDisabled();
    expect(
      screen.getAllByText("You have reached the zone limit for this user.").length,
    ).toBeGreaterThan(0);
  });

  it("saves a Communal ID via generate-reference for network admins", async () => {
    mockUseAuth.mockReturnValue({ user: adminUser });
    mockUseZones.mockReturnValue({
      zones: [],
      capabilities: {
        can_create_zone: true,
        can_create_primary: true,
        max_primary: 2,
        role: "administrator",
      },
      loading: false,
      error: null,
      saveZone: vi.fn(),
      updateSavedZone: vi.fn(),
      deleteSavedZone: vi.fn(),
      refresh: vi.fn(),
    });
    mockValidateZoneReference.mockResolvedValue({
      data: {
        ...communalValidationResponse,
        valid: false,
        exists: false,
        message: "Available",
      },
      error: null,
    });

    renderDashboard();

    fireEvent.change(screen.getByLabelText("Zone type"), {
      target: { value: "communal_id" },
    });
    fireEvent.change(screen.getByLabelText("Communal ID"), {
      target: { value: "COMM-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => expect(mockGenerateZoneReference).toHaveBeenCalled());
    expect(mockGenerateZoneReference.mock.calls[0][0]).toMatchObject({
      zone_type: "communal_id",
      reference_id: "COMM-1",
      persist: true,
    });
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
      deleteSavedZone: vi.fn(),
      refresh: vi.fn(),
    });

    renderDashboard();

    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    fireEvent.change(screen.getByLabelText("Zone name"), {
      target: { value: "Alpha Updated" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save zone|Update/i }));

    await waitFor(() => expect(updateSavedZone).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/Quota limit:/i)).toBeInTheDocument();
  });

  it("hides Communal ID tools for Individual accounts even when role is administrator", async () => {
    mockUseAuth.mockReturnValue({
      user: {
        ...adminUser,
        accountType: "EXCLUSIVE",
      },
    });
    mockUseZones.mockReturnValue({
      zones: [],
      capabilities: {
        can_create_zone: true,
        can_create_primary: true,
        max_primary: 2,
        role: "administrator",
      },
      loading: false,
      error: null,
      saveZone: vi.fn(),
      updateSavedZone: vi.fn(),
      deleteSavedZone: vi.fn(),
      refresh: vi.fn(),
    });

    renderDashboard();

    const typeSelect = screen.getByLabelText("Zone type") as HTMLSelectElement;
    expect(
      Array.from(typeSelect.options).some((opt) => opt.value === "communal_id"),
    ).toBe(false);
    expect(screen.queryByText("Zone tier")).not.toBeInTheDocument();
  });
});
