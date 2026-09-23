import { Lock } from "lucide-react";
import { formatMessageSenderLabel, type Message } from "../../services/api/messages";
import { formatMessageCoordinatesLabel } from "../../lib/messageCoordinates";
import { toMessageTypeLabel } from "../../lib/messageTypes";
import { isServiceMessageType, isUnknownMessageType } from "../../lib/messageWorkflow";
import {
  isPermissionDirectVisibility,
  isPermissionZonePendingBroadcastVisibility,
} from "../../lib/permissionVisibility";
import {
  messageZoneLabel,
  type ZoneNameLookup,
} from "../../lib/messageZoneLabel";

function inboxDayKey(value: string | null | undefined): string {
  if (!value) return "";
  const t = new Date(value);
  if (!Number.isFinite(t.getTime())) return "";
  return `${t.getFullYear()}-${t.getMonth() + 1}-${t.getDate()}`;
}

function startOfLocalDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

function inboxSenderKey(message: Message): string {
  const guest =
    (message.guest_sender_id ?? "").trim() ||
    (message.sender_id === 0 ? (message.guest_id ?? "").trim() : "");
  if (guest) return `guest:${guest}`;
  return `owner:${message.sender_id}`;
}

function messagesFormCluster(a: Message | undefined, b: Message | undefined): boolean {
  if (!a || !b) return false;
  const aSys =
    a.type === "PERMISSION" || isServiceMessageType(a.type);
  const bSys =
    b.type === "PERMISSION" || isServiceMessageType(b.type);
  if (aSys || bSys) return false;
  if (inboxSenderKey(a) !== inboxSenderKey(b)) return false;
  if (inboxDayKey(a.created_at) !== inboxDayKey(b.created_at)) return false;
  const ta = new Date(a.created_at).getTime();
  const tb = new Date(b.created_at).getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false;
  return Math.abs(ta - tb) <= 5 * 60 * 1000;
}

function inboxBubbleCluster(
  prev: Message | undefined,
  item: Message,
  next: Message | undefined,
): "single" | "start" | "middle" | "end" {
  const withPrev = messagesFormCluster(prev, item);
  const withNext = messagesFormCluster(item, next);
  if (withPrev && withNext) return "middle";
  if (withPrev) return "end";
  if (withNext) return "start";
  return "single";
}

type ClusterRow = {
  message: Message;
  cluster: "single" | "start" | "middle" | "end";
  dayLabel: string | null;
};

function groupInboxClusters(messages: Message[]): ClusterRow[][] {
  const groups: ClusterRow[][] = [];
  messages.forEach((message, index) => {
    const prev = messages[index - 1];
    const next = messages[index + 1];
    const cluster = inboxBubbleCluster(prev, message, next);
    const dayLabel =
      !prev || inboxDayKey(prev.created_at) !== inboxDayKey(message.created_at)
        ? formatInboxDayLabel(message.created_at)
        : null;
    const row: ClusterRow = { message, cluster, dayLabel };
    if (cluster === "middle" || cluster === "end") {
      groups[groups.length - 1]?.push(row);
      return;
    }
    groups.push([row]);
  });
  return groups;
}

function formatInboxDayLabel(value: string | null | undefined): string {
  if (!value) return "";
  const t = new Date(value);
  if (!Number.isFinite(t.getTime())) return "";
  const diffDays = Math.round((startOfLocalDay(new Date()) - startOfLocalDay(t)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return t.toLocaleDateString(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

export function MessageList({
  messages,
  activeId,
  onSelect,
  emptyLabel = "No messages found for current filters.",
  getBroadcastName,
  viewerOwnerId,
  zoneNames,
}: {
  messages: Message[];
  activeId: string | null;
  onSelect: (id: string) => void;
  /** Shown when the (possibly filtered) section has no rows. */
  emptyLabel?: string;
  /** Resolve a sender's broadcast name for prominent display. */
  getBroadcastName?: (message: Message) => string;
  viewerOwnerId?: number | null;
  zoneNames?: ZoneNameLookup;
}) {
  if (messages.length === 0) {
    return (
      <div className="rounded-2xl border border-[#DCE6F2] bg-white p-8 text-center text-[#566784]">
        {emptyLabel}
      </div>
    );
  }

  const toneForCategory = (category: Message["category"]) =>
    category === "Alarm"
      ? "bg-[#FCE7EA] text-[#E23B4E]"
      : category === "Access"
        ? "bg-[#FBEFD8] text-[#E0992A]"
        : "bg-[#EDF3FB] text-[#2F80ED]";

  const groups = groupInboxClusters(messages);

  return (
    <ul className="space-y-0">
      {groups.map((group) => {
        const first = group[0];
        if (!first) return null;
        const firstMine =
          viewerOwnerId != null &&
          typeof first.message.sender_id === "number" &&
          first.message.sender_id > 0 &&
          first.message.sender_id === viewerOwnerId;
        return (
          <li key={first.message.id} className="mb-1.5 space-y-2">
            {first.dayLabel ? (
              <p className="text-center text-[11px] font-bold text-[#8694AC]">{first.dayLabel}</p>
            ) : null}
            {(() => {
              const firstIsSystem =
                first.message.type === "PERMISSION" ||
                isServiceMessageType(first.message.type);
              if (firstIsSystem) {
                const message = first.message;
                const active = activeId === message.id;
                const isService = isServiceMessageType(message.type);
                const networkLabel = messageZoneLabel(message, { viewerOwnerId, zoneNames });
                return (
                  <div className="w-full px-1">
                    <button
                      type="button"
                      onClick={() => onSelect(message.id)}
                      className={`w-full rounded-2xl border px-3 py-2.5 text-center transition ${
                        active
                          ? isService
                            ? "border-[#2E7D32] bg-[#E8F5E9]"
                            : "border-[#E0992A] bg-[#FBEFD8]"
                          : isService
                            ? "border-[#2E7D32] bg-[#E8F5E9] hover:brightness-95"
                            : "border-[#E0992A] bg-[#FBEFD8] hover:brightness-95"
                      }`}
                    >
                      {message.subject ? (
                        <p
                          className={`font-bold ${
                            isService ? "text-[#1B5E20]" : "text-[#E0992A]"
                          }`}
                        >
                          {message.subject}
                        </p>
                      ) : null}
                      {message.message && message.message !== message.subject ? (
                        <p
                          className={`${message.subject ? "mt-1" : ""} text-sm font-semibold ${
                            isService ? "text-[#33691E]" : "text-[#E0992A]"
                          }`}
                        >
                          {message.message}
                        </p>
                      ) : !message.subject ? (
                        <p
                          className={`text-sm font-semibold ${
                            isService ? "text-[#33691E]" : "text-[#E0992A]"
                          }`}
                        >
                          {message.message || "—"}
                        </p>
                      ) : null}
                      <div className="mt-2 flex items-center justify-between gap-2 text-[10px]">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <span
                            className={`rounded-full px-2 py-0.5 font-semibold ${
                              isService
                                ? "bg-[#2E7D32] text-white"
                                : "bg-[#FBEFD8] text-[#E0992A]"
                            }`}
                          >
                            {toMessageTypeLabel(message.type)}
                          </span>
                          <span className="rounded-full bg-[#EDF3FB] px-2 py-0.5 text-[#566784]">
                            {networkLabel}
                          </span>
                        </div>
                        <p
                          className={`shrink-0 font-semibold ${
                            isService ? "text-[#4CAF50]" : "text-[#C48A2A]"
                          }`}
                        >
                          {new Date(message.created_at).toLocaleTimeString(undefined, {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </button>
                  </div>
                );
              }
              return (
            <div className={`flex ${firstMine ? "justify-end" : "justify-start"}`}>
              <div className="flex w-fit max-w-[80%] flex-col gap-0 -space-y-px">
                {group.map(({ message, cluster }) => {
        const active = activeId === message.id;
        const isUnknown = isUnknownMessageType(message.type);
        const isService = isServiceMessageType(message.type);
        const isPermission = message.type === "PERMISSION";
        const isMine =
          viewerOwnerId != null &&
          typeof message.sender_id === "number" &&
          message.sender_id > 0 &&
          message.sender_id === viewerOwnerId;
        const useAccentBubble =
          isMine && !isPermission && !isUnknown && !isService && message.category !== "Alarm";
        const zoneBroadcast =
          isPermission &&
          isPermissionZonePendingBroadcastVisibility(message.permission_visibility);
        const privateAudit =
          isPermission && isPermissionDirectVisibility(message.permission_visibility);
        const senderName = getBroadcastName
          ? getBroadcastName(message)
          : formatMessageSenderLabel(message);
        const showHeader = cluster === "single" || cluster === "start";
        const showBadges = cluster === "single" || cluster === "end";
        const radiusClass = showHeader
          ? showBadges
            ? "rounded-2xl"
            : "rounded-t-2xl rounded-b-none"
          : showBadges
            ? "rounded-b-2xl rounded-t-none"
            : "rounded-none";
        return (
              <button
                key={message.id}
                type="button"
                onClick={() => onSelect(message.id)}
                className={`block w-full border px-2 py-1.5 text-left transition ${radiusClass} ${
                  useAccentBubble
                    ? active
                      ? "border-[#1B5BB5] bg-[#2F80ED] text-white"
                      : "border-[#2F80ED] bg-[#2F80ED] text-white hover:brightness-110"
                    : active
                      ? isUnknown
                        ? "border-[#B71C1C] bg-[#FFEBEE]"
                        : isService
                          ? "border-[#2E7D32] bg-[#E8F5E9]"
                          : "border-[#2F80ED] bg-[#EDF3FB]"
                      : isUnknown
                        ? "border-[#B71C1C] bg-[#FFEBEE] hover:brightness-95"
                        : isService
                          ? "border-[#2E7D32] bg-[#E8F5E9] hover:brightness-95"
                          : zoneBroadcast
                            ? "border-[#E0992A]/50 bg-[#FBEFD8]/60 hover:border-[#E0992A]"
                            : "border-[#C2D2E6] bg-[#F7FAFE] hover:border-[#A8BDD8]"
                }`}
              >
                {showHeader ? (
                <div
                  className={`flex w-full items-center justify-between gap-3 ${
                    isMine ? "flex-row-reverse" : "flex-row"
                  }`}
                >
                  <div
                    className={`flex min-w-0 items-center gap-2 ${
                      isMine ? "flex-row-reverse" : "flex-row"
                    }`}
                  >
                    <span
                      className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#C8DFFF] text-[11px] font-extrabold text-[#1B5BB5]"
                      aria-hidden
                    >
                      {initialsFromName(senderName)}
                    </span>
                    <div className="min-w-0">
                      <p
                        className={`text-sm font-extrabold ${
                          isMine ? "text-right" : "text-left"
                        } ${
                          useAccentBubble
                            ? "text-white"
                            : isUnknown
                              ? "text-[#B71C1C]"
                              : isService
                                ? "text-[#1B5E20]"
                                : "text-[#0F2C5C]"
                        }`}
                      >
                        {senderName}
                      </p>
                      <p
                        className={`mt-0.5 text-[11px] ${
                          isMine ? "text-right" : "text-left"
                        } ${useAccentBubble ? "text-white/70" : "text-[#8694AC]"}`}
                      >
                        {messageZoneLabel(message, { viewerOwnerId, zoneNames })}
                      </p>
                    </div>
                  </div>
                  <p
                    className={`shrink-0 text-[10px] font-semibold ${
                      useAccentBubble ? "text-white/70" : "text-[#8694AC]"
                    }`}
                  >
                    {new Date(message.created_at).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                ) : null}
                {message.subject ? (
                  <p
                    className={`mt-2 w-fit font-bold ${
                      useAccentBubble
                        ? "text-white"
                        : isUnknown
                          ? "text-lg text-[#B71C1C]"
                          : isService
                            ? "text-lg text-[#1B5E20]"
                            : "text-base text-[#0F2C5C]"
                    }`}
                  >
                    {message.subject}
                  </p>
                ) : null}
                {message.message && message.message !== message.subject ? (
                  <p
                    className={`mt-1 w-fit ${
                      useAccentBubble
                        ? "text-sm text-white"
                        : isUnknown
                          ? "text-base font-semibold text-[#7A1622]"
                          : isService
                            ? "text-base font-semibold text-[#33691E]"
                            : "text-sm text-[#566784]"
                    }`}
                  >
                    {message.message}
                  </p>
                ) : !message.subject ? (
                  <p
                    className={`mt-1 w-fit ${
                      useAccentBubble ? "text-sm text-white" : "text-sm text-[#566784]"
                    }`}
                  >
                    {message.message || "—"}
                  </p>
                ) : null}
                {showBadges ? (
                <div className="mt-2 w-0 min-w-full">
                  <div className="flex w-max flex-nowrap items-center gap-1.5 text-[10px]">
                    <span
                      className={`rounded-full px-2 py-0.5 font-semibold ${
                        isUnknown
                          ? "bg-[#C62828] text-white"
                          : isService
                            ? "bg-[#2E7D32] text-white"
                            : toneForCategory(message.category)
                      }`}
                    >
                      {toMessageTypeLabel(message.type)}
                    </span>
                    {message.type !== "PA" && message.topic_label ? (
                      <span className="rounded-full bg-[#FBEFD8] px-2 py-0.5 font-semibold text-[#E0992A]">
                        {message.topic_label}
                      </span>
                    ) : null}
                    {zoneBroadcast ? (
                      <span
                        className="rounded-full bg-[#FBEFD8] px-2 py-0.5 font-medium text-[#E0992A]"
                        title="Unscheduled guest waiting for approval"
                      >
                        Zone alert
                      </span>
                    ) : null}
                    {privateAudit ? (
                      <span
                        className="inline-flex items-center gap-0.5 rounded-full bg-[#EDF3FB] px-2 py-0.5 text-[#566784]"
                        title="Private staff audit between sender and receiver; other zone members may not see this row."
                      >
                        <Lock className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
                        Private
                      </span>
                    ) : null}
                    <span
                      className={`rounded-full px-2 py-0.5 ${
                        useAccentBubble ? "bg-white/15 text-white" : "bg-[#EDF3FB] text-[#566784]"
                      }`}
                    >
                      {message.category}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 font-mono ${
                        useAccentBubble ? "bg-white/15 text-white" : "bg-[#EDF3FB] text-[#566784]"
                      }`}
                      title="Sender coordinates"
                    >
                      {formatMessageCoordinatesLabel(message)}
                    </span>
                    {message.guest_id ? (
                      <span
                        className={`rounded-full px-2 py-0.5 font-mono ${
                          useAccentBubble ? "bg-white/15 text-white" : "bg-[#EDF3FB] text-[#566784]"
                        }`}
                      >
                        guest {String(message.guest_id).slice(0, 8)}
                      </span>
                    ) : null}
                    {message.receiver_id != null && (
                      <span
                        className={`rounded-full px-2 py-0.5 ${
                          useAccentBubble ? "bg-white/15 text-white" : "bg-[#EDF3FB] text-[#566784]"
                        }`}
                      >
                        to {message.receiver_id}
                      </span>
                    )}
                  </div>
                </div>
                ) : null}
              </button>
        );
                })}
              </div>
            </div>
              );
            })()}
          </li>
        );
      })}
    </ul>
  );
}
