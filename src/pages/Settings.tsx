import { useEffect, useMemo, useState } from "react";
import { Home, Megaphone, BellRing, Loader2, Settings as SettingsIcon } from "lucide-react";
import {
  QUICK_MESSAGE_LABELS,
  QUICK_MESSAGE_TYPES,
  updateAppSettings,
  useAppSettings,
  type AppSettings,
} from "../lib/appSettings";
import { getRemoteAppSettings, updateRemoteAppSettings } from "../services/api";
import { getZoneAreaLimits, updateZoneAreaLimits, type ZoneSizeRule } from "../services/api/zones";
import {
  getDevices,
  listHubCommands,
  sendHubCommand,
  type HubCommandRecord,
} from "../services/api/devices";
import { useAuth } from "../hooks/useAuth";
import { isSystemAdministrator } from "../lib/accountLimits";
import { isSmartHomeHid } from "../lib/deviceSync";
import { AddressAutocompleteInput } from "../components/AddressAutocompleteInput";
import AddressMapPreview from "../components/AddressMapPreview";
import { addressToMockCoords, getHexGrid, type H3Cell } from "../lib/h3";
import { searchPhotonAddresses } from "../lib/addressSearch";

const settingsLabelClass =
  "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#566784]";
const settingsInputClass =
  "w-full rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm text-[#0F2C5C] outline-none transition focus:border-[#2F80ED]";

function Field({
  label,
  value,
  onChange,
  placeholder,
  textarea,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  textarea?: boolean;
  disabled?: boolean;
}) {
  const baseClass =
    "w-full rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm text-[#0F2C5C] outline-none transition focus:border-[#2F80ED]";
  const disabledClass =
    "w-full rounded-lg border border-[#E3EAF3] bg-[#EEF2F7] px-3 py-2 text-sm text-[#8694AC] outline-none cursor-not-allowed";
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
        {label}
      </span>
      {textarea ? (
        <textarea
          rows={2}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={disabled ? disabledClass : baseClass}
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={disabled ? disabledClass : baseClass}
        />
      )}
    </label>
  );
}

const AREA_ACCOUNTS = [
  { value: "private_plus", label: "Family" },
  { value: "exclusive", label: "Individual" },
  { value: "enhanced", label: "Individual Pro" },
  { value: "enhanced_plus", label: "Organization" },
] as const;

type AreaUnit = "m2" | "km2";
type AreaDraft = {
  account_type: string;
  role: "administrator" | "user";
  eachInput: string;
  eachUnit: AreaUnit;
  totalInput: string;
  totalUnit: AreaUnit;
};

function emptyAreaRules(): AreaDraft[] {
  return AREA_ACCOUNTS.flatMap((account) =>
    (["administrator", "user"] as const).map((role) => ({
      account_type: account.value,
      role,
      eachInput: "",
      eachUnit: "km2" as const,
      totalInput: "",
      totalUnit: "km2" as const,
    })),
  );
}

function shownArea(m2: number | null, unit: string): string {
  if (m2 == null) return "";
  return String(unit === "km2" ? m2 / 1_000_000 : m2);
}

function areaDraftFromRule(rule: ZoneSizeRule): AreaDraft {
  const eachUnit: AreaUnit = rule.each_unit === "m2" ? "m2" : "km2";
  const totalUnit: AreaUnit = rule.total_unit === "m2" ? "m2" : "km2";
  return {
    account_type: rule.account_type,
    role: rule.role === "administrator" ? "administrator" : "user",
    eachInput: shownArea(rule.each_zone_m2, eachUnit),
    eachUnit,
    totalInput: shownArea(rule.total_m2, totalUnit),
    totalUnit,
  };
}

function convertAreaInput(raw: string, from: AreaUnit, to: AreaUnit): string {
  if (from === to || !raw.trim()) return raw;
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw;
  return String(from === "km2" ? value * 1_000_000 : value / 1_000_000);
}

function patchAreaRule(
  accountType: string,
  role: "administrator" | "user",
  patch: Partial<AreaDraft>,
  setRules: (update: (current: AreaDraft[]) => AreaDraft[]) => void,
) {
  setRules((current) =>
    current.map((rule) =>
      rule.account_type === accountType && rule.role === role ? { ...rule, ...patch } : rule,
    ),
  );
}

function areaRuleFromDraft(draft: AreaDraft): ZoneSizeRule | null {
  const toM2 = (raw: string, unit: AreaUnit) => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const value = Number(trimmed);
    if (!Number.isFinite(value) || value <= 0) return Number.NaN;
    return unit === "km2" ? value * 1_000_000 : value;
  };
  const each = toM2(draft.eachInput, draft.eachUnit);
  const total = toM2(draft.totalInput, draft.totalUnit);
  if (Number.isNaN(each) || Number.isNaN(total)) return null;
  return {
    account_type: draft.account_type,
    role: draft.role,
    each_zone_m2: each,
    each_unit: draft.eachUnit,
    total_m2: total,
    total_unit: draft.totalUnit,
  };
}

function LimitPair({
  label,
  value,
  unit,
  onValue,
  onUnit,
}: {
  label: string;
  value: string;
  unit: AreaUnit;
  onValue: (value: string) => void;
  onUnit: (unit: AreaUnit) => void;
}) {
  return (
    <label className="mb-3 block">
      <span className={settingsLabelClass}>{label}</span>
      <span className="flex gap-2">
        <input
          value={value}
          onChange={(event) => onValue(event.target.value)}
          placeholder="No limit"
          className={settingsInputClass}
        />
        <select
          aria-label={`${label} unit`}
          value={unit}
          onChange={(event) => onUnit(event.target.value as AreaUnit)}
          className="w-24 shrink-0 rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-2 py-2 text-sm font-semibold text-[#0F2C5C] outline-none transition focus:border-[#2F80ED]"
        >
          <option value="km2">km²</option>
          <option value="m2">m²</option>
        </select>
      </span>
    </label>
  );
}

export default function Settings() {
  const { user, refreshUser } = useAuth();
  const accountName = (user?.name ?? "").trim();
  const settings = useAppSettings();
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [hubs, setHubs] = useState<
    Array<{ hid: string; name: string; active: boolean }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hubCommand, setHubCommand] = useState("arm");
  const [hubCommands, setHubCommands] = useState<HubCommandRecord[]>([]);
  const [sendingCommand, setSendingCommand] = useState(false);
  const [areaAccount, setAreaAccount] = useState("private_plus");
  const [areaRules, setAreaRules] = useState<AreaDraft[]>(() => emptyAreaRules());
  const [savingLimits, setSavingLimits] = useState(false);
  const isSystemAdmin = isSystemAdministrator({
    role: user?.role,
    accountType: user?.accountType,
    legacyAccountType: user?.account_type,
  });
  const isNetworkAdmin =
    String(user?.role ?? "").toLowerCase() === "administrator" && !isSystemAdmin;
  /** Real [lat, lng] for the map — from the owner's home, a picked suggestion, or geocoding the typed address. */
  const [addressCoords, setAddressCoords] = useState<[number, number] | null>(
    null,
  );

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const ownerId = String(user?.id ?? "").trim();
      const [res, devicesRes, commandRes] = await Promise.all([
        getRemoteAppSettings(),
        getDevices(),
        isNetworkAdmin ? listHubCommands() : Promise.resolve({ data: [] as HubCommandRecord[], error: null }),
      ]);
      if (!mounted) return;
      setHubCommands(commandRes.data ?? []);

      const fromSettings = (res.data?.smartHomeDevices ?? [])
        .filter((d) => typeof d.hid === "string" && d.hid.trim())
        .map((d) => ({
          hid: d.hid.trim(),
          name: (d.name ?? d.hid).trim() || d.hid.trim(),
          active: d.active !== false,
        }));

      const deviceRows = Array.isArray(devicesRes.data) ? devicesRes.data : [];
      const allSmartHomes = deviceRows
        .filter((d) => isSmartHomeHid(d.hid))
        .map((d) => ({
          hid: String(d.hid).trim(),
          name: (d.name ?? d.hid).trim() || String(d.hid).trim(),
          active: d.active !== false,
        }));
      const owned = ownerId
        ? deviceRows
            .filter((d) => {
              if (!isSmartHomeHid(d.hid)) return false;
              return (
                String(d.owner_id ?? d.owner?.id ?? "").trim() === ownerId
              );
            })
            .map((d) => ({
              hid: String(d.hid).trim(),
              name: (d.name ?? d.hid).trim() || String(d.hid).trim(),
              active: d.active !== false,
            }))
        : allSmartHomes;
      const fromDevices = owned.length > 0 ? owned : allSmartHomes;

      const byHid = new Map<string, { hid: string; name: string; active: boolean }>();
      for (const hub of [...fromSettings, ...fromDevices]) {
        const key = hub.hid.toUpperCase();
        if (!key || !isSmartHomeHid(hub.hid)) continue;
        const prev = byHid.get(key);
        byHid.set(key, {
          hid: prev?.hid ?? hub.hid,
          name: hub.name || prev?.name || hub.hid,
          active: hub.active && (prev?.active ?? true),
        });
      }
      const mergedHubs = [...byHid.values()].sort((a, b) =>
        a.hid.localeCompare(b.hid),
      );

      if (res.data) {
        const remoteSn = res.data.sharedNotification ?? {};
        let hid =
          typeof remoteSn.hid === "string" ? remoteSn.hid.trim() : "";
        if (!isSmartHomeHid(hid)) hid = "";
        if (!hid && mergedHubs[0]) hid = mergedHubs[0].hid;
        if (
          hid &&
          mergedHubs.length > 0 &&
          !mergedHubs.some((h) => h.hid.toUpperCase() === hid.toUpperCase())
        ) {
          hid = mergedHubs[0].hid;
        }
        const merged = updateAppSettings({
          ...res.data,
          sharedNotification: {
            ...remoteSn,
            hid,
          },
        } as Partial<AppSettings>);
        setHubs(mergedHubs);
        setDraft(merged);
      } else if (res.error) {
        setError(res.error);
        if (mergedHubs.length) setHubs(mergedHubs);
      }
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [user?.id, isNetworkAdmin]);

  useEffect(() => {
    if (!isSystemAdmin) return;
    let mounted = true;
    void getZoneAreaLimits().then((result) => {
      if (!mounted || !result.data?.rules?.length) return;
      setAreaRules(result.data.rules.map(areaDraftFromRule));
    });
    return () => {
      mounted = false;
    };
  }, [isSystemAdmin]);

  // Seed the map from the owner's geocoded home address (from /me) on first load.
  useEffect(() => {
    if (addressCoords) return;
    const c = user?.mapCenter;
    if (c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude)) {
      setAddressCoords([c.latitude, c.longitude]);
    }
  }, [user?.mapCenter, addressCoords]);

  // Keep the map in sync with the address text: debounce-geocode whatever is in
  // the field so the preview follows manual edits, not just picked suggestions.
  useEffect(() => {
    const q = draft.address.trim();
    if (q.length < 3) return;
    const ac = new AbortController();
    const timer = window.setTimeout(() => {
      void searchPhotonAddresses(q, ac.signal)
        .then((features) => {
          const first = features[0];
          if (!first) return;
          const [lon, lat] = first.geometry.coordinates;
          setAddressCoords([lat, lon]);
        })
        .catch((err: Error) => {
          if (err.name !== "AbortError") {
            /* keep the last known coords on geocode failure */
          }
        });
    }, 500);
    return () => {
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [draft.address]);

  const mapCenter = useMemo<[number, number]>(
    () => addressCoords ?? addressToMockCoords(draft.address),
    [addressCoords, draft.address],
  );
  const mapGrid = useMemo<H3Cell[]>(
    () => getHexGrid(mapCenter, 9, 1),
    [mapCenter],
  );

  const update = (patch: Partial<AppSettings>) => {
    setSaved(false);
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const onSave = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    const res = await updateRemoteAppSettings(draft);
    if (res.error) {
      setError(res.error);
      setSaving(false);
      return;
    }
    const merged = updateAppSettings((res.data as Partial<AppSettings>) ?? draft);
    if (res.data?.smartHomeDevices) {
      setHubs(
        res.data.smartHomeDevices
          .filter((d) => typeof d.hid === "string" && d.hid.trim())
          .map((d) => ({
            hid: d.hid.trim(),
            name: (d.name ?? d.hid).trim() || d.hid.trim(),
            active: d.active !== false,
          })),
      );
    }
    setDraft(merged);
    setSaved(true);
    void refreshUser();
    setSaving(false);
  };

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-[#DCE6F2] bg-white p-6 shadow-sm">
        <span className="inline-flex items-center gap-2 rounded-full bg-[#EDF3FB] px-4 py-2 text-sm font-medium text-[#2F80ED]">
          <SettingsIcon className="h-4 w-4" /> Hardware configuration
        </span>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#566784]">
          Configure your broadcast identity, address, smart-home integration,
          and the pre-programmed quick-alert messages.
        </p>
        {loading ? (
          <p className="mt-3 inline-flex items-center gap-2 text-sm text-[#8694AC]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your settings…
          </p>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-[#DCE6F2] bg-white p-5 shadow-sm">
          <div className="mb-1 flex items-center gap-2 text-lg font-bold text-[#0F2C5C]">
            <Home className="h-5 w-5 text-[#2F80ED]" /> Your Address
          </div>
          <p className="mb-4 text-sm text-[#566784]">
            Your neighbours will only see your Broadcast Name. Leave it blank to
            use your account name{accountName ? ` (${accountName})` : ""} in
            messages.
          </p>
          <div className="space-y-3">
            <Field
              label="Broadcast Name"
              value={draft.broadcastName}
              onChange={(v) => update({ broadcastName: v })}
              placeholder={accountName || "THE BLACK GUY"}
            />
            <AddressAutocompleteInput
              id="settings-address"
              label="Address"
              value={draft.address}
              onChange={(addr, coords) => {
                update({ address: addr });
                if (coords) setAddressCoords(coords);
              }}
              placeholder="169 Fred Young Drive, Toronto, Ontario, M3L 0A6"
              labelClassName={settingsLabelClass}
              inputClassName={settingsInputClass}
              className="relative"
            />
            <p className="-mt-1 text-xs text-[#8694AC]">
              Start typing and pick a suggestion to set your home address.
            </p>
          </div>
          <div className="mt-4">
            <span className={settingsLabelClass}>Map preview</span>
            <AddressMapPreview
              center={mapCenter}
              grid={mapGrid}
              addressLabel={draft.address || undefined}
              className="h-64 w-full"
            />
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={loading || saving}
              className="inline-flex items-center gap-2 rounded-lg bg-[#2F80ED] px-5 py-2 text-sm font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                </>
              ) : (
                "Update address & broadcast name"
              )}
            </button>
            {saved ? (
              <span className="text-sm text-[#2FA24A]">Saved.</span>
            ) : null}
          </div>
        </div>

        <div className="rounded-2xl border border-[#DCE6F2] bg-white p-5 shadow-sm">
          <div className="mb-1 flex items-center gap-2 text-lg font-bold text-[#0F2C5C]">
            <Megaphone className="h-5 w-5 text-[#2F80ED]" /> Smart-home integration
          </div>
          <p className="mb-4 text-sm text-[#566784]">
            First add smart-home hubs on Device Manager (DEV- ID). Select which
            hub this account uses for integration, then copy the API key and
            Network ID onto that hub. Paste a public webhook URL to receive
            Alarm/Alert messages from this network only. Leave webhook blank if
            the hub only polls.
          </p>
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
                Hardware Identification (HID)
              </span>
              {hubs.length > 0 ? (
                <select
                  value={draft.sharedNotification.hid || hubs[0].hid}
                  onChange={(e) =>
                    update({
                      sharedNotification: {
                        ...draft.sharedNotification,
                        hid: e.target.value,
                      },
                    })
                  }
                  disabled={loading || saving}
                  className={settingsInputClass}
                >
                  {hubs.map((hub) => (
                    <option key={hub.hid} value={hub.hid}>
                      {hub.name && hub.name !== hub.hid
                        ? `${hub.name} (${hub.hid})`
                        : hub.hid}
                      {hub.active ? "" : " · inactive"}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value="No smart-home hub yet"
                  disabled
                  className="w-full rounded-lg border border-[#E3EAF3] bg-[#EEF2F7] px-3 py-2 text-sm text-[#8694AC] outline-none cursor-not-allowed"
                />
              )}
            </label>
            <p className="-mt-1 text-xs text-[#8694AC]">
              {hubs.length > 1
                ? "Choose which registered hub to use. Add more hubs in Device Manager."
                : hubs.length === 1
                  ? "Your registered smart-home hub. Add more in Device Manager if your account allows it."
                  : "Register a hub in Device Manager first."}
            </p>
            <Field
              label="Network ID"
              value={draft.sharedNotification.networkId}
              onChange={() => {}}
              placeholder="ZONE-ABC123"
              disabled
            />
            <p className="-mt-1 text-xs text-[#8694AC]">
              Assigned to your account. Copy this onto the hub; it cannot be
              changed here. Your hub only receives alarms from this network.
            </p>
            <Field
              label="API Key"
              value={draft.sharedNotification.apiKey}
              onChange={() => {}}
              placeholder="66c5b8a0-e30c-…"
              disabled
            />
            <p className="-mt-1 text-xs text-[#8694AC]">
              Authenticates the smart-home device when talking to the server.
            </p>
            <Field
              label="Webhook"
              value={draft.sharedNotification.webhook}
              onChange={(v) =>
                update({
                  sharedNotification: { ...draft.sharedNotification, webhook: v },
                })
              }
              placeholder="https://hub.example.com/hooks/hex-zone"
            />
            <p className="-mt-1 text-xs text-[#8694AC]">
              Must start with https:// (or http://). When set, Hex Zone POSTs{" "}
              <code className="text-[#8694AC]">{"{ title, message }"}</code> JSON
              for Alarm/Alert messages from this network (Home Assistant
              webhook shape).
            </p>
            <Field
              label="Periodical Check (sec)"
              value={draft.sharedNotification.periodicalCheckSec}
              onChange={(v) =>
                update({
                  sharedNotification: {
                    ...draft.sharedNotification,
                    periodicalCheckSec: v,
                  },
                })
              }
              placeholder="86400"
            />
            <p className="-mt-1 text-xs text-[#8694AC]">
              Hint for hubs that poll instead of (or in addition to) webhook push.
            </p>
            {isNetworkAdmin ? (
              <div className="rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
                  Send command
                </p>
                <p className="mt-1 text-xs text-[#8694AC]">
                  Arm, disarm, or ask this hub for status. The hub must accept the
                  webhook or the result stays failed.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    value={hubCommand}
                    onChange={(event) => setHubCommand(event.target.value)}
                    disabled={hubs.length === 0 || sendingCommand}
                    className="rounded-lg border border-[#DCE6F2] bg-white px-3 py-2 text-sm text-[#0F2C5C]"
                  >
                    <option value="arm">Arm</option>
                    <option value="disarm">Disarm</option>
                    <option value="status">Status</option>
                  </select>
                  <button
                    type="button"
                    disabled={hubs.length === 0 || sendingCommand}
                    onClick={() => {
                      const hid = draft.sharedNotification.hid || hubs[0]?.hid;
                      if (!hid) return;
                      setSendingCommand(true);
                      void sendHubCommand(hid, hubCommand).then((result) => {
                        setSendingCommand(false);
                        if (result.error || !result.data) {
                          setError(result.error || "Could not send the command.");
                          return;
                        }
                        setHubCommands((prev) => [result.data as HubCommandRecord, ...prev].slice(0, 8));
                      });
                    }}
                    className="rounded-lg bg-[#2F80ED] px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
                  >
                    {sendingCommand ? "Sending…" : "Send"}
                  </button>
                </div>
                {hubs.length === 0 ? (
                  <p className="mt-2 text-xs text-[#8694AC]">
                    Register a hub in Device Manager first.
                  </p>
                ) : null}
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
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={loading || saving}
              className="inline-flex items-center gap-2 rounded-lg bg-[#2F80ED] px-5 py-2 text-sm font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                </>
              ) : (
                "Update smart-home settings"
              )}
            </button>
            {saved ? (
              <span className="text-sm text-[#2FA24A]">Saved.</span>
            ) : null}
          </div>
        </div>
      </div>

      {isSystemAdmin ? (
        <div className="rounded-2xl border border-[#DCE6F2] bg-white p-5 shadow-sm">
          <div className="mb-1 flex items-center gap-2 text-lg font-bold text-[#0F2C5C]">
            <SettingsIcon className="h-5 w-5 text-[#2F80ED]" /> Zone size limit
          </div>
          <p className="mb-4 text-sm text-[#566784]">
            Set the each-zone cap and the total cap for the network admin and
            for the member, on every account type. Each cap has its own unit.
            Polygons, circles, and hex cells count. Leave a field empty for no limit.
          </p>
          <div className="mb-4 flex flex-wrap gap-2">
            {AREA_ACCOUNTS.map((account) => (
              <button
                key={account.value}
                type="button"
                onClick={() => setAreaAccount(account.value)}
                className={`rounded-full px-3 py-1 text-sm font-semibold ${
                  areaAccount === account.value
                    ? "bg-[#2F80ED] text-white"
                    : "bg-[#E8F1FC] text-[#0F2C5C]"
                }`}
              >
                {account.label}
              </button>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {(["administrator", "user"] as const).map((role) => {
              const draft = areaRules.find(
                (rule) => rule.account_type === areaAccount && rule.role === role,
              );
              if (!draft) return null;
              return (
                <div key={role} className="rounded-xl border border-[#DCE6F2] p-4">
                  <div className="mb-3 text-sm font-bold text-[#0F2C5C]">
                    {role === "administrator" ? "Network admin" : "Member"}
                  </div>
                  <LimitPair
                    label="Each zone"
                    value={draft.eachInput}
                    unit={draft.eachUnit}
                    onValue={(value) =>
                      patchAreaRule(areaAccount, role, { eachInput: value }, setAreaRules)
                    }
                    onUnit={(unit) =>
                      patchAreaRule(
                        areaAccount,
                        role,
                        { eachUnit: unit, eachInput: convertAreaInput(draft.eachInput, draft.eachUnit, unit) },
                        setAreaRules,
                      )
                    }
                  />
                  <LimitPair
                    label="Total size"
                    value={draft.totalInput}
                    unit={draft.totalUnit}
                    onValue={(value) =>
                      patchAreaRule(areaAccount, role, { totalInput: value }, setAreaRules)
                    }
                    onUnit={(unit) =>
                      patchAreaRule(
                        areaAccount,
                        role,
                        { totalUnit: unit, totalInput: convertAreaInput(draft.totalInput, draft.totalUnit, unit) },
                        setAreaRules,
                      )
                    }
                  />
                </div>
              );
            })}
          </div>
          <button
            type="button"
            disabled={savingLimits}
            onClick={() => {
              const rules = areaRules.map(areaRuleFromDraft);
              if (rules.some((rule) => rule == null)) {
                setError("Zone size limits must be numbers greater than zero.");
                return;
              }
              setSavingLimits(true);
              setError(null);
              void updateZoneAreaLimits(rules as ZoneSizeRule[]).then((result) => {
                setSavingLimits(false);
                if (result.error) setError(result.error);
              });
            }}
            className="mt-4 rounded-lg bg-[#2F80ED] px-5 py-2 text-sm font-bold text-white disabled:opacity-60"
          >
            {savingLimits ? "Saving…" : "Save zone size limits"}
          </button>
        </div>
      ) : null}

      <div className="rounded-2xl border border-[#DCE6F2] bg-white p-5 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-lg font-bold text-[#0F2C5C]">
          <BellRing className="h-5 w-5 text-[#E23B4E]" /> Quick alert &amp; button messages
        </div>
        <p className="mb-4 text-sm text-[#566784]">
          Pre-programmed text sent when a Quick Alert button is pressed (panic,
          home alarm, NS panic, unknown, wellness check). Leave blank to compose
          manually.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {QUICK_MESSAGE_TYPES.map((type) => (
            <Field
              key={type}
              label={QUICK_MESSAGE_LABELS[type]}
              value={draft.quickMessages[type]}
              onChange={(v) =>
                update({
                  quickMessages: { ...draft.quickMessages, [type]: v },
                })
              }
              textarea
            />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={loading || saving}
          className="inline-flex items-center gap-2 rounded-lg bg-[#2F80ED] px-6 py-2.5 text-sm font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Saving…
            </>
          ) : saved ? (
            "Saved"
          ) : (
            "Save quick messages"
          )}
        </button>
        {saved ? (
          <span className="text-sm text-[#2FA24A]">Configuration saved.</span>
        ) : null}
        {error ? <span className="text-sm text-[#E23B4E]">{error}</span> : null}
      </div>
    </section>
  );
}
