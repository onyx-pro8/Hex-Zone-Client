import { useEffect, useMemo, useState } from "react";
import { Home, BellRing, Loader2, Settings as SettingsIcon } from "lucide-react";
import {
  QUICK_MESSAGE_LABELS,
  QUICK_MESSAGE_TYPES,
  updateAppSettings,
  useAppSettings,
  type AppSettings,
} from "../lib/appSettings";
import { getRemoteAppSettings, updateRemoteAppSettings } from "../services/api";
import { getZoneAreaLimits, updateZoneAreaLimits, type ZoneSizeRule } from "../services/api/zones";
import { useAuth } from "../hooks/useAuth";
import { isSystemAdministrator } from "../lib/accountLimits";
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [areaAccount, setAreaAccount] = useState("private_plus");
  const [areaRules, setAreaRules] = useState<AreaDraft[]>(() => emptyAreaRules());
  const [savingLimits, setSavingLimits] = useState(false);
  const isSystemAdmin = isSystemAdministrator({
    role: user?.role,
    accountType: user?.accountType,
    legacyAccountType: user?.account_type,
  });
  /** Real [lat, lng] for the map — from the owner's home, a picked suggestion, or geocoding the typed address. */
  const [addressCoords, setAddressCoords] = useState<[number, number] | null>(
    null,
  );

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const res = await getRemoteAppSettings();
      if (!mounted) return;
      if (res.data) {
        setDraft(updateAppSettings(res.data as Partial<AppSettings>));
      } else if (res.error) {
        setError(res.error);
      }
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [user?.id]);

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
          Configure your broadcast identity, address, and the pre-programmed
          quick-alert messages. Smart-home webhooks are set on each device.
        </p>
        {loading ? (
          <p className="mt-3 inline-flex items-center gap-2 text-sm text-[#8694AC]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your settings…
          </p>
        ) : null}
      </div>

      <div className="space-y-6">
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

      </div>

      {isSystemAdmin ? (
        <div className="rounded-2xl border border-[#DCE6F2] bg-white p-5 shadow-sm">
          <div className="mb-1 flex items-center gap-2 text-lg font-bold text-[#0F2C5C]">
            <SettingsIcon className="h-5 w-5 text-[#2F80ED]" /> Zone size limit
          </div>
          <p className="mb-4 text-sm text-[#566784]">
            {areaAccount === "enhanced"
              ? "Individual Pro is administrator only, so there is no member limit. Set the each-zone cap and the total cap for the administrator. Each cap has its own unit. Polygons, circles, and hex cells count. Leave a field empty for no limit."
              : "Set the each-zone cap and the total cap for the network admin and for the member, on every account type. Each cap has its own unit. Polygons, circles, and hex cells count. Leave a field empty for no limit."}
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
            {(["administrator", "user"] as const)
              .filter((role) => areaAccount !== "enhanced" || role === "administrator")
              .map((role) => {
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
