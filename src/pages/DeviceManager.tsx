import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createDevice,
  fetchDevice,
  fetchDevices,
  fetchZones,
  sendDeviceHeartbeat,
  updateDevice,
  type CachedDeviceSettings,
  type CreateDevicePayload,
  type DeviceResponse,
  type UpdateDevicePayload,
} from "../lib/api";
import { getRemoteAppSettings } from "../services/api";
import {
  listHubCommands,
  sendHubCommand,
  type HubCommandRecord,
} from "../services/api/devices";
import { isSystemAdministrator } from "../lib/accountLimits";
import { uiToast } from "../lib/uiToast";
import { getMembers } from "../services/api/members";
import {
  appendLocalDevice,
  applyDeviceAssignments,
  getSettingsForHid,
  loadLocalDevices,
  mergeApiAndLocalDevices,
  setDeviceAssignment,
  setSettingsForHid,
  updateLocalDevice,
  type LocalManagedDevice,
  type RegisteredUser,
} from "../lib/deviceManagerStorage";
import { useAuth } from "../hooks/useAuth";
import { AddressAutocompleteInput } from "../components/AddressAutocompleteInput";
import {
  deriveDeviceOnline,
  isClientSessionHid,
  isSmartHomeHid,
  refreshSessionDevicePlace,
  removeDevice,
  signOutDevice,
} from "../lib/deviceSync";
import { formatServerDateTime } from "../lib/serverDate";
import { AlertTriangle, CircleDot, Home, Plus, Smartphone, X } from "lucide-react";

const ACCENT = "#2F80ED";
const H3_RESOLUTION = 10;
const WEB_DEVICE_HID_KEY = "zoneweaver_device_hid";
const DM_ADDRESS_LABEL =
  "mb-1.5 block text-xs font-semibold uppercase tracking-[0.15em] text-[#8694AC]";
const DM_ADDRESS_INPUT =
  "w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2.5 text-sm text-[#0F2C5C] placeholder:text-[#8694AC] focus:border-[#2F80ED] focus:outline-none focus:ring-2 focus:ring-[#2F80ED]/25";
const DEVICE_LIMIT_MESSAGE_BY_ACCOUNT = {
  PRIVATE: "Private accounts can register up to 1 smart-home hub.",
  EXCLUSIVE: "Exclusive accounts are limited to 1 smart-home hub.",
  PRIVATE_PLUS: "Private+ accounts can register 10 smart-home hubs.",
  ENHANCED: "Enhanced accounts are limited to 1 smart-home hub.",
  ENHANCED_PLUS: "",
} as const;

type Device = DeviceResponse & {
  /** Person shown in the Devices "User" column (from assignment or API). */
  user_display_name?: string;
  user_email?: string;
  assigned_user_id?: string;
  /** When present, overrides connectivity for UI (online | offline | error). */
  status?: string;
  error_message?: string;
  /** Saved only in this browser when the API cannot create the device. */
  local_only?: boolean;
};

type UiStatus = "online" | "offline" | "error";

function slugUsername(displayName: string): string {
  return displayName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9.]/g, "");
}

function zoneLabel(h3?: string | null): string {
  if (!h3 || h3.length < 6) return "ZN-4F8A2C";
  return `ZN-${h3
    .replace(/[^a-f0-9]/gi, "")
    .slice(0, 6)
    .toUpperCase()}`;
}

function deriveUiStatus(device: Device): UiStatus {
  if (device.error_message) return "error";
  const raw = device.status;
  if (raw === "error") return "error";
  if (raw === "offline") return "offline";
  if (raw === "online") return "online";
  if (deriveDeviceOnline(device)) return "online";
  return "offline";
}

function formatLastSeen(device: Device): string {
  return formatServerDateTime(
    device.last_seen ?? device.updated_at,
    undefined,
    "—",
  );
}

function statusBadgeClass(status: UiStatus): string {
  if (status === "online") return "bg-[#E3F4E8] text-[#2FA24A]";
  if (status === "error") return "bg-[#FBEFD8] text-[#E0992A]";
  return "bg-[#EDF3FB] text-[#8694AC]";
}

function userRowStatusClass(active: boolean): string {
  return active ? "font-medium text-[#2FA24A]" : "font-medium text-[#8694AC]";
}

function generateDeviceHid(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i += 1) {
    s += chars[Math.floor(Math.random() * chars.length)]!;
  }
  return `DEV-${s}`;
}

function isLocalOnlyDevice(d: Device): boolean {
  return Boolean(d.local_only) || d.id < 0;
}

/** Normalizes to `DEV-` + alphanumeric suffix (min 3 chars after the prefix). */
function normalizeDeviceHidInput(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  let suffix: string;
  if (upper.startsWith("DEV-")) {
    suffix = upper.slice(4).replace(/[^A-Z0-9]/g, "");
  } else {
    suffix = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  }
  if (suffix.length < 3) return null;
  return `DEV-${suffix}`;
}

function mapMembersToRegisteredUsers(data: unknown): RegisteredUser[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((m) => {
      const row = m as Record<string, unknown>;
      const id = row.id;
      if (id == null || id === "") return null;
      const first = String(row.first_name ?? "");
      const last = String(row.last_name ?? "");
      const name = String(row.name ?? "");
      const displayName = `${first} ${last}`.trim() || name || `User ${id}`;
      const email = String(row.email ?? "");
      return { id: String(id), displayName, email } satisfies RegisteredUser;
    })
    .filter((u): u is RegisteredUser => u !== null);
}

function ownerForDevice(
  device: Device,
  owners: RegisteredUser[],
): RegisteredUser | undefined {
  if (device.owner?.id != null) {
    const first = String(device.owner.first_name ?? "").trim();
    const last = String(device.owner.last_name ?? "").trim();
    const displayName =
      `${first} ${last}`.trim() ||
      device.owner.email?.trim() ||
      `User ${device.owner.id}`;
    return {
      id: String(device.owner.id),
      displayName,
      email: String(device.owner.email ?? ""),
    };
  }
  const ownerId = device.owner_id != null ? String(device.owner_id) : null;
  if (!ownerId) return undefined;
  return owners.find((o) => o.id === ownerId);
}

type ZoneOption = { id: number; name: string };

type DeviceFormState = {
  name: string;
  address: string;
  propagate_enabled: boolean;
  propagate_radius_km: number;
  enable_notification: boolean;
  alert_threshold_meters: number;
  update_interval_seconds: number;
  webhook: string;
  periodical_check_sec: string;
  zone_ids: number[];
};

function zoneIdsFrom(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const ids: number[] = [];
  for (const item of value) {
    const id = Number(item);
    if (Number.isFinite(id)) ids.push(id);
  }
  return ids;
}

function parseZoneOptions(payload: unknown): ZoneOption[] {
  const rows = Array.isArray(payload)
    ? payload
    : payload &&
        typeof payload === "object" &&
        Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : [];
  const options: ZoneOption[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { id?: unknown; name?: unknown };
    const id = Number(rec.id);
    if (!Number.isFinite(id)) continue;
    options.push({
      id,
      name: String(rec.name ?? "").trim() || `Zone ${id}`,
    });
  }
  return options;
}

function defaultForm(device: Device): DeviceFormState {
  return {
    name: device.name ?? "",
    address: device.address ?? "",
    propagate_enabled: device.propagate_enabled ?? true,
    propagate_radius_km: Number(device.propagate_radius_km ?? 2.5),
    enable_notification: device.enable_notification ?? true,
    alert_threshold_meters: Number(device.alert_threshold_meters ?? 100),
    update_interval_seconds: Number(device.update_interval_seconds ?? 30),
    webhook: device.webhook ?? "",
    periodical_check_sec: device.periodical_check_sec || "86400",
    zone_ids: zoneIdsFrom(device.zone_ids),
  };
}

type NormalizedAccountType =
  | "PRIVATE"
  | "EXCLUSIVE"
  | "PRIVATE_PLUS"
  | "ENHANCED"
  | "ENHANCED_PLUS";

function normalizeAccountType(
  accountType?: string | null,
  legacyAccountType?: string | null,
): NormalizedAccountType {
  const upper = String(accountType ?? legacyAccountType ?? "").toUpperCase();
  if (upper === "EXCLUSIVE") return "EXCLUSIVE";
  if (upper === "PRIVATE_PLUS") return "PRIVATE_PLUS";
  if (upper === "ENHANCED") return "ENHANCED";
  if (upper === "ENHANCED_PLUS") return "ENHANCED_PLUS";
  return "PRIVATE";
}

function getDeviceLimit(accountType: NormalizedAccountType): number {
  if (accountType === "PRIVATE") return 1;
  if (accountType === "PRIVATE_PLUS") return 10;
  if (accountType === "EXCLUSIVE" || accountType === "ENHANCED") return 1;
  return Number.POSITIVE_INFINITY;
}

function remoteToForm(
  remote: DeviceResponse,
  fallback: Device,
): DeviceFormState {
  return {
    name: remote.name ?? fallback.name ?? "",
    address: String(remote.address ?? fallback.address ?? ""),
    propagate_enabled:
      remote.propagate_enabled ?? fallback.propagate_enabled ?? true,
    propagate_radius_km: Number(
      remote.propagate_radius_km ?? fallback.propagate_radius_km ?? 2.5,
    ),
    enable_notification:
      remote.enable_notification ?? fallback.enable_notification ?? true,
    alert_threshold_meters: Number(
      remote.alert_threshold_meters ?? fallback.alert_threshold_meters ?? 100,
    ),
    update_interval_seconds: Number(
      remote.update_interval_seconds ?? fallback.update_interval_seconds ?? 30,
    ),
    webhook: remote.webhook ?? fallback.webhook ?? "",
    periodical_check_sec:
      remote.periodical_check_sec || fallback.periodical_check_sec || "86400",
    zone_ids: zoneIdsFrom(remote.zone_ids ?? fallback.zone_ids),
  };
}

function SmartHomeBindingFields({
  webhook,
  periodicalCheckSec,
  zoneIds,
  zones,
  networkId,
  apiKey,
  onWebhook,
  onPeriod,
  onToggleZone,
}: {
  webhook: string;
  periodicalCheckSec: string;
  zoneIds: number[];
  zones: ZoneOption[];
  networkId: string;
  apiKey: string;
  onWebhook: (value: string) => void;
  onPeriod: (value: string) => void;
  onToggleZone: (zoneId: number) => void;
}) {
  return (
    <div className="space-y-4 rounded-md border border-[#DCE6F2] bg-[#F7FAFE] p-4">
      <p className="text-xs leading-relaxed text-[#566784]">
        This hub has its own webhook. Alarms are sent only for the zones you
        select. Copy the Network ID and API key onto the device.
      </p>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-[0.15em] text-[#8694AC]">
          Webhook
        </label>
        <input
          className="mt-2 w-full rounded-md border border-[#DCE6F2] bg-white px-3 py-2.5 text-sm text-[#0F2C5C] focus:border-[#2F80ED] focus:outline-none focus:ring-2 focus:ring-[#2F80ED]/25"
          value={webhook}
          onChange={(e) => onWebhook(e.target.value)}
          placeholder="https://hub.example.com/hooks/hex-zone"
        />
      </div>
      <div>
        <span className="block text-xs font-semibold uppercase tracking-[0.15em] text-[#8694AC]">
          Zones
        </span>
        {zones.length === 0 ? (
          <p className="mt-2 text-xs text-[#8694AC]">
            No zones yet. Create a zone first, then connect this hub to it.
          </p>
        ) : (
          <div className="mt-2 max-h-40 space-y-2 overflow-y-auto">
            {zones.map((zone) => (
              <label
                key={zone.id}
                className="flex cursor-pointer items-center gap-3 text-sm text-[#566784]"
              >
                <input
                  type="checkbox"
                  className="rounded border-[#E4ECF7] text-[#2F80ED] focus:ring-[#2F80ED]"
                  checked={zoneIds.includes(zone.id)}
                  onChange={() => onToggleZone(zone.id)}
                />
                <span>{zone.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-[0.15em] text-[#8694AC]">
          Network ID
        </label>
        <input
          readOnly
          className="mt-2 w-full cursor-not-allowed rounded-md border border-[#DCE6F2] bg-white px-3 py-2.5 font-mono text-sm text-[#8694AC]"
          value={networkId || "—"}
        />
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-[0.15em] text-[#8694AC]">
          API Key
        </label>
        <input
          readOnly
          className="mt-2 w-full cursor-not-allowed rounded-md border border-[#DCE6F2] bg-white px-3 py-2.5 font-mono text-sm text-[#8694AC]"
          value={apiKey || "—"}
        />
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-[0.15em] text-[#8694AC]">
          Periodical check (sec)
        </label>
        <input
          className="mt-2 w-full rounded-md border border-[#DCE6F2] bg-white px-3 py-2.5 text-sm text-[#0F2C5C] focus:border-[#2F80ED] focus:outline-none focus:ring-2 focus:ring-[#2F80ED]/25"
          value={periodicalCheckSec}
          onChange={(e) => onPeriod(e.target.value)}
          placeholder="86400"
        />
        <p className="mt-1 text-xs text-[#8694AC]">
          Hint for hubs that poll instead of webhook push.
        </p>
      </div>
    </div>
  );
}

export default function DeviceManager() {
  const { user } = useAuth();
  const normalizedAccountType = normalizeAccountType(
    user?.accountType,
    user?.account_type,
  );
  const currentWebHid = useMemo(
    () => String(localStorage.getItem(WEB_DEVICE_HID_KEY) ?? "").toUpperCase(),
    [],
  );
  const isExclusiveAccount = normalizedAccountType === "EXCLUSIVE";
  const [devices, setDevices] = useState<Device[]>([]);
  const [registeredUsers, setRegisteredUsers] = useState<RegisteredUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawerDevice, setDrawerDevice] = useState<Device | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [heartbeatBusy, setHeartbeatBusy] = useState(false);
  const [deviceActionBusy, setDeviceActionBusy] = useState(false);
  const [form, setForm] = useState<DeviceFormState>({
    name: "",
    address: "",
    propagate_enabled: true,
    propagate_radius_km: 2.5,
    enable_notification: true,
    alert_threshold_meters: 100,
    update_interval_seconds: 30,
    webhook: "",
    periodical_check_sec: "86400",
    zone_ids: [],
  });
  const [zoneOptions, setZoneOptions] = useState<ZoneOption[]>([]);
  const [accountApiKey, setAccountApiKey] = useState("");
  const [hubCommand, setHubCommand] = useState("arm");
  const [hubCommands, setHubCommands] = useState<HubCommandRecord[]>([]);
  const [sendingCommand, setSendingCommand] = useState(false);
  const [commandResult, setCommandResult] = useState<{
    hid: string;
    text: string;
  } | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addForm, setAddForm] = useState({
    userId: "",
    hid: "",
    deviceName: "",
    address: "123 Main St, Anytown",
    latitude: 47.6205,
    longitude: -122.3493,
    propagate_enabled: true,
    propagate_radius_km: 2.5,
    enable_notification: true,
    alert_threshold_meters: 150,
    update_interval_seconds: 120,
    webhook: "",
    periodical_check_sec: "86400",
    zoneIds: [] as number[],
  });

  const loadRegisteredOwners = useCallback(async (): Promise<
    RegisteredUser[]
  > => {
    if (!user) {
      setRegisteredUsers([]);
      setUsersError(null);
      return [];
    }
    setUsersLoading(true);
    setUsersError(null);
    try {
      const result = await getMembers();
      const list = mapMembersToRegisteredUsers(result.data ?? []);
      setRegisteredUsers(list);
      return list;
    } catch {
      setRegisteredUsers([]);
      setUsersError(
        "Could not load registered users. Check your session and GET /members.",
      );
      return [];
    } finally {
      setUsersLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadRegisteredOwners();
  }, [loadRegisteredOwners]);

  useEffect(() => {
    void fetchZones()
      .then((data) => setZoneOptions(parseZoneOptions(data)))
      .catch(() => setZoneOptions([]));
    void getRemoteAppSettings().then((res) => {
      const key = res.data?.sharedNotification?.apiKey;
      if (typeof key === "string") setAccountApiKey(key);
    });
  }, []);

  const networkId = String(user?.zone_id ?? user?.zoneId ?? "").trim();
  const isNetworkAdmin =
    String(user?.role ?? "").toLowerCase() === "administrator" &&
    !isSystemAdministrator({
      role: user?.role,
      accountType: user?.accountType,
      legacyAccountType: user?.account_type,
    });

  useEffect(() => {
    if (!drawerDevice || !isSmartHomeHid(drawerDevice.hid) || !isNetworkAdmin) {
      setHubCommands([]);
      return;
    }
    const hid = drawerDevice.hid.toUpperCase();
    void listHubCommands().then((res) => {
      setHubCommands(
        (res.data ?? []).filter((row) => String(row.hid).toUpperCase() === hid),
      );
    });
  }, [drawerDevice, isNetworkAdmin]);

  const loadDevices = useCallback(() => {
    const refreshBrowser = currentWebHid
      ? fetchDevices()
          .then((list) => {
            const row = (Array.isArray(list) ? list : []).find(
              (device) =>
                String(device.hid).toUpperCase() === currentWebHid &&
                isClientSessionHid(device.hid),
            );
            if (!row?.id) return;
            return sendDeviceHeartbeat(row.id).then(() =>
              refreshSessionDevicePlace(row, user),
            );
          })
          .catch(() => undefined)
      : Promise.resolve();
    return refreshBrowser.then(() => fetchDevices())
      .then((data: DeviceResponse[]) => {
        const apiList = Array.isArray(data) ? data : [];
        const localList = loadLocalDevices();
        const merged = applyDeviceAssignments(
          mergeApiAndLocalDevices(apiList, localList) as Device[],
        );
        setDevices(merged as Device[]);
      })
      .catch(() => {
        const localList = loadLocalDevices();
        setDevices(
          applyDeviceAssignments(localList as unknown as Device[]) as Device[],
        );
      });
  }, [currentWebHid, user]);

  useEffect(() => {
    loadDevices().finally(() => setLoading(false));
  }, [loadDevices]);

  useEffect(() => {
    const id = window.setInterval(() => {
      loadDevices();
    }, 45_000);
    return () => window.clearInterval(id);
  }, [loadDevices]);

  const openSettings = useCallback(async (device: Device) => {
    setDrawerDevice(device);
    setSettingsError(null);
    setSettingsLoading(true);
    const defaults = defaultForm(device);
    const cached = getSettingsForHid(device.hid) as
      | CachedDeviceSettings
      | undefined;

    if (isLocalOnlyDevice(device)) {
      setForm({
        name: cached?.name ?? device.name ?? defaults.name,
        address: cached?.address ?? device.address ?? defaults.address,
        propagate_enabled:
          cached?.propagate_enabled ?? defaults.propagate_enabled,
        propagate_radius_km: Number(
          cached?.propagate_radius_km ?? defaults.propagate_radius_km,
        ),
        enable_notification:
          cached?.enable_notification ?? defaults.enable_notification,
        alert_threshold_meters: Number(
          cached?.alert_threshold_meters ?? defaults.alert_threshold_meters,
        ),
        update_interval_seconds: Number(
          cached?.update_interval_seconds ?? defaults.update_interval_seconds,
        ),
        webhook: cached?.webhook ?? defaults.webhook,
        periodical_check_sec:
          cached?.periodical_check_sec || defaults.periodical_check_sec,
        zone_ids: zoneIdsFrom(cached?.zone_ids ?? defaults.zone_ids),
      });
      setSettingsLoading(false);
      return;
    }

    try {
      const remote = await fetchDevice(device.id);
      setForm(remoteToForm(remote, device));
      setDrawerDevice({ ...device, ...remote });
    } catch {
      setForm({
        name: cached?.name ?? defaults.name,
        address: cached?.address ?? defaults.address,
        propagate_enabled:
          cached?.propagate_enabled ?? defaults.propagate_enabled,
        propagate_radius_km: Number(
          cached?.propagate_radius_km ?? defaults.propagate_radius_km,
        ),
        enable_notification:
          cached?.enable_notification ?? defaults.enable_notification,
        alert_threshold_meters: Number(
          cached?.alert_threshold_meters ?? defaults.alert_threshold_meters,
        ),
        update_interval_seconds: Number(
          cached?.update_interval_seconds ?? defaults.update_interval_seconds,
        ),
        webhook: cached?.webhook ?? defaults.webhook,
        periodical_check_sec:
          cached?.periodical_check_sec || defaults.periodical_check_sec,
        zone_ids: zoneIdsFrom(cached?.zone_ids ?? defaults.zone_ids),
      });
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!drawerDevice || isLocalOnlyDevice(drawerDevice)) return;
    const tick = window.setInterval(() => {
      fetchDevice(drawerDevice.id)
        .then((remote) => {
          setForm(remoteToForm(remote, drawerDevice));
          setDrawerDevice((d) =>
            d && d.id === drawerDevice.id ? { ...d, ...remote } : d,
          );
        })
        .catch(() => {});
    }, 12_000);
    return () => window.clearInterval(tick);
  }, [drawerDevice?.id]);

  const closeDrawer = () => {
    setDrawerDevice(null);
    setSettingsError(null);
  };

  const saveSettings = async () => {
    if (!drawerDevice) return;
    setSettingsSaving(true);
    setSettingsError(null);
    const payload: UpdateDevicePayload = {
      name: form.name.trim() || drawerDevice.name,
      address: form.address.trim() || undefined,
      propagate_enabled: form.propagate_enabled,
      propagate_radius_km: form.propagate_radius_km,
      enable_notification: form.enable_notification,
      alert_threshold_meters: form.alert_threshold_meters,
      update_interval_seconds: form.update_interval_seconds,
      ...(isSmartHomeHid(drawerDevice.hid)
        ? {
            webhook: form.webhook.trim(),
            periodical_check_sec: form.periodical_check_sec.trim() || "86400",
            zone_ids: form.zone_ids,
          }
        : {}),
    };

    if (isSmartHomeHid(drawerDevice.hid)) {
      if (!form.webhook.trim()) {
        setSettingsError("Enter the webhook URL for this hub.");
        setSettingsSaving(false);
        return;
      }
      if (form.zone_ids.length === 0) {
        setSettingsError("Select at least one zone for this hub.");
        setSettingsSaving(false);
        return;
      }
    }

    if (isLocalOnlyDevice(drawerDevice)) {
      try {
        setSettingsForHid(drawerDevice.hid, payload);
        updateLocalDevice(drawerDevice.hid, {
          name: payload.name ?? drawerDevice.name,
          updated_at: new Date().toISOString(),
        });
        setDevices((prev) =>
          prev.map((d) =>
            d.hid === drawerDevice.hid
              ? {
                  ...d,
                  name: payload.name ?? d.name,
                  address: payload.address ?? d.address,
                  propagate_enabled: payload.propagate_enabled,
                  propagate_radius_km: payload.propagate_radius_km,
                  enable_notification: payload.enable_notification,
                  alert_threshold_meters: payload.alert_threshold_meters,
                  update_interval_seconds: payload.update_interval_seconds,
                }
              : d,
          ),
        );
        setDrawerDevice((d) =>
          d && d.hid === drawerDevice.hid
            ? {
                ...d,
                name: payload.name ?? d.name,
                address: payload.address ?? d.address,
                propagate_enabled: payload.propagate_enabled,
                propagate_radius_km: payload.propagate_radius_km,
                enable_notification: payload.enable_notification,
                alert_threshold_meters: payload.alert_threshold_meters,
                update_interval_seconds: payload.update_interval_seconds,
              }
            : d,
        );
        closeDrawer();
      } catch {
        setSettingsError("Could not save settings to browser storage.");
      } finally {
        setSettingsSaving(false);
      }
      return;
    }

    try {
      const updated = await updateDevice(drawerDevice.id, payload);
      setSettingsForHid(drawerDevice.hid, payload);
      setDevices((prev) =>
        prev.map((d) => (d.id === drawerDevice.id ? { ...d, ...updated } : d)),
      );
      setDrawerDevice((d) =>
        d && d.id === drawerDevice.id ? { ...d, ...updated } : d,
      );
      closeDrawer();
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "response" in e
          ? String(
              (e as { response?: { data?: { detail?: string } } }).response
                ?.data?.detail,
            )
          : "Could not save settings. Use PATCH /devices/{device_id}.";
      setSettingsError(msg || "Could not save settings.");
    } finally {
      setSettingsSaving(false);
    }
  };

  const onSendHeartbeat = async () => {
    if (!drawerDevice || isLocalOnlyDevice(drawerDevice)) return;
    setHeartbeatBusy(true);
    setSettingsError(null);
    try {
      await sendDeviceHeartbeat(drawerDevice.id);
      await loadDevices();
      const fresh = await fetchDevice(drawerDevice.id);
      setDrawerDevice((d) =>
        d && d.id === drawerDevice.id ? { ...d, ...fresh } : d,
      );
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "response" in e
          ? String(
              (e as { response?: { data?: { detail?: string } } }).response
                ?.data?.detail,
            )
          : "Heartbeat failed.";
      setSettingsError(msg || "Could not send heartbeat.");
    } finally {
      setHeartbeatBusy(false);
    }
  };

  const onSignOutDevice = async () => {
    if (!drawerDevice || isLocalOnlyDevice(drawerDevice)) return;
    setDeviceActionBusy(true);
    setSettingsError(null);
    try {
      await signOutDevice(drawerDevice.id);
      await loadDevices();
      const fresh = await fetchDevice(drawerDevice.id);
      setDrawerDevice((d) =>
        d && d.id === drawerDevice.id ? { ...d, ...fresh } : d,
      );
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "response" in e
          ? String(
              (e as { response?: { data?: { detail?: string } } }).response
                ?.data?.detail,
            )
          : "Could not sign out device.";
      setSettingsError(msg || "Could not sign out device.");
    } finally {
      setDeviceActionBusy(false);
    }
  };

  const onRemoveDevice = async () => {
    if (!drawerDevice || isLocalOnlyDevice(drawerDevice)) return;
    const label = drawerDevice.name || drawerDevice.hid;
    if (
      !window.confirm(
        `Remove "${label}" from this account? The user can sign in on that device again later.`,
      )
    ) {
      return;
    }
    setDeviceActionBusy(true);
    setSettingsError(null);
    try {
      await removeDevice(drawerDevice.id);
      closeDrawer();
      await loadDevices();
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "response" in e
          ? String(
              (e as { response?: { data?: { detail?: string } } }).response
                ?.data?.detail,
            )
          : "Could not remove device.";
      setSettingsError(msg || "Could not remove device.");
    } finally {
      setDeviceActionBusy(false);
    }
  };

  const openAddModal = () => {
    setAddError(null);
    setModalOpen(true);
    void loadRegisteredOwners().then((list) => {
      const fallbackId =
        list[0]?.id ?? (user?.id != null ? String(user.id) : "");
      setAddForm({
        userId: fallbackId,
        hid: generateDeviceHid(),
        deviceName: "",
        address: "123 Main St, Anytown",
        latitude: 47.6205,
        longitude: -122.3493,
        propagate_enabled: true,
        propagate_radius_km: 2.5,
        enable_notification: true,
        alert_threshold_meters: 150,
        update_interval_seconds: 120,
        webhook: "",
        periodical_check_sec: "86400",
        zoneIds: [],
      });
    });
  };

  const closeAddModal = useCallback(() => {
    setModalOpen(false);
    setAddError(null);
  }, []);

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAddModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen, closeAddModal]);

  useEffect(() => {
    if (!modalOpen) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, [modalOpen]);

  const handleAddDevice = async () => {
    const ru =
      registeredUsers.find((u) => u.id === addForm.userId) ??
      (user?.id != null
        ? {
            id: String(user.id),
            displayName:
              `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() ||
              user.email ||
              `User ${user.id}`,
            email: String(user.email ?? ""),
          }
        : null);
    if (!ru) {
      setAddError("Select a registered user.");
      return;
    }
    const normalizedHid =
      normalizeDeviceHidInput(addForm.hid) ?? generateDeviceHid();
    if (
      devices.some((d) => d.hid.toLowerCase() === normalizedHid.toLowerCase())
    ) {
      setAddError("This Device ID is already in use.");
      return;
    }
    const deviceLimit = getDeviceLimit(normalizedAccountType);
    const smartHomeCount = devices.filter((d) => isSmartHomeHid(d.hid)).length;
    if (smartHomeCount >= deviceLimit) {
      setAddError(
        DEVICE_LIMIT_MESSAGE_BY_ACCOUNT[normalizedAccountType] ||
          "This account has reached its smart-home device limit.",
      );
      return;
    }
    const deviceLabel =
      addForm.deviceName.trim() ||
      `${(ru.displayName.split(/\s+/)[0] || "User").replace(/[^a-zA-Z]/g, "") || "User"} Device`;
    if (!addForm.webhook.trim()) {
      setAddError("Enter the webhook URL for this hub.");
      return;
    }
    if (addForm.zoneIds.length === 0) {
      setAddError("Select at least one zone for this hub.");
      return;
    }

    setAddSubmitting(true);
    setAddError(null);

    const createPayload: CreateDevicePayload = {
      hid: normalizedHid,
      name: deviceLabel,
      address: addForm.address.trim() || "123 Main St, Anytown",
      latitude: addForm.latitude,
      longitude: addForm.longitude,
      propagate_enabled: addForm.propagate_enabled,
      propagate_radius_km: addForm.propagate_radius_km,
      enable_notification: addForm.enable_notification,
      alert_threshold_meters: addForm.alert_threshold_meters,
      update_interval_seconds: addForm.update_interval_seconds,
      webhook: addForm.webhook.trim(),
      periodical_check_sec: addForm.periodical_check_sec.trim() || "86400",
      zone_ids: addForm.zoneIds,
      is_online: false,
      active: true,
    };

    const cachePayload: CachedDeviceSettings = {
      name: createPayload.name,
      address: createPayload.address,
      propagate_enabled: createPayload.propagate_enabled,
      propagate_radius_km: createPayload.propagate_radius_km,
      enable_notification: createPayload.enable_notification,
      alert_threshold_meters: createPayload.alert_threshold_meters,
      update_interval_seconds: createPayload.update_interval_seconds,
      webhook: createPayload.webhook,
      periodical_check_sec: createPayload.periodical_check_sec,
      zone_ids: createPayload.zone_ids,
    };

    try {
      await createDevice(createPayload);
      setDeviceAssignment(normalizedHid, {
        user_display_name: ru.displayName,
        user_email: ru.email,
      });
      setSettingsForHid(normalizedHid, cachePayload);
      await loadDevices();
      closeAddModal();
    } catch (e: unknown) {
      const detail =
        e && typeof e === "object" && "response" in e
          ? String(
              (
                e as {
                  response?: { data?: { detail?: string; message?: string } };
                }
              ).response?.data?.detail ??
                (
                  e as {
                    response?: { data?: { detail?: string; message?: string } };
                  }
                ).response?.data?.message ??
                "",
            )
          : "";
      const status =
        e && typeof e === "object" && "response" in e
          ? Number(
              (e as { response?: { status?: number } }).response?.status ?? 0,
            )
          : 0;
      if (
        status === 403 &&
        /max devices|device limit|limit|forbidden/i.test(detail || "403")
      ) {
        setAddError(
          detail ||
            DEVICE_LIMIT_MESSAGE_BY_ACCOUNT[normalizedAccountType] ||
            "Device limit reached for this account.",
        );
        return;
      }
      const localDev: LocalManagedDevice = {
        id: -Date.now(),
        hid: normalizedHid,
        name: deviceLabel,
        user_display_name: ru.displayName,
        user_email: ru.email,
        assigned_user_id: ru.id,
        active: true,
        updated_at: new Date().toISOString(),
        local_only: true,
      };
      appendLocalDevice(localDev);
      setDeviceAssignment(normalizedHid, {
        user_display_name: ru.displayName,
        user_email: ru.email,
      });
      setSettingsForHid(normalizedHid, cachePayload);
      await loadDevices();
      closeAddModal();
    } finally {
      setAddSubmitting(false);
    }
  };

  const sortedDevices = useMemo(() => {
    const withOwners = devices.map((device) => {
      const owner = ownerForDevice(device, registeredUsers);
      if (!owner) return device;
      return {
        ...device,
        user_display_name: owner.displayName,
        user_email: owner.email,
        owner_id: device.owner_id ?? Number(owner.id),
      };
    });

    const role = String(user?.role ?? "").toLowerCase();
    const currentUserId = String(user?.id ?? "");
    const roleScoped =
      (role === "user" || isExclusiveAccount) && currentUserId
        ? withOwners.filter(
            (device) =>
              String(device.owner_id ?? "") === currentUserId ||
              (!!currentWebHid &&
                String(device.hid ?? "").toUpperCase() === currentWebHid),
          )
        : withOwners;

    return [...roleScoped].sort((a, b) => {
      const dateA = new Date(a.last_seen || a.updated_at || 0).getTime();
      const dateB = new Date(b.last_seen || b.updated_at || 0).getTime();
      return dateB - dateA;
    });
  }, [
    devices,
    registeredUsers,
    user?.id,
    user?.role,
    isExclusiveAccount,
    currentWebHid,
  ]);

  const ownerUsernameSlug = useMemo(() => {
    if (!user?.first_name && !user?.last_name) return "";
    return slugUsername(
      `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim(),
    );
  }, [user?.first_name, user?.last_name]);

  const userRows = useMemo(() => {
    return sortedDevices.map((device) => {
      const personName =
        device.user_display_name?.trim() || device.name?.trim() || device.hid;
      const username = slugUsername(personName) || `device.${device.id}`;
      const email = device.user_email?.trim() || `${username}@geozone.io`;
      const ui = deriveUiStatus(device);
      const active = device.active;
      const ownerActive =
        typeof device.owner?.active === "boolean"
          ? device.owner.active
          : Boolean(active);
      const highlight =
        (!!user?.email &&
          device.user_email?.toLowerCase() === user.email.toLowerCase()) ||
        (!!ownerUsernameSlug && username === ownerUsernameSlug);
      return {
        key: device.id,
        username,
        email,
        deviceId: device.hid,
        zone: zoneLabel(device.h3_cell_id),
        active,
        ownerActive,
        highlight,
      };
    });
  }, [sortedDevices, ownerUsernameSlug, user?.email]);

  const drawerUiStatus: UiStatus | null = drawerDevice
    ? deriveUiStatus(drawerDevice)
    : null;
  const drawerIsThisBrowser =
    drawerDevice != null &&
    currentWebHid.length > 0 &&
    String(drawerDevice.hid).toUpperCase() === currentWebHid;

  const accountLabel =
    user?.accountType === "PRIVATE_PLUS" ||
    user?.account_type === "private_plus"
      ? "Private+"
      : user?.accountType === "ENHANCED_PLUS" ||
          user?.account_type === "enhanced_plus"
        ? "Enhanced+"
        : user?.accountType === "ENHANCED" || user?.account_type === "enhanced"
          ? "Enhanced"
          : user?.accountType === "EXCLUSIVE" ||
              user?.account_type === "exclusive"
            ? "Exclusive"
            : "Private";

  const warningCopy =
    accountLabel === "Private"
      ? `Private accounts allow 1 smart-home hub. Phones and browsers register as login sessions and do not use that slot. Zones use H3 Geospatial Indexing (resolution = ${H3_RESOLUTION}).`
      : accountLabel === "Private+"
        ? `Private+ accounts support 10 smart-home hubs. Phones and browsers are separate login sessions. Zones use H3 Geospatial Indexing (resolution = ${H3_RESOLUTION}).`
        : accountLabel === "Exclusive" || accountLabel === "Enhanced"
          ? `${accountLabel} accounts support 1 smart-home hub. Zones use H3 Geospatial Indexing (resolution = ${H3_RESOLUTION}).`
          : `Enhanced+ has no smart-home hub cap. Zones use H3 Geospatial Indexing (resolution = ${H3_RESOLUTION}).`;

  const smartHomeCount = devices.filter((d) => isSmartHomeHid(d.hid)).length;
  const smartHomeLimit = getDeviceLimit(normalizedAccountType);
  const atSmartHomeLimit =
    Number.isFinite(smartHomeLimit) && smartHomeCount >= smartHomeLimit;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[#DCE6F2] bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-[#0F2C5C]">
          Account &amp; Device Manager
        </h2>
        <p className="mt-1 text-sm text-[#8694AC]">
          Account type:{" "}
          <span className="font-semibold" style={{ color: ACCENT }}>
            {accountLabel}
          </span>
        </p>
      </section>

      <section className="layer-card border-[#E0992A]/40 bg-white">
        <div className="flex gap-4 text-sm leading-relaxed text-[#566784]">
          <AlertTriangle
            className="mt-0.5 h-5 w-5 shrink-0 text-[#E0992A]"
            strokeWidth={2}
            aria-hidden
          />
          <p>{warningCopy}</p>
        </div>
      </section>

      <section className="layer-card overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DCE6F2] px-6 py-4">
          <div className="flex items-center gap-2">
            <Smartphone
              className="h-5 w-5"
              style={{ color: ACCENT }}
              strokeWidth={2}
            />
            <div>
              <h2 className="text-lg font-semibold text-[#0F2C5C]">Devices</h2>
              <p className="text-xs text-[#8694AC]">
                {Number.isFinite(smartHomeLimit)
                  ? `${smartHomeCount} / ${smartHomeLimit} smart-home hubs`
                  : `${smartHomeCount} smart-home hubs`}{" "}
                · phones/browsers listed separately
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={openAddModal}
            disabled={atSmartHomeLimit}
            className="inline-flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: ACCENT }}
          >
            <Plus size={16} />
            Add smart-home device
          </button>
        </div>
        <div className="min-w-full overflow-x-auto">
          <table className="min-w-full divide-y divide-[#DCE6F2] text-sm text-[#566784]">
            <thead className="bg-[#F7FAFE] text-xs uppercase tracking-[0.2em] text-[#8694AC]">
              <tr>
                <th className="px-6 py-4 text-left font-medium">Device ID</th>
                <th className="px-6 py-4 text-left font-medium">Type</th>
                <th className="px-6 py-4 text-left font-medium">User</th>
                <th className="px-6 py-4 text-left font-medium">Status</th>
                <th className="px-6 py-4 text-left font-medium">Last seen</th>
                <th className="px-6 py-4 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DCE6F2]">
              {loading ? (
                <tr>
                  <td
                    className="px-6 py-10 text-center text-[#8694AC]"
                    colSpan={6}
                  >
                    Loading devices…
                  </td>
                </tr>
              ) : sortedDevices.length === 0 ? (
                <tr>
                  <td
                    className="px-6 py-10 text-center text-[#8694AC]"
                    colSpan={6}
                  >
                    No devices yet. Tap{" "}
                    <span className="font-semibold text-[#566784]">
                      Add smart-home device
                    </span>{" "}
                    to register a hub, or sign in on a phone/browser to register a
                    login session.
                  </td>
                </tr>
              ) : (
                sortedDevices.map((device) => {
                  const ui = deriveUiStatus(device);
                  const kind = isSmartHomeHid(device.hid)
                    ? "Smart home"
                    : isClientSessionHid(device.hid)
                      ? String(device.hid).toUpperCase().startsWith("WEB-")
                        ? "Browser"
                        : "Phone"
                      : "Smart home";
                  return (
                    <tr key={device.id} className="hover:bg-[#F7FAFE]">
                      <td className="px-6 py-4 font-mono text-sm text-[#0F2C5C]">
                        <span className="inline-flex items-center gap-2">
                          {isSmartHomeHid(device.hid) ? (
                            <Home size={14} style={{ color: ACCENT }} />
                          ) : (
                            <Smartphone size={14} style={{ color: ACCENT }} />
                          )}
                          {device.hid}
                        </span>
                        {isSmartHomeHid(device.hid) ? (
                          <p className="mt-1 max-w-xs truncate text-xs text-[#8694AC]">
                            {zoneIdsFrom(device.zone_ids).length} zone
                            {zoneIdsFrom(device.zone_ids).length === 1 ? "" : "s"}
                            {device.webhook ? ` · ${device.webhook}` : ""}
                          </p>
                        ) : null}
                        {commandResult?.hid === device.hid ? (
                          <p className="mt-1 max-w-xs text-xs text-[#566784]">
                            {commandResult.text}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-6 py-4 text-[#566784]">{kind}</td>
                      <td className="px-6 py-4 text-[#566784]">
                        {device.user_display_name?.trim() ||
                          device.name?.trim() ||
                          "—"}
                      </td>
                      <td className="px-6 py-4">
                        {isSmartHomeHid(device.hid) ? (
                          <span className="text-[#8694AC]">—</span>
                        ) : (
                          <span
                            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${statusBadgeClass(ui)}`}
                          >
                            <CircleDot size={12} /> {ui}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-[#8694AC]">
                        {formatLastSeen(device)}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap items-center gap-3">
                          {isSmartHomeHid(device.hid) ? (
                            <>
                              {(["arm", "disarm", "status"] as const).map((command) => (
                                <button
                                  key={command}
                                  type="button"
                                  disabled={sendingCommand}
                                  onClick={() => {
                                    setSendingCommand(true);
                                    void sendHubCommand(device.hid, command).then((result) => {
                                      setSendingCommand(false);
                                      if (result.error || !result.data) {
                                        const message = result.error || "Could not send the command.";
                                        setCommandResult({ hid: device.hid, text: message });
                                        uiToast.error(message, { title: command });
                                        return;
                                      }
                                      setHubCommands((prev) =>
                                        [result.data as HubCommandRecord, ...prev].slice(0, 8),
                                      );
                                      const detail = result.data.detail?.trim() || "";
                                      const text = `${result.data.command.toUpperCase()} · ${result.data.status}${
                                        detail ? ` · ${detail}` : ""
                                      }`;
                                      setCommandResult({ hid: device.hid, text });
                                      const title = command[0].toUpperCase() + command.slice(1);
                                      if (result.data.status === "sent") {
                                        uiToast.success(detail || text, { title });
                                      } else if (result.data.status === "no_reply") {
                                        uiToast.warning(detail || text, { title });
                                      } else {
                                        uiToast.error(detail || text, { title });
                                      }
                                    });
                                  }}
                                  className="text-sm font-semibold capitalize text-[#0F2C5C] transition hover:text-[#2F80ED] disabled:opacity-50"
                                >
                                  {command}
                                </button>
                              ))}
                            </>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => openSettings(device)}
                            className="text-sm font-semibold transition hover:brightness-125"
                            style={{ color: ACCENT }}
                          >
                            Settings
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="layer-card overflow-hidden p-0">
        <div className="border-b border-[#DCE6F2] px-6 py-4">
          <h2 className="text-lg font-semibold text-[#0F2C5C]">User information</h2>
          <p className="mt-1 text-sm text-[#8694AC]">
            Username, email, device assignment, status, and zone
          </p>
        </div>
        <div className="min-w-full overflow-x-auto">
          <table className="min-w-full divide-[#DCE6F2] text-sm text-[#566784]">
            <thead className="bg-[#F7FAFE] text-xs uppercase tracking-[0.2em] text-[#8694AC]">
              <tr>
                <th className="px-6 py-4 text-left font-medium">Username</th>
                <th className="px-6 py-4 text-left font-medium">Email</th>
                <th className="px-6 py-4 text-left font-medium">Device ID</th>
                <th className="px-6 py-4 text-left font-medium">Status</th>
                <th className="px-6 py-4 text-left font-medium">Zone</th>
              </tr>
            </thead>
            <tbody className="">
              {userRows.length === 0 ? (
                <tr>
                  <td
                    className="px-6 py-10 text-center text-[#8694AC]"
                    colSpan={5}
                  >
                    No users linked to devices yet.
                  </td>
                </tr>
              ) : (
                userRows.map((row) => (
                  <tr
                    key={row.key}
                    className={`hover:bg-[#F7FAFE] ${row.highlight ? "bg-[#EDF3FB] ring-1 ring-inset ring-[#2F80ED]/25" : ""}`}
                  >
                    <td className="px-6 py-4 font-mono text-sm text-[#0F2C5C]">
                      {row.username}
                    </td>
                    <td className="px-6 py-4 text-[#566784]">{row.email}</td>
                    <td className="px-6 py-4 font-mono text-sm text-[#566784]">
                      {row.deviceId}
                    </td>
                    <td
                      className={`px-6 py-4 ${userRowStatusClass(row.ownerActive)}`}
                    >
                      {row.ownerActive ? "active" : "inactive"}
                    </td>
                    <td
                      className="px-6 py-4 font-mono text-sm font-medium"
                      style={{ color: ACCENT }}
                    >
                      {row.zone}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto overscroll-contain p-4 !mt-0">
          <button
            type="button"
            className="fixed inset-0 bg-[#0F2C5C]/30 backdrop-blur-sm"
            aria-label="Close dialog"
            onClick={closeAddModal}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-device-title"
            className="relative z-10 my-auto w-full max-w-lg max-h-[min(90vh,calc(100dvh-2rem))] overflow-y-auto overscroll-contain rounded-2xl border border-[#DCE6F2] bg-white p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  id="add-device-title"
                  className="text-xl font-semibold text-[#0F2C5C]"
                >
                  Add smart-home device
                </h2>
                <p className="mt-1 text-sm text-[#8694AC]">
                  Register a hub with its own webhook and the zones that should
                  trigger it. Network ID and API key are shown so you can copy
                  them onto the device.
                </p>
              </div>
              <button
                type="button"
                onClick={closeAddModal}
                className="rounded-md p-2 text-[#8694AC] transition hover:bg-[#EDF3FB] hover:text-[#0F2C5C]"
                aria-label="Close"
              >
                <X size={22} />
              </button>
            </div>

            <div className="mt-6 space-y-5">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-[0.15em] text-[#8694AC]">
                  Registered user
                </label>
                {usersError && (
                  <p className="mt-2 rounded-md border border-[#E0992A]/40 bg-[#FBEFD8] px-3 py-2 text-sm text-[#E0992A]">
                    {usersError}
                  </p>
                )}
                <select
                  className="mt-2 w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2.5 text-sm text-[#0F2C5C] focus:border-[#2F80ED] focus:outline-none focus:ring-2 focus:ring-[#2F80ED]/25 disabled:cursor-not-allowed disabled:opacity-60"
                  value={addForm.userId}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, userId: e.target.value }))
                  }
                  disabled={usersLoading}
                >
                  {usersLoading ? (
                    <option value="">Loading users from database…</option>
                  ) : registeredUsers.length === 0 ? (
                    <option value={user?.id != null ? String(user.id) : ""}>
                      {user?.email
                        ? `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() ||
                          user.email
                        : "Current account"}
                    </option>
                  ) : (
                    registeredUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.displayName} ({u.email})
                      </option>
                    ))
                  )}
                </select>
                {!usersLoading &&
                  !usersError &&
                  registeredUsers.length === 0 && (
                    <p className="mt-2 text-xs text-[#8694AC]">
                      Hub will be registered under your account. Members list was
                      empty from{" "}
                      <code className="text-[#8694AC]">GET /members</code>.
                    </p>
                  )}
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-[0.15em] text-[#8694AC]">
                  Device ID
                </label>
                <div className="mt-2 flex gap-2">
                  <input
                    className="min-w-0 flex-1 rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2.5 font-mono text-sm text-[#0F2C5C] focus:border-[#2F80ED] focus:outline-none focus:ring-2 focus:ring-[#2F80ED]/25"
                    value={addForm.hid}
                    onChange={(e) =>
                      setAddForm((f) => ({ ...f, hid: e.target.value }))
                    }
                    placeholder="DEV-A1B2C3"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setAddForm((f) => ({ ...f, hid: generateDeviceHid() }))
                    }
                    className="shrink-0 rounded-md border border-[#E4ECF7] px-4 py-2.5 text-sm font-semibold text-[#566784] transition hover:border-[#2F80ED]/50 hover:text-[#2F80ED]"
                  >
                    Generate
                  </button>
                </div>
                <p className="mt-1 text-xs text-[#8694AC]">
                  Use Generate or enter an ID: prefix{" "}
                  <span className="font-mono text-[#8694AC]">DEV-</span> plus at
                  least 3 letters or numbers (e.g.{" "}
                  <span className="font-mono text-[#8694AC]">DEV-A1B2C3</span>
                  ).
                </p>
              </div>

              <AddressAutocompleteInput
                id="dm-add-address"
                label="Address"
                value={addForm.address}
                onChange={(addr, coords) => {
                  setAddForm((f) => ({
                    ...f,
                    address: addr,
                    ...(coords
                      ? { latitude: coords[0], longitude: coords[1] }
                      : {}),
                  }));
                }}
                required
                placeholder="Search for a street or place…"
                labelClassName={DM_ADDRESS_LABEL}
                inputClassName={DM_ADDRESS_INPUT}
                className="relative z-10"
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-[0.15em] text-[#8694AC]">
                    Latitude
                  </label>
                  <input
                    type="number"
                    step="any"
                    className="mt-2 w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2.5 text-sm text-[#0F2C5C] focus:border-[#2F80ED] focus:outline-none focus:ring-2 focus:ring-[#2F80ED]/25"
                    value={addForm.latitude}
                    onChange={(e) =>
                      setAddForm((f) => ({
                        ...f,
                        latitude: Number(e.target.value),
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-[0.15em] text-[#8694AC]">
                    Longitude
                  </label>
                  <input
                    type="number"
                    step="any"
                    className="mt-2 w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2.5 text-sm text-[#0F2C5C] focus:border-[#2F80ED] focus:outline-none focus:ring-2 focus:ring-[#2F80ED]/25"
                    value={addForm.longitude}
                    onChange={(e) =>
                      setAddForm((f) => ({
                        ...f,
                        longitude: Number(e.target.value),
                      }))
                    }
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-[0.15em] text-[#8694AC]">
                  Device name
                </label>
                <input
                  className="mt-2 w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2.5 text-sm text-[#0F2C5C] focus:border-[#2F80ED] focus:outline-none focus:ring-2 focus:ring-[#2F80ED]/25"
                  value={addForm.deviceName}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, deviceName: e.target.value }))
                  }
                  placeholder="e.g. Alex Device"
                />
              </div>

              <SmartHomeBindingFields
                webhook={addForm.webhook}
                periodicalCheckSec={addForm.periodical_check_sec}
                zoneIds={addForm.zoneIds}
                zones={zoneOptions}
                networkId={networkId}
                apiKey={accountApiKey}
                onWebhook={(value) =>
                  setAddForm((f) => ({ ...f, webhook: value }))
                }
                onPeriod={(value) =>
                  setAddForm((f) => ({ ...f, periodical_check_sec: value }))
                }
                onToggleZone={(zoneId) =>
                  setAddForm((f) => ({
                    ...f,
                    zoneIds: f.zoneIds.includes(zoneId)
                      ? f.zoneIds.filter((id) => id !== zoneId)
                      : [...f.zoneIds, zoneId],
                  }))
                }
              />

              <label className="flex cursor-pointer items-center gap-3 rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-4 py-3">
                <input
                  type="checkbox"
                  className="rounded border-[#E4ECF7] text-[#2F80ED] focus:ring-[#2F80ED]"
                  checked={addForm.propagate_enabled}
                  onChange={(e) =>
                    setAddForm((f) => ({
                      ...f,
                      propagate_enabled: e.target.checked,
                    }))
                  }
                />
                <span className="text-sm text-[#566784]">
                  Propagate enabled
                </span>
              </label>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-[0.15em] text-[#8694AC]">
                  Propagate radius (km)
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  className="mt-2 w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2.5 text-sm text-[#0F2C5C] focus:border-[#2F80ED] focus:outline-none focus:ring-2 focus:ring-[#2F80ED]/25"
                  value={addForm.propagate_radius_km}
                  onChange={(e) =>
                    setAddForm((f) => ({
                      ...f,
                      propagate_radius_km: Number(e.target.value) || 0,
                    }))
                  }
                />
              </div>

              <label className="flex cursor-pointer items-center gap-3 rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-4 py-3">
                <input
                  type="checkbox"
                  className="rounded border-[#E4ECF7] text-[#2F80ED] focus:ring-[#2F80ED]"
                  checked={addForm.enable_notification}
                  onChange={(e) =>
                    setAddForm((f) => ({
                      ...f,
                      enable_notification: e.target.checked,
                    }))
                  }
                />
                <span className="text-sm text-[#566784]">
                  Enable notification
                </span>
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-[0.15em] text-[#8694AC]">
                    Alert threshold (meters)
                  </label>
                  <input
                    type="number"
                    min={1}
                    className="mt-2 w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2.5 text-sm text-[#0F2C5C] focus:border-[#2F80ED] focus:outline-none focus:ring-2 focus:ring-[#2F80ED]/25"
                    value={addForm.alert_threshold_meters}
                    onChange={(e) =>
                      setAddForm((f) => ({
                        ...f,
                        alert_threshold_meters: Number(e.target.value) || 0,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-[0.15em] text-[#8694AC]">
                    Update interval (seconds)
                  </label>
                  <input
                    type="number"
                    min={5}
                    className="mt-2 w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2.5 text-sm text-[#0F2C5C] focus:border-[#2F80ED] focus:outline-none focus:ring-2 focus:ring-[#2F80ED]/25"
                    value={addForm.update_interval_seconds}
                    onChange={(e) =>
                      setAddForm((f) => ({
                        ...f,
                        update_interval_seconds: Number(e.target.value) || 0,
                      }))
                    }
                  />
                </div>
              </div>

              {addError && (
                <p className="rounded-md border border-[#E0992A]/40 bg-[#FBEFD8] px-3 py-2 text-sm text-[#E0992A]">
                  {addError}
                </p>
              )}

              <div className="flex flex-wrap justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeAddModal}
                  className="rounded-md border border-[#E4ECF7] px-5 py-2.5 text-sm font-semibold text-[#566784] transition hover:border-[#C5D4E8]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={addSubmitting || usersLoading}
                  onClick={handleAddDevice}
                  className="rounded-md px-5 py-2.5 text-sm font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ backgroundColor: ACCENT }}
                >
                  {addSubmitting ? "Saving…" : "Save smart-home device"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {drawerDevice && (
        <div className="fixed inset-0 z-50 flex justify-end !mt-0">
          <button
            type="button"
            className="absolute inset-0 bg-[#0F2C5C]/30 backdrop-blur-sm"
            aria-label="Close settings"
            onClick={closeDrawer}
          />
          <aside
            className="relative flex h-full w-full max-w-md flex-col border-l border-[#DCE6F2] bg-white shadow-2xl"
            role="dialog"
            aria-labelledby="device-settings-title"
          >
            <div className="flex items-center justify-between gap-4 border-b border-[#DCE6F2] px-5 py-4">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#DCE6F2] bg-[#F7FAFE]"
                  style={{ color: ACCENT }}
                >
                  <Smartphone size={20} strokeWidth={2} />
                </div>
                <h2
                  id="device-settings-title"
                  className="text-lg font-semibold text-[#0F2C5C]"
                >
                  Device Settings
                </h2>
              </div>
              <button
                type="button"
                onClick={closeDrawer}
                className="rounded-md p-2 text-[#8694AC] transition hover:bg-[#EDF3FB] hover:text-[#0F2C5C]"
                aria-label="Close"
              >
                <X size={22} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-6">
              {settingsLoading ? (
                <p className="text-sm text-[#8694AC]">Loading settings…</p>
              ) : (
                <div className="space-y-5">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-[0.15em] text-[#8694AC]">
                      Device ID
                    </label>
                    <input
                      readOnly
                      className="mt-2 w-full cursor-not-allowed rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2.5 font-mono text-sm text-[#8694AC]"
                      value={drawerDevice.hid}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-[0.15em] text-[#8694AC]">
                      Owner
                    </label>
                    <p className="mt-2 text-sm text-[#566784]">
                      {drawerDevice.owner
                        ? `${drawerDevice.owner.first_name ?? ""} ${drawerDevice.owner.last_name ?? ""}`.trim() ||
                          drawerDevice.owner.email ||
                          `User ${drawerDevice.owner.id}`
                        : "—"}
                    </p>
                    {drawerDevice.owner?.email && (
                      <p className="text-xs text-[#8694AC]">
                        {drawerDevice.owner.email}
                      </p>
                    )}
                    {drawerDevice.owner?.account_type && (
                      <p className="text-xs text-[#8694AC]">
                        {String(drawerDevice.owner.role ?? "user")} ·{" "}
                        {drawerDevice.owner.account_type}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-[0.15em] text-[#8694AC]">
                      Device name
                    </label>
                    <input
                      className="mt-2 w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2.5 text-sm text-[#0F2C5C] ring-[#2F80ED]/25 focus:border-[#2F80ED] focus:outline-none focus:ring-2"
                      value={form.name}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, name: e.target.value }))
                      }
                    />
                  </div>
                  <AddressAutocompleteInput
                    id="dm-settings-address"
                    label="Address"
                    value={form.address}
                    onChange={(addr) => {
                      setForm((f) => ({ ...f, address: addr }));
                    }}
                    placeholder="Search for a street or place…"
                    labelClassName={DM_ADDRESS_LABEL}
                    inputClassName={DM_ADDRESS_INPUT}
                    className="relative z-10"
                  />
                  {isSmartHomeHid(drawerDevice.hid) ? (
                    <>
                      <SmartHomeBindingFields
                        webhook={form.webhook}
                        periodicalCheckSec={form.periodical_check_sec}
                        zoneIds={form.zone_ids}
                        zones={zoneOptions}
                        networkId={networkId}
                        apiKey={accountApiKey}
                        onWebhook={(value) =>
                          setForm((f) => ({ ...f, webhook: value }))
                        }
                        onPeriod={(value) =>
                          setForm((f) => ({ ...f, periodical_check_sec: value }))
                        }
                        onToggleZone={(zoneId) =>
                          setForm((f) => ({
                            ...f,
                            zone_ids: f.zone_ids.includes(zoneId)
                              ? f.zone_ids.filter((id) => id !== zoneId)
                              : [...f.zone_ids, zoneId],
                          }))
                        }
                      />
                      {isNetworkAdmin ? (
                        <div className="rounded-md border border-[#DCE6F2] bg-[#F7FAFE] p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#8694AC]">
                            Send command
                          </p>
                          <p className="mt-1 text-xs text-[#8694AC]">
                            Arm, disarm, or ask this hub for status. Save the
                            webhook first if you just changed it.
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <select
                              value={hubCommand}
                              onChange={(event) => setHubCommand(event.target.value)}
                              disabled={sendingCommand}
                              className="rounded-md border border-[#DCE6F2] bg-white px-3 py-2 text-sm text-[#0F2C5C]"
                            >
                              <option value="arm">Arm</option>
                              <option value="disarm">Disarm</option>
                              <option value="status">Status</option>
                            </select>
                            <button
                              type="button"
                              disabled={sendingCommand}
                              onClick={() => {
                                setSendingCommand(true);
                                void sendHubCommand(drawerDevice.hid, hubCommand).then(
                                  (result) => {
                                    setSendingCommand(false);
                                    if (result.error || !result.data) {
                                      const message =
                                        result.error || "Could not send the command.";
                                      setSettingsError(message);
                                      uiToast.error(message, { title: "Command" });
                                      return;
                                    }
                                    setHubCommands((prev) =>
                                      [result.data as HubCommandRecord, ...prev].slice(0, 8),
                                    );
                                    const detail = result.data.detail?.trim() || "";
                                    const title =
                                      result.data.command[0]?.toUpperCase() +
                                      result.data.command.slice(1);
                                    if (result.data.status === "sent") {
                                      uiToast.success(detail || "Command sent.", { title });
                                    } else if (result.data.status === "no_reply") {
                                      uiToast.warning(detail || "The hub did not reply.", {
                                        title,
                                      });
                                    } else {
                                      uiToast.error(detail || "Command failed.", { title });
                                    }
                                  },
                                );
                              }}
                              className="rounded-md bg-[#2F80ED] px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
                            >
                              {sendingCommand ? "Sending…" : "Send"}
                            </button>
                          </div>
                          {hubCommands.length > 0 ? (
                            <ul className="mt-3 space-y-1 text-xs text-[#566784]">
                              {hubCommands.map((row) => (
                                <li key={row.id}>
                                  {row.command.toUpperCase()} · {row.status}
                                  {row.detail ? ` · ${row.detail}` : ""}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  <label className="flex cursor-pointer items-center gap-3 rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-4 py-3">
                    <input
                      type="checkbox"
                      className="rounded border-[#E4ECF7] text-[#2F80ED] focus:ring-[#2F80ED]"
                      checked={form.propagate_enabled}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          propagate_enabled: e.target.checked,
                        }))
                      }
                    />
                    <span className="text-sm text-[#566784]">
                      Propagate enabled
                    </span>
                  </label>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-[0.15em] text-[#8694AC]">
                      Propagate radius (km)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      className="mt-2 w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2.5 text-sm text-[#0F2C5C] focus:border-[#2F80ED] focus:outline-none focus:ring-2 focus:ring-[#2F80ED]/25"
                      value={form.propagate_radius_km}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          propagate_radius_km: Number(e.target.value) || 0,
                        }))
                      }
                    />
                  </div>
                  <label className="flex cursor-pointer items-center gap-3 rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-4 py-3">
                    <input
                      type="checkbox"
                      className="rounded border-[#E4ECF7] text-[#2F80ED] focus:ring-[#2F80ED]"
                      checked={form.enable_notification}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          enable_notification: e.target.checked,
                        }))
                      }
                    />
                    <span className="text-sm text-[#566784]">
                      Enable notification
                    </span>
                  </label>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-[0.15em] text-[#8694AC]">
                      Alert threshold (meters)
                    </label>
                    <input
                      type="number"
                      min={1}
                      className="mt-2 w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2.5 text-sm text-[#0F2C5C] focus:border-[#2F80ED] focus:outline-none focus:ring-2 focus:ring-[#2F80ED]/25"
                      value={form.alert_threshold_meters}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          alert_threshold_meters: Number(e.target.value) || 0,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-[0.15em] text-[#8694AC]">
                      Update interval (seconds)
                    </label>
                    <input
                      type="number"
                      min={5}
                      className="mt-2 w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2.5 text-sm text-[#0F2C5C] focus:border-[#2F80ED] focus:outline-none focus:ring-2 focus:ring-[#2F80ED]/25"
                      value={form.update_interval_seconds}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          update_interval_seconds: Number(e.target.value) || 0,
                        }))
                      }
                    />
                  </div>
                  {settingsError && (
                    <p className="rounded-md border border-[#E0992A]/40 bg-[#FBEFD8] px-3 py-2 text-sm text-[#E0992A]">
                      {settingsError}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="border-t border-[#DCE6F2] px-5 py-4">
              {isSmartHomeHid(drawerDevice.hid) ? null : (
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                  <div>
                    <span className="text-[#8694AC]">Status </span>
                    <span
                      className={
                        drawerUiStatus === "online"
                          ? "font-medium text-[#2FA24A]"
                          : drawerUiStatus === "error"
                            ? "font-medium text-[#E0992A]"
                            : "font-medium text-[#8694AC]"
                      }
                    >
                      {drawerUiStatus}
                    </span>
                  </div>
                  <div className="text-[#8694AC]">
                    Last seen: {formatLastSeen(drawerDevice)}
                  </div>
                </div>
              )}
              {!isLocalOnlyDevice(drawerDevice) && !isSmartHomeHid(drawerDevice.hid) && (
                <button
                  type="button"
                  disabled={heartbeatBusy || settingsLoading}
                  onClick={onSendHeartbeat}
                  className="mt-3 w-full rounded-md border border-[#E4ECF7] py-2.5 text-sm font-semibold text-[#566784] transition hover:border-[#2F80ED]/50 hover:text-[#2F80ED] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {heartbeatBusy ? "Sending heartbeat…" : "Send heartbeat"}
                </button>
              )}
              {!isLocalOnlyDevice(drawerDevice) && !drawerIsThisBrowser ? (
                <div className="mt-3 flex gap-2">
                  {drawerUiStatus === "online" && !isSmartHomeHid(drawerDevice.hid) ? (
                    <button
                      type="button"
                      disabled={deviceActionBusy || settingsLoading}
                      onClick={() => void onSignOutDevice()}
                      className="flex-1 rounded-md border border-[#E4ECF7] py-2.5 text-sm font-semibold text-[#566784] transition hover:border-[#2F80ED]/50 hover:text-[#2F80ED] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {deviceActionBusy ? "Working…" : "Sign out device"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={deviceActionBusy || settingsLoading}
                    onClick={() => void onRemoveDevice()}
                    className="flex-1 rounded-md border border-[#E23B4E]/30 py-2.5 text-sm font-semibold text-[#E23B4E] transition hover:border-[#E23B4E]/60 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {deviceActionBusy ? "Working…" : "Remove device"}
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                disabled={settingsSaving || settingsLoading}
                onClick={saveSettings}
                className="mt-3 w-full rounded-md py-3 text-sm font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                style={{ backgroundColor: ACCENT }}
              >
                {settingsSaving ? "Saving…" : "Save settings"}
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
