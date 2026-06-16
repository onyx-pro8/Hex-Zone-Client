import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BellRing,
  HeartPulse,
  HelpCircle,
  Megaphone,
  MessageSquare,
  Radar,
  Siren,
  Wrench,
} from "lucide-react";
import { MessageList } from "../components/messages/MessageList";
import { MessageDetail } from "../components/messages/MessageDetail";
import { MessageBlocksPanel } from "../components/messages/MessageBlocksPanel";
import { useMessageFeed } from "../hooks/useMessageFeed";
import { sendMessage, type MessageVisibility } from "../services/api/messages";
import {
  propagateMessageFeatureMessage,
  listInZoneMembers,
  type InZoneMember,
  type MessageFeatureType,
} from "../services/api/messageFeature";
import { dispatchGeoPropagationInbox } from "../lib/inboxRealtime";
import { resolveGuestBrowserDeviceId } from "../lib/guestDeviceId";
import { getOwners, type OwnerListItem } from "../services/api/auth";
import { getMembers, type Member } from "../services/api/members";
import { getZones } from "../services/api/zones";
import { useAuth } from "../hooks/useAuth";
import {
  getMessageTypeCategory,
  getMessageScopeForType,
  groupMessageTypesForUI,
  isAccessGuestChannelType,
  isPrivateMessageType,
  toMessageTypeLabel,
  usesGeoPropagationMessageType,
  type MessageCategory,
  type MessageType,
} from "../lib/messageTypes";
import {
  getMessageWorkflow,
  isEmergencyMessageType,
  requiresAdminToSendType,
} from "../lib/messageWorkflow";
import { listGuestRequestsForZone } from "../services/api/accessPermissions";
import {
  resolveBroadcastName,
  useAppSettings,
  type QuickMessageType,
} from "../lib/appSettings";
import { messageBroadcastLabel } from "../lib/messageBroadcast";
import type { GuestRequestRow } from "../lib/guestRealtime";
import type { Message } from "../services/api/messages";

type QuickAction = {
  type: QuickMessageType;
  label: string;
  icon: typeof BellRing;
  tone: "alarm" | "messaging";
};

const ALARM_ACTIONS: QuickAction[] = [
  { type: "PANIC", label: "PANIC", icon: BellRing, tone: "alarm" },
  { type: "SENSOR", label: "SENSOR", icon: Radar, tone: "alarm" },
  { type: "NS_PANIC", label: "NS PANIC", icon: Siren, tone: "alarm" },
  { type: "UNKNOWN", label: "UNKNOWN", icon: HelpCircle, tone: "alarm" },
];

const MESSAGING_ACTIONS: QuickAction[] = [
  { type: "PRIVATE", label: "PRIVATE MESSAGE", icon: MessageSquare, tone: "messaging" },
  { type: "PA", label: "PUBLIC ANNOUNCEMENT", icon: Megaphone, tone: "messaging" },
  { type: "SERVICE", label: "SERVICES", icon: Wrench, tone: "messaging" },
  { type: "WELLNESS_CHECK", label: "WELLNESS CHECK", icon: HeartPulse, tone: "messaging" },
];

export default function Messages() {
  const { user } = useAuth();
  const isAdministrator =
    String(user?.role ?? "").toLowerCase() === "administrator";
  const settings = useAppSettings();
  const selfBroadcastName = resolveBroadcastName(user?.name);
  const userZoneId = user?.zoneId ?? user?.zone_id;
  const ownerId = Number(user?.id);
  const [quickStatus, setQuickStatus] = useState("");
  const [quickBusy, setQuickBusy] = useState<QuickMessageType | null>(null);
  const [zoneFilter, setZoneFilter] = useState("all");
  const [scopeFilter, setScopeFilter] = useState<"all" | MessageVisibility>("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | MessageCategory>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | MessageType>("all");
  const [dateFilter, setDateFilter] = useState("");
  const [search, setSearch] = useState("");
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);

  const [composeType, setComposeType] = useState<MessageType>("SERVICE");
  const [composeReceiverId, setComposeReceiverId] = useState("");
  const [composeText, setComposeText] = useState("");
  const [composeStatus, setComposeStatus] = useState("");
  const [dbZoneIds, setDbZoneIds] = useState<string[]>([]);
  const [zonesLoading, setZonesLoading] = useState(false);
  const [owners, setOwners] = useState<OwnerListItem[]>([]);
  const [ownersLoading, setOwnersLoading] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [inZoneMembers, setInZoneMembers] = useState<InZoneMember[]>([]);
  const [inZoneLoading, setInZoneLoading] = useState(false);
  const [inZoneError, setInZoneError] = useState<string | null>(null);
  const [senderZoneIds, setSenderZoneIds] = useState<string[]>([]);
  const [guestRows, setGuestRows] = useState<GuestRequestRow[]>([]);
  const [guestsLoading, setGuestsLoading] = useState(false);
  const [guestListError, setGuestListError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setZonesLoading(true);
    void getZones()
      .then((result) => {
        if (!active) return;
        const zones = result.data ?? [];
        const ids = zones
          .map((zone) => String(zone.id ?? "").trim())
          .filter((id) => id.length > 0);
        setDbZoneIds(Array.from(new Set(ids)));
      })
      .finally(() => {
        if (active) setZonesLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setOwnersLoading(true);
    void Promise.all([getOwners({ skip: 0, limit: 500 }), getMembers()])
      .then(([ownersResult, membersResult]) => {
        if (!active) return;
        setOwners(ownersResult.data ?? []);
        setMembers(membersResult.data ?? []);
      })
      .finally(() => {
        if (active) setOwnersLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const messageZoneIds = useMemo(() => {
    if (dbZoneIds.length > 0) return dbZoneIds;
    return userZoneId ? [String(userZoneId)] : [];
  }, [dbZoneIds, userZoneId]);
  const { messages, zones, loading, error, refreshInbox } = useMessageFeed(messageZoneIds);
  const allZoneIds = useMemo(
    () => Array.from(new Set([...dbZoneIds, ...zones])),
    [dbZoneIds, zones],
  );
  const composeZoneId = useMemo(
    () => (userZoneId == null ? null : String(userZoneId).trim()),
    [userZoneId],
  );

  const effectiveZoneForGuests = useMemo(() => {
    const z = composeZoneId?.trim();
    if (z) return z;
    if (zoneFilter !== "all" && zoneFilter.trim()) return zoneFilter.trim();
    return dbZoneIds[0]?.trim() ?? "";
  }, [composeZoneId, zoneFilter, dbZoneIds]);

  useEffect(() => {
    const z = effectiveZoneForGuests.trim();
    if (!z) {
      setGuestRows([]);
      setGuestListError(null);
      return;
    }
    let active = true;
    setGuestsLoading(true);
    setGuestListError(null);
    void listGuestRequestsForZone(z).then((res) => {
      if (!active) return;
      setGuestsLoading(false);
      if (res.error) {
        setGuestListError(res.error);
        setGuestRows([]);
        return;
      }
      setGuestRows(res.data);
    });
    return () => {
      active = false;
    };
  }, [effectiveZoneForGuests]);

  useEffect(() => {
    const z = effectiveZoneForGuests.trim();
    if (!z) return;
    const intervalId = window.setInterval(() => {
      void listGuestRequestsForZone(z).then((res) => {
        if (res.error) return;
        setGuestRows(res.data);
      });
    }, 18_000);
    return () => window.clearInterval(intervalId);
  }, [effectiveZoneForGuests]);

  const accessZonePermissionCount = useMemo(
    () => messages.reduce((acc, m) => acc + (m.type === "PERMISSION" ? 1 : 0), 0),
    [messages],
  );
  const showMessagesIntegrationBanner =
    import.meta.env.VITE_SHOW_MESSAGES_INTEGRATION_BANNER === "true";

  useEffect(() => {
    setComposeReceiverId("");
  }, [composeType]);

  /** PRIVATE recipients: everyone whose live location is inside the same
   *  zone(s) as the sender — cross-account, matching server delivery rules. */
  useEffect(() => {
    if (!isPrivateMessageType(composeType)) {
      setInZoneMembers([]);
      setInZoneError(null);
      setSenderZoneIds([]);
      return;
    }

    let active = true;
    setInZoneLoading(true);
    setInZoneError(null);

    const load = async () => {
      const profileCenter = user?.mapCenter ?? user?.map_center ?? null;
      let position: { latitude: number; longitude: number } | undefined;

      if (
        profileCenter &&
        Number.isFinite(profileCenter.latitude) &&
        Number.isFinite(profileCenter.longitude)
      ) {
        position = {
          latitude: profileCenter.latitude,
          longitude: profileCenter.longitude,
        };
      } else if (
        typeof navigator !== "undefined" &&
        "geolocation" in navigator
      ) {
        position = await new Promise<
          { latitude: number; longitude: number } | undefined
        >((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) =>
              resolve({
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
              }),
            () => resolve(undefined),
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
          );
        });
      }

      const result = await listInZoneMembers(position);
      if (!active) return;
      setInZoneLoading(false);
      if (result.error) {
        setInZoneError(result.error);
        setInZoneMembers([]);
        setSenderZoneIds([]);
        return;
      }
      setInZoneMembers(result.data?.members ?? []);
      setSenderZoneIds(result.data?.zone_ids ?? []);
    };

    void load();
    return () => {
      active = false;
    };
  }, [composeType, user?.mapCenter, user?.map_center]);

  /** Defaults (all zones / all scope / category / type) intentionally include CHAT: meta is Access + private from MESSAGE_TYPE_META. */
  const filteredMessages = useMemo(() => {
    return messages.filter((message) => {
      if (zoneFilter !== "all" && message.zone_id !== zoneFilter) return false;
      if (scopeFilter !== "all" && message.scope !== scopeFilter) {
        return false;
      }
      if (categoryFilter !== "all" && message.category !== categoryFilter) {
        return false;
      }
      if (typeFilter !== "all" && message.type !== typeFilter) {
        return false;
      }
      if (dateFilter) {
        const ymd = new Date(message.created_at).toISOString().slice(0, 10);
        if (ymd !== dateFilter) return false;
      }
      const q = search.trim().toLowerCase();
      if (!q) return true;
      const guestSenderMatch =
        message.guest_sender_id != null &&
        (message.guest_sender_id.toLowerCase().includes(q) ||
          (q.length > 0 && "guest".startsWith(q)));
      const guestIdMatch =
        message.guest_id != null &&
        typeof message.guest_id === "string" &&
        message.guest_id.toLowerCase().includes(q);
      return (
        message.message.toLowerCase().includes(q) ||
        message.zone_id.toLowerCase().includes(q) ||
        String(message.sender_id).includes(q) ||
        String(message.receiver_id ?? "").includes(q) ||
        guestSenderMatch ||
        guestIdMatch
      );
    });
  }, [messages, zoneFilter, scopeFilter, categoryFilter, typeFilter, dateFilter, search]);

  const sortedFilteredMessages = useMemo(
    () =>
      [...filteredMessages].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [filteredMessages],
  );

  const activeMessage =
    filteredMessages.find((msg) => msg.id === activeMessageId) ?? null;

  const ownerNameById = useMemo(() => {
    const map = new Map<number, string>();
    owners.forEach((row) => {
      const id = Number(row.id);
      if (!Number.isFinite(id) || id <= 0) return;
      const name =
        `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() ||
        row.email ||
        "";
      if (name) map.set(id, name);
    });
    members.forEach((row) => {
      const id = Number(row.account_owner_id ?? row.id);
      if (!Number.isFinite(id) || id <= 0 || map.has(id)) return;
      const name =
        `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() ||
        row.name ||
        row.email ||
        "";
      if (name) map.set(id, name);
    });
    return map;
  }, [owners, members]);

  const getBroadcastName = useCallback(
    (message: Message) =>
      messageBroadcastLabel(message, {
        selfOwnerId: Number.isFinite(ownerId) ? ownerId : null,
        selfBroadcastName,
        resolveOwnerName: (id) => ownerNameById.get(id) ?? null,
      }),
    [ownerId, selfBroadcastName, ownerNameById],
  );

  const confirmEmergencySend = useCallback((type: MessageType): boolean => {
    if (!isEmergencyMessageType(type)) return true;
    const label = toMessageTypeLabel(type);
    return window.confirm(
      `${label} is a maximum-priority emergency alert sent to everyone in your zone. Block filters are bypassed. Send now?`,
    );
  }, []);

  const sendQuickAlert = useCallback(
    async (type: QuickMessageType) => {
      if (quickBusy) return;
      if (!confirmEmergencySend(type as MessageType)) return;
      const presetText = (settings.quickMessages[type] ?? "").trim();
      if (!presetText) {
        // Types without a preset (e.g. PRIVATE) switch the composer instead.
        setComposeType(type as MessageType);
        setComposeText("");
        return;
      }
      const position = user?.mapCenter ?? user?.map_center ?? null;
      if (
        !position ||
        !Number.isFinite(position.latitude) ||
        !Number.isFinite(position.longitude)
      ) {
        setQuickStatus(
          "Set your location on the map before sending quick alerts.",
        );
        return;
      }
      setQuickBusy(type);
      setQuickStatus(`Sending ${toMessageTypeLabel(type as MessageType)}…`);
      const propagateResult = await propagateMessageFeatureMessage({
        type: type as MessageFeatureType,
        hid: resolveGuestBrowserDeviceId(),
        msg: { description: presetText, broadcast_name: selfBroadcastName },
        position: {
          latitude: position.latitude,
          longitude: position.longitude,
        },
      });
      setQuickBusy(null);
      if (propagateResult.error) {
        setQuickStatus(propagateResult.error);
        return;
      }
      const body = propagateResult.data;
      if (body && !body.skipped && body.id) {
        dispatchGeoPropagationInbox({
          ...body,
          sender_id:
            body.sender_id ?? (Number.isFinite(ownerId) ? ownerId : undefined),
          zone_id: body.zone_id ?? body.zone_ids?.[0] ?? (composeZoneId ?? undefined),
        });
      }
      setQuickStatus(`${toMessageTypeLabel(type as MessageType)} sent.`);
      void refreshInbox();
    },
    [
      quickBusy,
      settings.quickMessages,
      user?.mapCenter,
      user?.map_center,
      selfBroadcastName,
      ownerId,
      composeZoneId,
      refreshInbox,
      confirmEmergencySend,
    ],
  );

  const handleSend = async () => {
    if (!composeType) {
      setComposeStatus("Message Type is required.");
      return;
    }
    if (
      requiresAdminToSendType(composeType) &&
      !isAdministrator
    ) {
      setComposeStatus("Only administrators can send SERVICE messages.");
      return;
    }
    if (!confirmEmergencySend(composeType)) return;
    if (!composeText.trim()) return;
    const accessGuest = isAccessGuestChannelType(composeType);
    if (accessGuest) {
      if (!composeReceiverId.trim()) {
        setComposeStatus("Pick a guest for CHAT.");
        return;
      }
    } else if (isPrivateMessageType(composeType) && !composeReceiverId) {
      setComposeStatus("Receiver ID is required for private messages.");
      return;
    }
    const parsedReceiverId = Number(composeReceiverId);
    if (
      !accessGuest &&
      isPrivateMessageType(composeType) &&
      (!Number.isFinite(parsedReceiverId) || parsedReceiverId <= 0)
    ) {
      setComposeStatus("Receiver ID must be a valid owner id.");
      return;
    }
    setComposeStatus("Sending...");

    if (usesGeoPropagationMessageType(composeType)) {
      const position =
        user?.mapCenter ??
        user?.map_center ??
        null;
      if (
        !position ||
        !Number.isFinite(position.latitude) ||
        !Number.isFinite(position.longitude)
      ) {
        setComposeStatus(
          "Set your location on the map (or update member location) before sending alarms.",
        );
        return;
      }
      const featureType = composeType as MessageFeatureType;
      const propagateResult = await propagateMessageFeatureMessage({
        type: featureType,
        hid: resolveGuestBrowserDeviceId(),
        msg: { description: composeText.trim(), broadcast_name: selfBroadcastName },
        position: {
          latitude: position.latitude,
          longitude: position.longitude,
        },
        ...(isPrivateMessageType(composeType)
          ? { receiver_owner_id: parsedReceiverId }
          : {}),
      });
      if (propagateResult.error) {
        setComposeStatus(propagateResult.error);
        return;
      }
      const body = propagateResult.data;
      if (body && !body.skipped && body.id) {
        dispatchGeoPropagationInbox({
          ...body,
          sender_id: body.sender_id ?? (Number.isFinite(ownerId) ? ownerId : undefined),
          zone_id:
            body.zone_id ??
            body.zone_ids?.[0] ??
            (composeZoneId ?? undefined),
        });
      }
      setComposeStatus("Sent.");
      setComposeText("");
      if (isPrivateMessageType(composeType)) setComposeReceiverId("");
      void refreshInbox();
      return;
    }

    const result = await sendMessage({
      message: composeText.trim(),
      type: composeType,
      broadcast_name: selfBroadcastName,
      ...(composeZoneId ? { zone_id: composeZoneId } : {}),
      ...(accessGuest && composeReceiverId.trim()
        ? { guest_id: composeReceiverId.trim() }
        : {}),
      ...(!accessGuest && isPrivateMessageType(composeType)
        ? { receiver_id: parsedReceiverId }
        : {}),
    });
    setComposeStatus(result.error ? "Send failed." : "Sent.");
    if (!result.error) {
      setComposeText("");
      if (isPrivateMessageType(composeType)) setComposeReceiverId("");
    }
  };

  const selectableGuests = useMemo(
    () => guestRows.filter((r) => r.status !== "REJECTED"),
    [guestRows],
  );

  const groupedTypeOptions = useMemo(() => groupMessageTypesForUI(), []);
  const composeTypeOptions = useMemo(
    () =>
      groupedTypeOptions
        .map((group) => ({
          ...group,
          options: group.options.filter((option) => {
            if (option.type === "PERMISSION") return false;
            if (
              requiresAdminToSendType(option.type) &&
              !isAdministrator
            ) {
              return false;
            }
            return true;
          }),
        }))
        .filter((group) => group.options.length > 0),
    [groupedTypeOptions, isAdministrator],
  );
  const visibleMessagingActions = useMemo(
    () =>
      MESSAGING_ACTIONS.filter(
        (action) =>
          !requiresAdminToSendType(action.type as MessageType) ||
          isAdministrator,
      ),
    [isAdministrator],
  );
  const composeWorkflow = getMessageWorkflow(composeType);

  const [composeTypeNotice, setComposeTypeNotice] = useState<string | null>(null);

  useEffect(() => {
    if (composeType !== "PERMISSION") return;
    setComposeType("CHAT");
    setComposeTypeNotice(
      "PERMISSION events are automatic from guest access workflow; switched to CHAT.",
    );
  }, [composeType]);
  const composeScope = getMessageScopeForType(composeType);
  const composeCategory = getMessageTypeCategory(composeType);

  const selectMessagingType = (type: QuickMessageType) => {
    setComposeType(type as MessageType);
    const preset = (settings.quickMessages[type] ?? "").trim();
    if (preset) setComposeText(preset);
    setQuickStatus("");
  };

  return (
    <section className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-[#DCE6F2] bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 rounded-xl bg-[#FCE7EA] px-3 py-2 text-[#E23B4E]">
            <BellRing className="h-5 w-5" aria-hidden />
            <span className="text-sm font-extrabold tracking-wide">ALERT</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {ALARM_ACTIONS.map((action) => {
              const Icon = action.icon;
              const urgent = isEmergencyMessageType(action.type as MessageType);
              const nsPanic = action.type === "NS_PANIC";
              return (
                <button
                  key={action.type}
                  type="button"
                  disabled={quickBusy === action.type}
                  onClick={() => void sendQuickAlert(action.type)}
                  className={`flex flex-col items-center justify-center gap-2 rounded-xl border px-3 py-6 transition disabled:opacity-60 ${
                    nsPanic
                      ? "border-[#B5179E] bg-[#B5179E] text-white shadow-md hover:brightness-110"
                      : urgent
                        ? "border-[#E23B4E] bg-[#E23B4E] text-white shadow-md hover:brightness-110"
                        : "border-[#F3C2CA] bg-[#FCE7EA] text-[#E23B4E] hover:brightness-95"
                  }`}
                >
                  <Icon className="h-7 w-7" aria-hidden />
                  <span className="text-sm font-extrabold tracking-wide">
                    {action.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-[#DCE6F2] bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 rounded-xl bg-[#FBEFD8] px-3 py-2 text-[#E0992A]">
            <Megaphone className="h-5 w-5" aria-hidden />
            <span className="text-sm font-extrabold tracking-wide">Messaging</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {visibleMessagingActions.map((action) => {
              const Icon = action.icon;
              // WELLNESS CHECK is a one-tap send (uses its preset text); other
              // messaging types open the composer so the user can edit copy.
              const oneTap = action.type === "WELLNESS_CHECK";
              return (
                <button
                  key={action.type}
                  type="button"
                  disabled={oneTap && quickBusy === action.type}
                  onClick={() =>
                    oneTap
                      ? void sendQuickAlert(action.type)
                      : selectMessagingType(action.type)
                  }
                  className="flex flex-col items-center justify-center gap-2 rounded-xl border border-[#F0DBB0] bg-[#FBEFD8] px-3 py-6 text-center text-[#E0992A] transition hover:brightness-95 disabled:opacity-60"
                >
                  <Icon className="h-7 w-7" aria-hidden />
                  <span className="text-xs font-extrabold leading-tight tracking-wide">
                    {action.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {quickStatus ? (
        <p className="rounded-xl border border-[#DCE6F2] bg-white px-4 py-2 text-sm text-[#566784]">
          {quickStatus}
        </p>
      ) : null}

      <div className="flex items-center gap-3 rounded-2xl border border-[#DCE6F2] bg-white px-4 py-3 shadow-sm">
        <span className="text-sm text-[#566784]">
          <span className="font-semibold text-[#0F2C5C]">Live message feed.</span>{" "}
          Sending as <span className="font-semibold text-[#2F80ED]">{selfBroadcastName}</span> ·
          WebSocket with polling fallback.
        </span>
      </div>

      <details className="rounded-2xl border border-[#DCE6F2] bg-white text-sm text-[#566784] shadow-sm">
        <summary className="cursor-pointer select-none px-4 py-2.5 [&::-webkit-details-marker]:hidden">
          <span className="font-semibold text-[#0F2C5C]">Access info</span>
          <span className="mt-1 block text-xs text-[#8694AC]">
            {accessZonePermissionCount > 0
              ? "This inbox batch includes PERMISSION rows; expand only if you need integration notes."
              : "Quiet summary — expand for details or enable verbose banner via env."}
          </span>
        </summary>
        <div className="space-y-3 border-t border-[#DCE6F2] px-4 py-3 text-xs leading-relaxed text-[#566784]">
          {showMessagesIntegrationBanner ? (
            <>
              <p>
                Access Zone permission traffic belongs in each owner&apos;s stream from{" "}
                <span className="font-mono text-[11px] text-[#566784]">
                  GET {import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, "") || "…"}
                  /messages/
                </span>{" "}
                (query <span className="font-mono text-[11px] text-[#566784]">owner_id</span>, same as chat).{" "}
                <span className="font-medium text-[#566784]">Permission traffic requires the backend to mirror</span>{" "}
                PERMISSION rows into member <span className="font-mono text-[11px] text-[#566784]">/messages/</span>;
                this UI does not fabricate PERMISSION envelopes. Fallback: monitor the{" "}
                <strong className="font-medium text-[#0F2C5C]">Guest access requests</strong> panel below (polls the
                guest-requests list for the resolved zone—status only, not a substitute for full message history).
              </p>
              {accessZonePermissionCount === 0 ? (
                <p className="text-[#8694AC]">
                  No PERMISSION type entries in your current inbox batch—if approvals still feel silent, confirm
                  mirroring or use the Access panel while the API team aligns. CHAT from guests must also be mirrored
                  into <span className="font-mono text-[#566784]">/messages/</span> for admins to see the same thread as
                  the guest app.
                </p>
              ) : null}
            </>
          ) : (
            <p>
              CHAT and PERMISSION lines appear here when the API includes them in{" "}
              <span className="font-mono text-[#566784]">GET /messages/</span> for your owner. The{" "}
              <span className="font-medium text-[#566784]">Guest access requests</span> block below is a lightweight
              status poll, not the full history. Set{" "}
              <span className="font-mono text-[#566784]">VITE_SHOW_MESSAGES_INTEGRATION_BANNER=true</span> for verbose
              contract notes.
            </p>
          )}
        </div>
      </details>

      <div className="grid gap-4 rounded-2xl border border-[#DCE6F2] bg-white p-5 shadow-sm lg:grid-cols-6">
        <select
          value={zoneFilter}
          onChange={(e) => setZoneFilter(e.target.value)}
          className="rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2.5 text-sm text-[#0F2C5C] outline-none focus:border-[#2F80ED]"
        >
          <option value="all">All zones</option>
          {allZoneIds.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
        <select
          value={scopeFilter}
          onChange={(e) => setScopeFilter(e.target.value as "all" | MessageVisibility)}
          className="rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2.5 text-sm text-[#0F2C5C] outline-none focus:border-[#2F80ED]"
        >
          <option value="all">All Scope</option>
          <option value="public">Public</option>
          <option value="private">Private</option>
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as "all" | MessageCategory)}
          className="rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2.5 text-sm text-[#0F2C5C] outline-none focus:border-[#2F80ED]"
        >
          <option value="all">All Category</option>
          <option value="Alarm">Alarm</option>
          <option value="Alert">Alert</option>
          <option value="Access">Access</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as "all" | MessageType)}
          className="rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2.5 text-sm text-[#0F2C5C] outline-none focus:border-[#2F80ED]"
        >
          <option value="all">All Message Types</option>
          {groupedTypeOptions.map((group) => (
            <optgroup key={group.category} label={group.category}>
              {group.options.map((option) => (
                <option key={option.type} value={option.type}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <input
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2.5 text-sm text-[#0F2C5C] outline-none focus:border-[#2F80ED]"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search text or zone..."
          className="lg:col-span-2 rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2.5 text-sm text-[#0F2C5C] outline-none focus:border-[#2F80ED]"
        />
      </div>

      <details className="rounded-2xl border border-[#DCE6F2] bg-white px-4 py-3 text-sm text-[#566784] shadow-sm">
        <summary className="cursor-pointer select-none font-semibold text-[#0F2C5C]">
          Guest access requests (zone:{" "}
          <span className="font-mono text-[#2F80ED]">{effectiveZoneForGuests || "—"}</span>
          ){guestsLoading ? <span className="ml-2 text-xs font-normal text-[#8694AC]">loading…</span> : null}
        </summary>
        {guestListError ? (
          <p className="mt-2 text-xs text-[#E0992A]">
            {guestListError} Configure <span className="font-mono">VITE_ADMIN_GUEST_REQUESTS_LIST_URL</span> when your
            path differs from the contract default.
          </p>
        ) : (
          <div className="mt-3 max-h-[220px] overflow-auto rounded-lg border border-[#DCE6F2] bg-[#F7FAFE]">
            {guestRows.length === 0 ? (
              <p className="p-4 text-xs text-[#8694AC]">
                No rows for this zone. Incoming guest QR flows should appear once the backend exposes guest-requests for the
                member API.
              </p>
            ) : (
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-[#EDF3FB] text-[10px] uppercase tracking-[0.12em] text-[#8694AC]">
                  <tr>
                    <th className="border-b border-[#DCE6F2] p-2">Guest</th>
                    <th className="border-b border-[#DCE6F2] p-2">Id</th>
                    <th className="border-b border-[#DCE6F2] p-2">Expect</th>
                    <th className="border-b border-[#DCE6F2] p-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {guestRows.map((r) => (
                    <tr key={r.id} className="border-b border-[#DCE6F2] text-[#566784] last:border-b-0">
                      <td className="p-2">{r.guestName ?? "—"}</td>
                      <td className="max-w-[140px] break-all p-2 font-mono text-[11px] text-[#8694AC]">{r.id}</td>
                      <td className="p-2 capitalize text-[#8694AC]">{r.expectation}</td>
                      <td className="p-2 font-medium text-[#2F80ED]">{r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        <p className="mt-2 text-[11px] text-[#8694AC]">
          Refresh: on zone change, plus background poll every ~18s. Compose CHAT via guest ids from this list when
          shown.
        </p>
      </details>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-3">
          {error ? (
            <p className="rounded-lg border border-[#E23B4E]/30 bg-[#FCE7EA] px-3 py-2 text-sm text-[#E23B4E]">{error}</p>
          ) : null}
          {loading ? (
            <p className="text-sm text-[#566784]">Syncing messages…</p>
          ) : null}
          <MessageList
            messages={sortedFilteredMessages}
            activeId={activeMessageId}
            onSelect={setActiveMessageId}
            getBroadcastName={getBroadcastName}
          />
        </div>
        <div className="space-y-4">
          <MessageDetail message={activeMessage} currentOwnerId={ownerId} />
          {Number.isFinite(ownerId) && ownerId > 0 ? (
            <MessageBlocksPanel
              currentOwnerId={ownerId}
              onBlocksChanged={() => void refreshInbox()}
            />
          ) : null}
          <section className="space-y-3 rounded-2xl border border-[#DCE6F2] bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-[#8694AC]">
              Compose
            </p>
            <label className="block text-xs font-medium text-[#566784]">Message Type</label>
            <select
              value={composeType}
              onChange={(e) => {
                setComposeTypeNotice(null);
                setComposeType(e.target.value as MessageType);
              }}
              className="w-full rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2.5 text-sm text-[#0F2C5C] outline-none focus:border-[#2F80ED]"
            >
              {composeTypeOptions.map((group) => (
                <optgroup key={group.category} label={group.category}>
                  {group.options.map((option) => (
                    <option key={option.type} value={option.type}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-xs text-[#566784]">
              <p>
                Category: <span className="font-semibold text-[#0F2C5C]">{composeCategory}</span>
              </p>
              <p>
                Scope: <span className="font-semibold capitalize text-[#0F2C5C]">{composeScope}</span>
              </p>
              <p className="col-span-2 text-[#8694AC]">Scope is determined by selected type.</p>
            </div>
            {composeTypeNotice ? (
              <p className="text-xs text-[#E0992A]">{composeTypeNotice}</p>
            ) : null}
            {composeWorkflow ? (
              <div className="rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-xs text-[#566784]">
                <p className="font-semibold text-[#0F2C5C]">
                  {toMessageTypeLabel(composeType)} workflow
                </p>
                <p className="mt-1">{composeWorkflow.description}</p>
                <p className="mt-1 text-[#8694AC]">{composeWorkflow.delivery}</p>
              </div>
            ) : null}
            {isAccessGuestChannelType(composeType) && (
              <>
                <p className="text-xs text-[#8694AC]">
                  CHAT here goes to <span className="font-medium text-[#566784]">guests</span> in this zone only (not
                  member-to-member). Zone for list:{" "}
                  <span className="font-mono text-[#8694AC]">
                    {effectiveZoneForGuests || "—"}
                  </span>
                </p>
                <select
                  value={composeReceiverId}
                  onChange={(e) => setComposeReceiverId(e.target.value)}
                  className="w-full rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2.5 text-sm text-[#0F2C5C] outline-none focus:border-[#2F80ED]"
                >
                  <option value="">
                    {guestsLoading ? "Loading guests…" : "Pick a guest (guest id)"}
                  </option>
                  {selectableGuests.map((row) => (
                    <option key={`guest-${row.id}`} value={row.id}>
                      {row.guestName?.trim() || "Guest"} — {row.id.slice(0, 12)}
                      {row.id.length > 12 ? "…" : ""} ({row.expectation}, {row.status})
                    </option>
                  ))}
                </select>
                {guestListError ? (
                  <p className="text-xs text-[#E0992A]">
                    Guest list: {guestListError} (set{" "}
                    <span className="font-mono">VITE_ADMIN_GUEST_REQUESTS_LIST_URL</span> if your API path differs).
                  </p>
                ) : null}
                {!guestsLoading && !guestListError && selectableGuests.length === 0 ? (
                  <p className="text-xs text-[#8694AC]">
                    No guests in this zone yet, or approvals are still pending. You can also open the zone on the
                    Dashboard to review guest requests.
                  </p>
                ) : null}
              </>
            )}
            {!isAccessGuestChannelType(composeType) && isPrivateMessageType(composeType) && (
              <>
                <p className="text-xs text-[#8694AC]">
                  Recipients are members whose current location is inside the same
                  zone(s) as you. Zone is determined from your GPS, not account labels.
                </p>
                <select
                  value={composeReceiverId}
                  onChange={(e) => setComposeReceiverId(e.target.value)}
                  className="w-full rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2.5 text-sm text-[#0F2C5C] outline-none focus:border-[#2F80ED]"
                >
                  <option value="">
                    {inZoneLoading ? "Loading nearby members…" : "Pick a member in your zone"}
                  </option>
                  {inZoneMembers.map((row) => {
                    return (
                      <option key={`inzone-${row.id}`} value={String(row.id)}>
                        {row.id} - {row.name}
                      </option>
                    );
                  })}
                </select>
                {inZoneError ? (
                  <p className="text-xs text-[#E0992A]">{inZoneError}</p>
                ) : null}
                {!inZoneLoading && !inZoneError && senderZoneIds.length === 0 ? (
                  <p className="text-xs text-[#8694AC]">
                    You are not inside any zone. Move into a zone or update your location
                    on the map before sending a private message.
                  </p>
                ) : null}
                {!inZoneLoading &&
                !inZoneError &&
                senderZoneIds.length > 0 &&
                inZoneMembers.length === 0 ? (
                  <p className="text-xs text-[#8694AC]">
                    No other members are currently located in your zone(s).
                  </p>
                ) : null}
              </>
            )}
            <textarea
              rows={4}
              value={composeText}
              onChange={(e) => setComposeText(e.target.value)}
              placeholder="Type your message..."
              className="w-full rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2.5 text-sm text-[#0F2C5C] outline-none focus:border-[#2F80ED]"
            />
            <button
              type="button"
              onClick={handleSend}
              className="w-full rounded-lg bg-[#2F80ED] px-4 py-2.5 text-sm font-bold text-white transition hover:brightness-110"
            >
              Send Message
            </button>
            <p className="text-xs text-[#8694AC]">
              Sending as <span className="font-semibold text-[#2F80ED]">{selfBroadcastName}</span>{" "}
              (owner <span className="font-mono">{ownerId || "?"}</span>)
            </p>
            <p className="text-xs text-[#8694AC]">
              {zonesLoading
                ? "Loading zone IDs from database..."
                : `Zone IDs loaded: ${allZoneIds.length}`}
            </p>
            {isAccessGuestChannelType(composeType) && (
              <p className="text-xs text-[#8694AC]">
                {guestsLoading
                  ? "Loading guest list…"
                  : `Guests available: ${selectableGuests.length}`}
              </p>
            )}
            {!isAccessGuestChannelType(composeType) && isPrivateMessageType(composeType) && (
              <p className="text-xs text-[#8694AC]">
                {inZoneLoading
                  ? "Checking who is in your zone…"
                  : senderZoneIds.length === 0
                    ? "Not inside any zone — update your location first."
                    : `Members in your zone (${inZoneMembers.length} available · ${senderZoneIds.length} zone(s))`}
              </p>
            )}
            <p className="text-xs text-[#8694AC]">
              Selected type: {toMessageTypeLabel(composeType)}
            </p>
            {composeStatus && <p className="text-xs text-[#566784]">{composeStatus}</p>}
          </section>
        </div>
      </div>
    </section>
  );
}
