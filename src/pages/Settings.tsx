import { useEffect, useState } from "react";
import { Home, Megaphone, BellRing, Loader2, Settings as SettingsIcon } from "lucide-react";
import {
  QUICK_MESSAGE_LABELS,
  QUICK_MESSAGE_TYPES,
  updateAppSettings,
  useAppSettings,
  type AppSettings,
} from "../lib/appSettings";
import { getRemoteAppSettings, updateRemoteAppSettings } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import { canEditNetworkId } from "../lib/accountLimits";

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
  const { user } = useAuth();
  const accountName = (user?.name ?? "").trim();
  const networkIdEditable = canEditNetworkId({
    accountType: user?.accountType,
    legacyAccountType: user?.account_type,
  });
  const settings = useAppSettings();
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const res = await getRemoteAppSettings();
      if (!mounted) return;
      if (res.data) {
        const merged = updateAppSettings(res.data as Partial<AppSettings>);
        setDraft(merged);
      } else if (res.error) {
        setError(res.error);
      }
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

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
            <Field
              label="Number / Street #"
              value={draft.address.numberStreet}
              onChange={(v) =>
                update({ address: { ...draft.address, numberStreet: v } })
              }
              placeholder="169"
            />
            <Field
              label="Street Name"
              value={draft.address.streetName}
              onChange={(v) =>
                update({ address: { ...draft.address, streetName: v } })
              }
              placeholder="Fred Young Drive"
            />
            <Field
              label="City"
              value={draft.address.city}
              onChange={(v) => update({ address: { ...draft.address, city: v } })}
              placeholder="Toronto"
            />
            <Field
              label="State / Province / Parish"
              value={draft.address.stateProvince}
              onChange={(v) =>
                update({ address: { ...draft.address, stateProvince: v } })
              }
              placeholder="Ontario"
            />
            <Field
              label="City Code"
              value={draft.address.cityCode}
              onChange={(v) =>
                update({ address: { ...draft.address, cityCode: v } })
              }
              placeholder="M3L 0A6"
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
            Configure how your smart-home device receives zone alerts from Hex
            Zone. Use the API key and network id on the device. Set a webhook URL
            for push delivery, or leave it blank and rely on periodical polling
            instead.
          </p>
          <div className="space-y-3">
            <Field
              label="Hardware Identification (HID)"
              value={draft.sharedNotification.hid}
              onChange={() => {}}
              placeholder="123456789-ABCD01"
              disabled
            />
            <p className="-mt-1 text-xs text-[#8694AC]">
              Smart-home device id registered in Device Manager.
            </p>
            <Field
              label="Network ID"
              value={draft.sharedNotification.networkId}
              onChange={(v) =>
                update({
                  sharedNotification: { ...draft.sharedNotification, networkId: v },
                })
              }
              placeholder="ZONE-ABC123"
              disabled={!networkIdEditable}
            />
            {!networkIdEditable ? (
              <p className="-mt-1 text-xs text-[#8694AC]">
                Network ID is assigned by your administrator and cannot be changed.
              </p>
            ) : (
              <p className="-mt-1 text-xs text-[#8694AC]">
                System administrators may personalize the network ID (e.g. DISTRICT 11).
              </p>
            )}
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
              placeholder="https://your-device.local/alert"
            />
            <p className="-mt-1 text-xs text-[#8694AC]">
              Optional callback URL on the device to accept pushed notifications.
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
              How often the device polls the server when no webhook is set.
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
          Pre-programmed text sent when a quick button is pressed (panic, unknown,
          non-specific/anti-retaliation, etc.). Leave blank to compose manually.
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
