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
import { getDevices } from "../services/api/devices";
import { useAuth } from "../hooks/useAuth";
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
  /** Real [lat, lng] for the map — from the owner's home, a picked suggestion, or geocoding the typed address. */
  const [addressCoords, setAddressCoords] = useState<[number, number] | null>(
    null,
  );

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const ownerId = String(user?.id ?? "").trim();
      const [res, devicesRes] = await Promise.all([
        getRemoteAppSettings(),
        getDevices(),
      ]);
      if (!mounted) return;

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
  }, [user?.id]);

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
