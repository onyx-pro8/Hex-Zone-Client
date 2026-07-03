import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Megaphone, Radio, ShieldAlert, UserRound } from "lucide-react";
import {
  guestAllowedNetworkGeoTypes,
  guestGeoAlertConfirmPrompt,
  guestGeoAlertLabel,
  guestHasNetworkGeoMessaging,
  readGuestDevicePosition,
} from "../../lib/guestNetworkGeoAlerts";
import { getMessageWorkflow, priorityBadgeClass } from "../../lib/messageWorkflow";
import type { GuestSessionMeta } from "../../lib/guestAccessToken";
import type { GuestMe } from "../../services/api/guestMessages";
import { propagateNetworkGuestMessage, searchNetworkGuestPrivateRecipients } from "../../services/api/networkGuestMessages";
import type { MessageFeatureType } from "../../services/api/messageFeature";
import {
  privateLocationStatusMessage,
  type PrivateLocationStatus,
} from "../../lib/privateMessageLocation";

type Props = {
  primaryZone: string;
  stored: GuestSessionMeta | null;
  me: GuestMe | null;
};

function iconForType(type: MessageFeatureType) {
  switch (type) {
    case "PANIC":
    case "NS_PANIC":
      return AlertTriangle;
    case "UNKNOWN":
      return Radio;
    case "PRIVATE":
      return UserRound;
    case "PA":
      return Megaphone;
    default:
      return ShieldAlert;
  }
}

function buttonClass(type: MessageFeatureType): string {
  const workflow = getMessageWorkflow(type as Parameters<typeof getMessageWorkflow>[0]);
  const p = workflow?.priority ?? "MEDIUM";
  if (p === "MAX" || p === "CRITICAL") {
    return "bg-[#E23B4E] hover:brightness-110";
  }
  if (p === "HIGH") {
    return "bg-[#E0992A] hover:brightness-110";
  }
  if (p === "LOW") {
    return "bg-[#8694AC] hover:brightness-110";
  }
  return "bg-[#2F80ED] hover:brightness-110";
}

export function GuestNetworkGeoAlerts({ primaryZone, stored, me }: Props) {
  const zone = primaryZone.trim();
  const networkGeo = guestHasNetworkGeoMessaging({
    network_geo_messaging: stored?.network_geo_messaging,
    allowed_message_types: me?.allowed_message_types ?? stored?.allowed_message_types,
  });
  const allowedTypes = useMemo(
    () =>
      guestAllowedNetworkGeoTypes(
        me?.allowed_message_types?.length
          ? me.allowed_message_types
          : stored?.allowed_message_types,
      ),
    [me?.allowed_message_types, stored?.allowed_message_types],
  );

  const [busyType, setBusyType] = useState<MessageFeatureType | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [privateRecipientId, setPrivateRecipientId] = useState<string>("");
  const [privatePeers, setPrivatePeers] = useState<
    { owner_id: number; display_name: string }[]
  >([]);
  const [privateLocationStatus, setPrivateLocationStatus] =
    useState<PrivateLocationStatus | null>(null);
  const [peersNote, setPeersNote] = useState<string | null>(null);

  const needsPrivate = allowedTypes.includes("PRIVATE");

  useEffect(() => {
    if (!zone || !needsPrivate) return;
    let alive = true;
    void (async () => {
      try {
        const position = await readGuestDevicePosition();
        const res = await searchNetworkGuestPrivateRecipients("", position);
        if (!alive) return;
        if (res.error && !res.data) {
          setPeersNote(res.error);
          setPrivatePeers([]);
          setPrivateLocationStatus(null);
          return;
        }
        const locationStatus = res.data?.location_status ?? null;
        setPrivateLocationStatus(locationStatus);
        if (locationStatus !== "inside_zone") {
          setPeersNote(privateLocationStatusMessage(locationStatus));
          setPrivatePeers([]);
          return;
        }
        setPeersNote(null);
        const members = (res.data?.members ?? []).map((m) => ({
          owner_id: m.id,
          display_name: m.display_name,
        }));
        setPrivatePeers(members);
        if (members.length === 1) {
          setPrivateRecipientId(String(members[0].owner_id));
        }
      } catch (e: unknown) {
        if (!alive) return;
        setPeersNote(e instanceof Error ? e.message : "Could not load PRIVATE recipients.");
        setPrivatePeers([]);
        setPrivateLocationStatus(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [zone, needsPrivate]);

  const sendAlert = useCallback(
    async (type: MessageFeatureType) => {
      if (!zone || busyType) return;
      const confirm = guestGeoAlertConfirmPrompt(type);
      if (confirm && !window.confirm(confirm)) return;
      if (type === "PRIVATE") {
        const rid = Number(privateRecipientId);
        if (!Number.isFinite(rid) || rid <= 0) {
          setStatus("Select a recipient for PRIVATE.");
          return;
        }
      }
      setBusyType(type);
      setStatus(null);
      try {
        const position = await readGuestDevicePosition();
        const res = await propagateNetworkGuestMessage({
          type,
          hid: crypto.randomUUID(),
          tt: new Date().toISOString(),
          msg: { description: `Guest ${guestGeoAlertLabel(type)} alert` },
          position,
          to: zone,
          ...(type === "PRIVATE" && privateRecipientId
            ? { receiver_owner_id: Number(privateRecipientId) }
            : {}),
        });
        if (res.error) {
          setStatus(res.error);
        } else if (res.data?.skipped) {
          setStatus(
            `${guestGeoAlertLabel(type)}: no recipients — you may be outside an acceptable zone.`,
          );
        } else {
          setStatus(`${guestGeoAlertLabel(type)} sent to network members.`);
        }
      } catch (e: unknown) {
        setStatus(e instanceof Error ? e.message : `Could not send ${guestGeoAlertLabel(type)}.`);
      } finally {
        setBusyType(null);
      }
    },
    [zone, busyType, privateRecipientId],
  );

  if (!networkGeo || !zone || allowedTypes.length === 0) return null;

  return (
    <div className="rounded-xl border border-[#E23B4E]/30 bg-[#FDEDEF] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#E23B4E]">
        Network safety alerts
      </p>
      <p className="mt-1 text-sm text-[#566784]">
        Send alarms and alerts using your current location. Routing follows primary vs secondary
        zone rules for network <span className="font-mono">{zone}</span>.
      </p>

      {needsPrivate && privateLocationStatus === "inside_zone" && privatePeers.length > 0 ? (
        <div className="mt-3 max-w-md space-y-1">
          <label htmlFor="guest-private-recipient" className="text-xs font-medium text-[#566784]">
            PRIVATE recipient
          </label>
          <select
            id="guest-private-recipient"
            value={privateRecipientId}
            onChange={(e) => setPrivateRecipientId(e.target.value)}
            className="w-full rounded-md border border-[#DCE6F2] bg-white px-3 py-2 text-sm text-[#0F2C5C]"
          >
            <option value="">Select a member…</option>
            {privatePeers.map((p) => (
              <option key={p.owner_id} value={p.owner_id}>
                {p.display_name || `Member #${p.owner_id}`}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {needsPrivate && peersNote ? (
        <p className="mt-2 text-xs text-[#E0992A]">{peersNote}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {allowedTypes.map((type) => {
          const Icon = iconForType(type);
          const workflow = getMessageWorkflow(type as Parameters<typeof getMessageWorkflow>[0]);
          const busy = busyType === type;
          return (
            <button
              key={type}
              type="button"
              disabled={busyType !== null}
              onClick={() => void sendAlert(type)}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-bold text-white transition disabled:opacity-60 ${buttonClass(type)}`}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Icon className="h-4 w-4" aria-hidden />
              )}
              {guestGeoAlertLabel(type)}
              {workflow ? (
                <span
                  className={`ml-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${priorityBadgeClass(workflow.priority)}`}
                >
                  {workflow.priority}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {status ? (
        <p className="mt-3 text-sm text-[#566784]" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}
