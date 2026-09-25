import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
import { MessageInboxFilterBar } from "../components/messages/MessageInboxFilterBar";
import { ServicePaComposeFieldsPanel } from "../components/messages/ServicePaComposeFields";
import { useMessageFeed } from "../hooks/useMessageFeed";
import { useZoneNameLookup } from "../hooks/useZoneNameLookup";
import { sendMessage } from "../services/api/messages";
import {
  propagateMessageFeatureMessage,
  searchPrivateMessageRecipients,
  listComposeZones,
  listComposeZoneRecipients,
  type PrivateSearchMember,
  type MessageFeatureType,
  type ComposeZoneOption,
} from "../services/api/messageFeature";
import { dispatchGeoPropagationInbox } from "../lib/inboxRealtime";
import { resolveGuestBrowserDeviceId } from "../lib/guestDeviceId";
import { toastSmartHomeWebhookDelivery } from "../lib/smartHomeToast";
import { getOwners, type OwnerListItem } from "../services/api/auth";
import { getMembers, type Member } from "../services/api/members";
import { getZones } from "../services/api/zones";
import { useAuth } from "../hooks/useAuth";
import { isSystemAdministrator } from "../lib/accountLimits";
import { useWebSocket } from "../hooks/useWebSocket";
import {
  getMessageTypeCategory,
  groupMessageTypesForUI,
  isAccessGuestChannelType,
  isPrivateMessageType,
  toMessageType,
  toMessageTypeLabel,
  usesComposeZoneTargeting,
  usesGeoPropagationMessageType,
  type MessageType,
} from "../lib/messageTypes";
import {
  applyMessageInboxFilters,
  groupMessageTypesForCategories,
} from "../lib/messageInboxFilters";
import {
  isEmergencyMessageType,
  isUnknownMessageType,
  isServiceMessageType,
} from "../lib/messageWorkflow";
import { listGuestRequestsForZone } from "../services/api/accessPermissions";
import {
  resolveBroadcastName,
  useAppSettings,
  type QuickMessageType,
} from "../lib/appSettings";
import { messageBroadcastLabel } from "../lib/messageBroadcast";
import {
  buildServicePaMsgPayload,
  isServicePaMessageType,
  validateServicePaCompose,
  type ServicePaComposeFields,
} from "../lib/servicePaTopics";
import {
  resolveMessagePropagationPositionForType,
  messagePositionSourceLabel,
  type ResolvedMessagePosition,
} from "../lib/messagePosition";
import type { GuestRequestRow } from "../lib/guestRealtime";
import type { Message } from "../services/api/messages";
import {
  privateLocationStatusMessage,
  type PrivateLocationStatus,
} from "../lib/privateMessageLocation";

function memberBroadcastName(member: PrivateSearchMember): string {
  return (member.broadcast_name || "").trim() || member.display_name;
}

/** Distance subtitle only — never fall back to email. */
function memberDistanceLabel(member: PrivateSearchMember): string {
  const sub = (member.subtitle || "").trim();
  if (sub && !sub.includes("@")) return sub;
  if (
    typeof member.distance_meters === "number" &&
    Number.isFinite(member.distance_meters) &&
    member.distance_meters >= 0
  ) {
    const meters = member.distance_meters;
    if (meters < 1000) return `${Math.round(meters)} m away`;
    const km = meters / 1000;
    if (km < 10) return `${km.toFixed(1)} km away`;
    return `${Math.round(km)} km away`;
  }
  return "";
}

type QuickAction = {
  type: MessageType;
  label: string;
  icon: typeof BellRing;
  tone: "alarm" | "messaging";
};

const ALARM_ACTIONS: QuickAction[] = [
  { type: "PANIC", label: "PANIC", icon: BellRing, tone: "alarm" },
  { type: "SENSOR", label: "HOME ALARM", icon: Radar, tone: "alarm" },
  { type: "NS_PANIC", label: "NS PANIC", icon: Siren, tone: "alarm" },
  { type: "UNKNOWN", label: "UNKNOWN", icon: HelpCircle, tone: "alarm" },
  { type: "WELLNESS_CHECK", label: "WELLNESS CHECK", icon: HeartPulse, tone: "alarm" },
];

const MESSAGING_ACTIONS: QuickAction[] = [
  { type: "PRIVATE", label: "PRIVATE MESSAGE", icon: MessageSquare, tone: "messaging" },
  { type: "PA", label: "PUBLIC ANNOUNCEMENT", icon: Megaphone, tone: "messaging" },
  { type: "SERVICE", label: "SERVICES", icon: Wrench, tone: "messaging" },
];

export default function Messages() {
  const { user, token } = useAuth();
  const isSystemAdmin = isSystemAdministrator({
    accountType: user?.accountType,
    legacyAccountType: user?.account_type,
    role: user?.role,
  });
  const { zoneNames } = useZoneNameLookup();
  const [searchParams] = useSearchParams();
  const settings = useAppSettings();
  const selfBroadcastName = resolveBroadcastName(user?.name);
  const userZoneId = user?.zoneId ?? user?.zone_id;
  const ownerId = Number(user?.id);
  const [quickStatus, setQuickStatus] = useState("");
  const [quickBusy, setQuickBusy] = useState<QuickMessageType | null>(null);
  const [zoneFilter, setZoneFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<"all" | MessageType>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);

  const [composeType, setComposeType] = useState<MessageType>("SERVICE");
  const [composeReceiverId, setComposeReceiverId] = useState("");
  const [composeText, setComposeText] = useState("");
  const [composeServicePaFields, setComposeServicePaFields] =
    useState<ServicePaComposeFields>({ subject: "", topic: "", subtopic: "" });
  const [composeStatus, setComposeStatus] = useState("");
  const [composeSending, setComposeSending] = useState(false);
  const [dbZoneIds, setDbZoneIds] = useState<string[]>([]);
  const [zonesLoading, setZonesLoading] = useState(false);
  const [owners, setOwners] = useState<OwnerListItem[]>([]);
  const [ownersLoading, setOwnersLoading] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [privateSearchQuery, setPrivateSearchQuery] = useState("");
  const [privateSearchResults, setPrivateSearchResults] = useState<PrivateSearchMember[]>([]);
  const [privateSearchLoading, setPrivateSearchLoading] = useState(false);
  const [privateSearchError, setPrivateSearchError] = useState<string | null>(null);
  const [senderZoneIds, setSenderZoneIds] = useState<string[]>([]);
  const [privateLocationStatus, setPrivateLocationStatus] =
    useState<PrivateLocationStatus | null>(null);
  const [senderZoneCheckLoading, setSenderZoneCheckLoading] = useState(false);
  const [composeZones, setComposeZones] = useState<ComposeZoneOption[]>([]);
  const [composeZoneSelection, setComposeZoneSelection] = useState<"all" | number>("all");
  const [zoneRecipients, setZoneRecipients] = useState<PrivateSearchMember[]>([]);
  const [zoneRecipientGroups, setZoneRecipientGroups] = useState<
    { zoneRecordId: number; label: string; members: PrivateSearchMember[] }[]
  >([]);
  const [zoneRecipientsLoading, setZoneRecipientsLoading] = useState(false);
  const [receiversModalOpen, setReceiversModalOpen] = useState(false);
  const [loadingComposeZones, setLoadingComposeZones] = useState(false);
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

  useEffect(() => {
    const typeParam = searchParams.get("type")?.trim() ?? "";
    const messageParam = searchParams.get("message")?.trim() ?? "";
    if (typeParam) {
      const resolved = toMessageType(typeParam);
      if (resolved && getMessageTypeCategory(resolved) !== "Alarm") {
        setTypeFilter(resolved);
      }
    }
    if (messageParam) setActiveMessageId(messageParam);
  }, [searchParams]);

  const filterZoneIds = useMemo(() => {
    const fromMessages = messages
      .filter((m) => m.category !== "Alarm")
      .map((m) => String(m.zone_id ?? "").trim())
      .filter(Boolean);
    return Array.from(new Set(fromMessages)).sort();
  }, [messages]);

  useEffect(() => {
    if (zoneFilter !== "all" && !filterZoneIds.includes(zoneFilter)) {
      setZoneFilter("all");
    }
  }, [filterZoneIds, zoneFilter]);

  const allZoneIds = useMemo(
    () => Array.from(new Set([...dbZoneIds, ...zones])),
    [dbZoneIds, zones],
  );
  const composeZoneId = useMemo(
    () => (userZoneId == null ? null : String(userZoneId).trim()),
    [userZoneId],
  );
  const selectedZoneRecordId =
    composeZoneSelection === "all" ? null : composeZoneSelection;
  const showComposeZonePicker =
    usesComposeZoneTargeting(composeType) &&
    (composeZones.length > 1 || (isSystemAdmin && composeZones.length > 0));

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

  const { lastMessage: guestWsMessage, status: guestWsStatus } = useWebSocket({
    token,
    zoneIds: effectiveZoneForGuests.trim() ? [effectiveZoneForGuests.trim()] : [],
  });

  useEffect(() => {
    const z = effectiveZoneForGuests.trim();
    if (!z) return;
    if (guestWsStatus === "open") return;
    const intervalId = window.setInterval(() => {
      void listGuestRequestsForZone(z).then((res) => {
        if (res.error) return;
        setGuestRows(res.data);
      });
    }, 18_000);
    return () => window.clearInterval(intervalId);
  }, [effectiveZoneForGuests, guestWsStatus]);

  useEffect(() => {
    if (!guestWsMessage) return;
    try {
      const parsed = JSON.parse(guestWsMessage) as { type?: string };
      if (
        parsed.type === "GUEST_REQUEST_CHANGED" ||
        parsed.type === "unexpected_guest" ||
        parsed.type === "guest_is_here" ||
        parsed.type === "PERMISSION_MESSAGE"
      ) {
        const z = effectiveZoneForGuests.trim();
        if (!z) return;
        void listGuestRequestsForZone(z).then((res) => {
          if (res.error) return;
          setGuestRows(res.data);
        });
      }
    } catch {
      /* ignore */
    }
  }, [guestWsMessage, effectiveZoneForGuests]);

  const accessZonePermissionCount = useMemo(
    () => messages.reduce((acc, m) => acc + (m.type === "PERMISSION" ? 1 : 0), 0),
    [messages],
  );
  const showMessagesIntegrationBanner =
    import.meta.env.VITE_SHOW_MESSAGES_INTEGRATION_BANNER === "true";

  useEffect(() => {
    setComposeReceiverId("");
    setPrivateSearchQuery("");
    setPrivateSearchResults([]);
    setComposeZoneSelection("all");
    setZoneRecipients([]);
  }, [composeType]);

  /** PRIVATE: zone gate + recipient search (same position workflow as PANIC). */
  useEffect(() => {
    if (!isPrivateMessageType(composeType) || selectedZoneRecordId != null) {
      if (!isPrivateMessageType(composeType) && selectedZoneRecordId == null) {
        setPrivateSearchError(null);
        setSenderZoneIds([]);
        setPrivateLocationStatus(null);
        setPrivateSearchResults([]);
      }
      setSenderZoneCheckLoading(false);
      setPrivateSearchLoading(false);
      return;
    }

    let active = true;
    setSenderZoneCheckLoading(true);
    setPrivateSearchError(null);

    const debounceMs = privateSearchQuery.trim().length >= 2 ? 300 : 0;
    const timer = window.setTimeout(() => {
      void (async () => {
        const resolved = await resolveMessagePropagationPositionForType(
          "PRIVATE",
          user?.mapCenter ?? user?.map_center ?? null,
        );
        const position = "error" in resolved ? undefined : resolved.position;
        const result = await searchPrivateMessageRecipients(
          privateSearchQuery,
          position,
        );
        if (!active) return;
        setSenderZoneCheckLoading(false);
        setPrivateSearchLoading(false);
        if (result.error) {
          setPrivateSearchError(result.error);
          setPrivateSearchResults([]);
          setSenderZoneIds([]);
          setPrivateLocationStatus(null);
          return;
        }
        setSenderZoneIds(result.data?.zone_ids ?? []);
        setPrivateLocationStatus(result.data?.location_status ?? null);
        setPrivateSearchResults(result.data?.members ?? []);
      })();
    }, debounceMs);

    if (privateSearchQuery.trim().length >= 2) {
      setPrivateSearchLoading(true);
    }

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [composeType, privateSearchQuery, selectedZoneRecordId, user?.mapCenter, user?.map_center]);

  useEffect(() => {
    if (!usesComposeZoneTargeting(composeType)) {
      setComposeZones([]);
      setComposeZoneSelection("all");
      setZoneRecipients([]);
      setZoneRecipientGroups([]);
      setLoadingComposeZones(false);
      setReceiversModalOpen(false);
      return;
    }
    let active = true;
    setComposeZones([]);
    setComposeZoneSelection("all");
    setZoneRecipients([]);
    setZoneRecipientGroups([]);
    setLoadingComposeZones(true);
    void (async () => {
      try {
        const resolved = await resolveMessagePropagationPositionForType(
          composeType,
          user?.mapCenter ?? user?.map_center ?? null,
        );
        const position = "error" in resolved ? undefined : resolved.position;
        const result = await listComposeZones(position);
        if (!active) return;
        const zones = result.data?.zones ?? [];
        setComposeZones(zones);
      } finally {
        if (active) setLoadingComposeZones(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [composeType, user?.mapCenter, user?.map_center]);

  useEffect(() => {
    if (
      !usesComposeZoneTargeting(composeType) ||
      isAccessGuestChannelType(composeType)
    ) {
      if (!usesComposeZoneTargeting(composeType)) {
        setZoneRecipients([]);
        setZoneRecipientGroups([]);
      }
      setZoneRecipientsLoading(false);
      return;
    }
    if (isPrivateMessageType(composeType) && selectedZoneRecordId == null) {
      setZoneRecipients([]);
      setZoneRecipientGroups([]);
      setZoneRecipientsLoading(false);
      return;
    }
    if (selectedZoneRecordId == null) {
      if (loadingComposeZones) return;
      if (composeZones.length === 0) {
        setZoneRecipients([]);
        setZoneRecipientGroups([]);
        setZoneRecipientsLoading(false);
        return;
      }
    }

    const zoneTargets =
      selectedZoneRecordId != null
        ? [
            composeZones.find((z) => z.zone_record_id === selectedZoneRecordId) ?? {
              zone_record_id: selectedZoneRecordId,
              zone_id: "",
              name: null,
              label: "Selected zone",
              tier: "secondary",
            },
          ]
        : composeZones;

    let active = true;
    setZoneRecipientsLoading(true);
    const debounceMs =
      isPrivateMessageType(composeType) && privateSearchQuery.trim().length >= 2
        ? 300
        : 0;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const resolved = await resolveMessagePropagationPositionForType(
            composeType,
            user?.mapCenter ?? user?.map_center ?? null,
          );
          const position = "error" in resolved ? undefined : resolved.position;
          const groups = await Promise.all(
            zoneTargets.map(async (zone) => {
              const result = await listComposeZoneRecipients({
                zoneRecordId: zone.zone_record_id,
                type: composeType as MessageFeatureType,
                position,
                query:
                  isPrivateMessageType(composeType) &&
                  privateSearchQuery.trim().length >= 2
                    ? privateSearchQuery
                    : "",
              });
              return {
                zoneRecordId: zone.zone_record_id,
                label: zone.label,
                members: result.error ? [] : (result.data?.members ?? []),
              };
            }),
          );
          if (!active) return;
          setZoneRecipientGroups(groups);
          const merged = new Map<number, PrivateSearchMember>();
          for (const group of groups) {
            for (const member of group.members) {
              merged.set(member.id, member);
            }
          }
          setZoneRecipients(Array.from(merged.values()));
          setPrivateLocationStatus(
            groups.some((g) => g.members.length > 0) || composeZones.length > 0
              ? "inside_zone"
              : "outside_zone",
          );
          setSenderZoneIds(
            Array.from(
              new Set(
                zoneTargets
                  .map((z) => String(z.zone_id ?? "").trim())
                  .filter(Boolean),
              ),
            ),
          );
        } finally {
          if (active) setZoneRecipientsLoading(false);
        }
      })();
    }, debounceMs);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    composeType,
    selectedZoneRecordId,
    composeZones,
    loadingComposeZones,
    privateSearchQuery,
    user?.mapCenter,
    user?.map_center,
  ]);

  useEffect(() => {
    setReceiversModalOpen(false);
  }, [composeType]);

  /** Defaults intentionally include CHAT (Access). Alarms live on Incoming Alarms. */
  const filteredMessages = useMemo(
    () =>
      applyMessageInboxFilters(messages, {
        excludeCategories: ["Alarm"],
        zoneFilter,
        typeFilter,
        dateFrom,
        dateTo,
        search,
      }),
    [messages, zoneFilter, typeFilter, dateFrom, dateTo, search],
  );

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
      const id = Number(row.id);
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
      `${label} is a maximum-priority emergency alarm using your current location. Inside the admin primary zone, all invited members and the administrator are notified; outside the primary zone, no one receives it. Block filters are bypassed. Send now?`,
    );
  }, []);

  const profileMapCenter = user?.mapCenter ?? user?.map_center ?? null;

  const resolveSenderPosition = useCallback(
    async (messageType: MessageType): Promise<ResolvedMessagePosition | { error: string }> =>
      resolveMessagePropagationPositionForType(messageType, profileMapCenter),
    [profileMapCenter],
  );

  const sendQuickAlert = useCallback(
    async (type: QuickMessageType) => {
      if (quickBusy) return;
      if (isPrivateMessageType(type as MessageType)) {
        setComposeType(type as MessageType);
        setComposeText(
          type in settings.quickMessages
            ? (settings.quickMessages[type as QuickMessageType] ?? "").trim()
            : "",
        );
        setQuickStatus("");
        return;
      }
      if (!confirmEmergencySend(type as MessageType)) return;
      const presetText =
        type in settings.quickMessages
          ? (settings.quickMessages[type as QuickMessageType] ?? "").trim()
          : "";
      if (!presetText) {
        // Types without a preset (e.g. PRIVATE) switch the composer instead.
        setComposeType(type as MessageType);
        setComposeText("");
        return;
      }
      setQuickBusy(type);
      setQuickStatus(`Sending ${toMessageTypeLabel(type as MessageType)}…`);
      try {
        const resolved = await resolveSenderPosition(type as MessageType);
        if ("error" in resolved && !isSystemAdmin) {
          setQuickStatus(resolved.error);
          return;
        }
        const position = "error" in resolved ? undefined : resolved.position;
        const source = "error" in resolved ? undefined : resolved.source;
        const propagateResult = await propagateMessageFeatureMessage({
          type: type as MessageFeatureType,
          hid: resolveGuestBrowserDeviceId(),
          msg: {
            description: presetText,
            broadcast_name: selfBroadcastName,
            ...(position
              ? { latitude: position.latitude, longitude: position.longitude }
              : {}),
          },
          ...(position ? { position } : {}),
        });
        if (propagateResult.error) {
          setQuickStatus(propagateResult.error);
          return;
        }
        const body = propagateResult.data;
        toastSmartHomeWebhookDelivery(body);
        if (body && !body.skipped && body.id) {
          dispatchGeoPropagationInbox({
            ...body,
            sender_id:
              body.sender_id ?? (Number.isFinite(ownerId) ? ownerId : undefined),
            zone_id: body.zone_id ?? body.zone_ids?.[0] ?? (composeZoneId ?? undefined),
          });
        }
        setQuickStatus(
          source
            ? `${toMessageTypeLabel(type as MessageType)} sent · ${messagePositionSourceLabel(source)}.`
            : `${toMessageTypeLabel(type as MessageType)} sent to all zones.`,
        );
        void refreshInbox();
      } finally {
        setQuickBusy(null);
      }
    },
    [
      quickBusy,
      settings.quickMessages,
      resolveSenderPosition,
      selfBroadcastName,
      ownerId,
      composeZoneId,
      refreshInbox,
      confirmEmergencySend,
      isSystemAdmin,
    ],
  );

  const handleSend = async () => {
    if (composeSending) return;
    if (!composeType) {
      setComposeStatus("Message Type is required.");
      return;
    }
    if (!confirmEmergencySend(composeType)) return;
    const servicePaValidation = validateServicePaCompose(
      composeType,
      composeServicePaFields,
      composeText,
    );
    if (servicePaValidation) {
      setComposeStatus(servicePaValidation);
      return;
    }
    if (!composeText.trim() && !isServicePaMessageType(composeType)) return;
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
    setComposeSending(true);
    setComposeStatus("Sending...");

    try {
    if (usesGeoPropagationMessageType(composeType)) {
      const resolved = await resolveSenderPosition(composeType);
      if ("error" in resolved && !isSystemAdmin) {
        setComposeStatus(resolved.error);
        return;
      }
      const position = "error" in resolved ? undefined : resolved.position;
      const source = "error" in resolved ? undefined : resolved.source;
      const featureType = composeType as MessageFeatureType;
      const propagateResult = await propagateMessageFeatureMessage({
        type: featureType,
        hid: resolveGuestBrowserDeviceId(),
        msg: isServicePaMessageType(composeType)
          ? buildServicePaMsgPayload(composeServicePaFields, composeText.trim(), {
              broadcast_name: selfBroadcastName,
              ...(position
                ? { latitude: position.latitude, longitude: position.longitude }
                : {}),
            })
          : {
              description: composeText.trim(),
              broadcast_name: selfBroadcastName,
              ...(position
                ? { latitude: position.latitude, longitude: position.longitude }
                : {}),
            },
        ...(position ? { position } : {}),
        ...(isPrivateMessageType(composeType)
          ? { receiver_owner_id: parsedReceiverId }
          : {}),
        ...(selectedZoneRecordId != null
          ? { zone_record_id: selectedZoneRecordId }
          : {}),
      });
      if (propagateResult.error) {
        setComposeStatus(propagateResult.error);
        return;
      }
      const body = propagateResult.data;
      toastSmartHomeWebhookDelivery(body);
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
      setComposeStatus(
        source
          ? `Sent · ${messagePositionSourceLabel(source)}.`
          : "Sent to selected zone(s).",
      );
      setComposeText("");
      setComposeServicePaFields({ subject: "", topic: "", subtopic: "" });
      if (isPrivateMessageType(composeType)) setComposeReceiverId("");
      void refreshInbox();
      return;
    }

    const resolved = await resolveSenderPosition(composeType);
    if ("error" in resolved) {
      setComposeStatus(resolved.error);
      return;
    }
    const { position } = resolved;

    const result = await sendMessage({
      message: composeText.trim(),
      type: composeType,
      broadcast_name: selfBroadcastName,
      latitude: position.latitude,
      longitude: position.longitude,
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
    } finally {
      setComposeSending(false);
    }
  };

  const selectableGuests = useMemo(
    () => guestRows.filter((r) => r.status !== "REJECTED"),
    [guestRows],
  );

  const groupedTypeOptions = useMemo(() => groupMessageTypesForUI(), []);
  /** Inbox filter: Alert + Access only (alarms are on Incoming Alarms). */
  const inboxTypeOptions = useMemo(
    () => groupMessageTypesForCategories(["Alert", "Access"]),
    [],
  );
  const composeTypeOptions = useMemo(
    () =>
      groupedTypeOptions
        .map((group) => ({
          ...group,
          options: group.options.filter((option) => option.type !== "PERMISSION"),
        }))
        .filter((group) => group.options.length > 0),
    [groupedTypeOptions],
  );
  const visibleMessagingActions = MESSAGING_ACTIONS;

  const [composeTypeNotice, setComposeTypeNotice] = useState<string | null>(null);

  useEffect(() => {
    if (composeType !== "PERMISSION") return;
    setComposeType("CHAT");
    setComposeTypeNotice(
      "PERMISSION events are automatic from guest access workflow; switched to CHAT.",
    );
  }, [composeType]);

  const selectMessagingType = (type: MessageType) => {
    setComposeType(type);
    setComposeServicePaFields({ subject: "", topic: "", subtopic: "" });
    const preset =
      type in settings.quickMessages
        ? (settings.quickMessages[type as QuickMessageType] ?? "").trim()
        : "";
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
              const isUnknown = isUnknownMessageType(action.type as MessageType);
              const urgent = isEmergencyMessageType(action.type as MessageType);
              const nsPanic = action.type === "NS_PANIC";
              return (
                <button
                  key={action.type}
                  type="button"
                  disabled={!!quickBusy}
                  onClick={() => void sendQuickAlert(action.type as QuickMessageType)}
                  className={`flex flex-col items-center justify-center gap-2 rounded-xl border px-3 py-6 transition disabled:opacity-60 ${
                    nsPanic
                      ? "border-[#B5179E] bg-[#B5179E] text-white shadow-md hover:brightness-110"
                      : isUnknown
                        ? "border-[#B71C1C] bg-[#C62828] text-white shadow-md hover:brightness-110"
                        : urgent
                          ? "border-[#E23B4E] bg-[#E23B4E] text-white shadow-md hover:brightness-110"
                          : "border-[#F3C2CA] bg-[#FCE7EA] text-[#E23B4E] hover:brightness-95"
                  }`}
                >
                  <Icon className="h-7 w-7" aria-hidden />
                  <span className="text-sm font-extrabold tracking-wide">
                    {quickBusy === action.type ? "Sending…" : action.label}
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
              const isService = isServiceMessageType(action.type as MessageType);
              return (
                <button
                  key={action.type}
                  type="button"
                  onClick={() => selectMessagingType(action.type)}
                  className={`flex flex-col items-center justify-center gap-2 rounded-xl border px-3 py-6 text-center transition hover:brightness-95 ${
                    isService
                      ? "border-[#1B5E20] bg-[#2E7D32] text-white shadow-md hover:brightness-110"
                      : "border-[#F0DBB0] bg-[#FBEFD8] text-[#E0992A]"
                  }`}
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

      <MessageInboxFilterBar
        search={search}
        onSearchChange={setSearch}
        zoneFilter={zoneFilter}
        onZoneFilterChange={setZoneFilter}
        zoneIds={filterZoneIds}
        zoneNames={zoneNames}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        typeOptions={[]}
        typeGroups={inboxTypeOptions}
        typeAllLabel="All message types"
        dateFrom={dateFrom}
        onDateFromChange={setDateFrom}
        dateTo={dateTo}
        onDateToChange={setDateTo}
        searchPlaceholder="Search messages…"
      />

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
            viewerOwnerId={ownerId}
            zoneNames={zoneNames}
          />
        </div>
        <div className="space-y-4">
          <MessageDetail
            message={activeMessage}
            currentOwnerId={ownerId}
            ownerNameById={ownerNameById}
            zoneNames={zoneNames}
          />
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
                setComposeServicePaFields({ subject: "", topic: "", subtopic: "" });
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
            {composeTypeNotice ? (
              <p className="text-xs text-[#E0992A]">{composeTypeNotice}</p>
            ) : null}
            {usesComposeZoneTargeting(composeType) ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-[#566784]">Send to zone</p>
                {loadingComposeZones ? (
                  <p className="text-xs text-[#8694AC]">Checking zones for this message type…</p>
                ) : composeZones.length === 0 ? (
                  <p className="text-xs text-[#8694AC]">
                    {isSystemAdmin
                      ? "No zones on the platform."
                      : "No overlapping zones at this message type's send location."}
                  </p>
                ) : showComposeZonePicker ? (
                  <>
                    <p className="text-xs text-[#8694AC]">
                      {isSystemAdmin
                        ? "Choose any zone, or send to every zone. You do not need to be inside a zone."
                        : "You are inside more than one zone. Choose one zone or keep all zones."}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setComposeZoneSelection("all");
                          setComposeReceiverId("");
                        }}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                          composeZoneSelection === "all"
                            ? "border-[#2F80ED] bg-[#EDF3FB] text-[#2F80ED]"
                            : "border-[#DCE6F2] bg-[#F7FAFE] text-[#566784]"
                        }`}
                      >
                        All zones
                      </button>
                      {composeZones.map((zone) => (
                        <button
                          key={zone.zone_record_id}
                          type="button"
                          onClick={() => {
                            setComposeZoneSelection(zone.zone_record_id);
                            setComposeReceiverId("");
                          }}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                            composeZoneSelection === zone.zone_record_id
                              ? "border-[#2F80ED] bg-[#EDF3FB] text-[#2F80ED]"
                              : "border-[#DCE6F2] bg-[#F7FAFE] text-[#566784]"
                          }`}
                        >
                          {zone.label}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-[#8694AC]">
                    {composeZones[0]?.label ?? "1 zone"}
                  </p>
                )}
                {!isAccessGuestChannelType(composeType) &&
                !isPrivateMessageType(composeType) &&
                composeZones.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setReceiversModalOpen(true)}
                    className="rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-xs font-semibold text-[#2F80ED]"
                  >
                    View possible receivers
                  </button>
                ) : null}
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
                <input
                  type="search"
                  value={privateSearchQuery}
                  onChange={(e) => {
                    setPrivateSearchQuery(e.target.value);
                    setComposeReceiverId("");
                  }}
                  placeholder="Search member by name or email"
                  className="w-full rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2.5 text-sm text-[#0F2C5C] outline-none focus:border-[#2F80ED]"
                />
                {privateSearchError ? (
                  <p className="text-xs text-[#E0992A]">{privateSearchError}</p>
                ) : null}
                {!senderZoneCheckLoading && !privateSearchError ? (
                  (() => {
                    const locationNote = privateLocationStatusMessage(privateLocationStatus);
                    return locationNote ? (
                      <p className="text-xs text-[#8694AC]">{locationNote}</p>
                    ) : null;
                  })()
                ) : null}
                {senderZoneIds.length > 0 ? (
                  <p className="text-xs text-[#8694AC]">
                    {selectedZoneRecordId != null
                      ? "Members reachable in the selected zone. You cannot select yourself."
                      : "Search admin and members reachable in this zone (same as PANIC). You cannot select yourself."}
                  </p>
                ) : null}
                {(selectedZoneRecordId != null
                  ? zoneRecipientsLoading
                  : privateSearchLoading) ? (
                  <p className="text-xs text-[#8694AC]">
                    {selectedZoneRecordId != null ? "Loading receivers…" : "Searching…"}
                  </p>
                ) : null}
                {(selectedZoneRecordId != null
                  ? zoneRecipients
                  : privateSearchResults
                ).length > 0 ? (
                  <ul className="max-h-40 overflow-y-auto rounded-lg border border-[#DCE6F2] bg-[#F7FAFE]">
                    {(selectedZoneRecordId != null
                      ? zoneRecipients
                      : privateSearchResults
                    ).map((row) => {
                      const name = memberBroadcastName(row);
                      const distance = memberDistanceLabel(row);
                      return (
                      <li key={`search-${row.id}`}>
                        <button
                          type="button"
                          onClick={() => {
                            setComposeReceiverId(String(row.id));
                            setPrivateSearchQuery(name);
                          }}
                          className={`w-full px-3 py-2 text-left text-sm hover:bg-[#EDF3FB] ${
                            composeReceiverId === String(row.id)
                              ? "bg-[#EDF3FB] font-semibold text-[#2F80ED]"
                              : "text-[#0F2C5C]"
                          }`}
                        >
                          <span>{name}</span>
                          {distance ? (
                            <span className="ml-2 text-xs text-[#8694AC]">
                              {distance}
                            </span>
                          ) : null}
                        </button>
                      </li>
                      );
                    })}
                  </ul>
                ) : null}
                {privateSearchQuery.trim().length >= 2 &&
                !(selectedZoneRecordId != null
                  ? zoneRecipientsLoading
                  : privateSearchLoading) &&
                senderZoneIds.length > 0 &&
                (selectedZoneRecordId != null
                  ? zoneRecipients
                  : privateSearchResults
                ).length === 0 ? (
                  <p className="text-xs text-[#8694AC]">No members matched your search.</p>
                ) : null}
                {composeReceiverId ? (
                  <p className="text-xs text-[#566784]">
                    Selected recipient id:{" "}
                    <span className="font-mono">{composeReceiverId}</span>
                  </p>
                ) : null}
              </>
            )}
            <ServicePaComposeFieldsPanel
              type={composeType}
              fields={composeServicePaFields}
              onChange={setComposeServicePaFields}
            />
            <textarea
              rows={4}
              value={composeText}
              onChange={(e) => setComposeText(e.target.value)}
              disabled={composeSending}
              placeholder={
                isServicePaMessageType(composeType)
                  ? "Message body..."
                  : "Type your message..."
              }
              className="w-full rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2.5 text-sm text-[#0F2C5C] outline-none focus:border-[#2F80ED]"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={composeSending}
              className="w-full rounded-lg bg-[#2F80ED] px-4 py-2.5 text-sm font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {composeSending ? "Sending…" : "Send Message"}
            </button>
            <p className="text-xs text-[#8694AC]">
              Sending as <span className="font-semibold text-[#2F80ED]">{selfBroadcastName}</span>{" "}
              (owner <span className="font-mono">{ownerId || "?"}</span>)
            </p>
            <p className="text-xs text-[#8694AC]">
              {zonesLoading
                ? "Loading network IDs from database..."
                : `Network IDs loaded: ${allZoneIds.length}`}
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
                {senderZoneCheckLoading
                  ? "Checking your zone…"
                  : privateLocationStatus === "inside_zone"
                    ? `Inside zone(s): ${senderZoneIds.join(", ")}`
                    : privateLocationStatusMessage(privateLocationStatus) ??
                      "Checking your zone…"}
              </p>
            )}
            <p className="text-xs text-[#8694AC]">
              Selected type: {toMessageTypeLabel(composeType)}
            </p>
            {composeStatus && <p className="text-xs text-[#566784]">{composeStatus}</p>}
          </section>
        </div>
      </div>

      {receiversModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F2C5C]/55 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Possible receivers"
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close receivers list"
            onClick={() => setReceiversModalOpen(false)}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-[#C2D2E6] bg-white p-4 shadow-xl">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-[#0F2C5C]">Possible receivers</h3>
              <button
                type="button"
                onClick={() => setReceiversModalOpen(false)}
                className="rounded-lg px-2 py-1 text-xs font-semibold text-[#566784] hover:bg-[#F7FAFE]"
              >
                Close
              </button>
            </div>
            <p className="mb-3 text-xs text-[#8694AC]">
              {composeZoneSelection === "all"
                ? `${isSystemAdmin ? "All zones" : "All overlapping zones"} (${composeZones.length})`
                : composeZones.find((z) => z.zone_record_id === composeZoneSelection)
                    ?.label ?? "Selected zone"}
            </p>
            {zoneRecipientsLoading ? (
              <p className="text-xs text-[#8694AC]">Loading receivers…</p>
            ) : composeZoneSelection === "all" ? (
              zoneRecipientGroups.length === 0 ||
              zoneRecipientGroups.every((g) => g.members.length === 0) ? (
                <p className="text-xs text-[#8694AC]">No receivers for this selection.</p>
              ) : (
                <div className="max-h-72 space-y-3 overflow-y-auto">
                  {zoneRecipientGroups.map((group) => (
                    <div key={`recv-group-${group.zoneRecordId}`}>
                      <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[#8694AC]">
                        {group.label}
                      </p>
                      {group.members.length === 0 ? (
                        <p className="text-xs text-[#8694AC]">No receivers in this zone.</p>
                      ) : (
                        <ul className="rounded-lg border border-[#DCE6F2] bg-[#F7FAFE]">
                          {group.members.map((row) => {
                            const distance = memberDistanceLabel(row);
                            return (
                            <li
                              key={`recv-modal-${group.zoneRecordId}-${row.id}`}
                              className="flex items-center justify-between gap-3 border-b border-[#DCE6F2] px-3 py-2 text-sm text-[#0F2C5C] last:border-b-0"
                            >
                              <span className="min-w-0 truncate font-medium">
                                {memberBroadcastName(row)}
                              </span>
                              {distance ? (
                                <span className="shrink-0 text-xs text-[#8694AC]">
                                  {distance}
                                </span>
                              ) : null}
                            </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )
            ) : zoneRecipients.length === 0 ? (
              <p className="text-xs text-[#8694AC]">No receivers for this selection.</p>
            ) : (
              <ul className="max-h-72 overflow-y-auto rounded-lg border border-[#DCE6F2] bg-[#F7FAFE]">
                {zoneRecipients.map((row) => {
                  const distance = memberDistanceLabel(row);
                  return (
                  <li
                    key={`recv-modal-${row.id}`}
                    className="flex items-center justify-between gap-3 border-b border-[#DCE6F2] px-3 py-2 text-sm text-[#0F2C5C] last:border-b-0"
                  >
                    <span className="min-w-0 truncate font-medium">
                      {memberBroadcastName(row)}
                    </span>
                    {distance ? (
                      <span className="shrink-0 text-xs text-[#8694AC]">
                        {distance}
                      </span>
                    ) : null}
                  </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
