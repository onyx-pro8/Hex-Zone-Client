import { Lock, MessageCircle } from "lucide-react";
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

  return (
    <ul className="space-y-3">
      {messages.map((message) => {
        const active = activeId === message.id;
        const isUnknown = isUnknownMessageType(message.type);
        const isService = isServiceMessageType(message.type);
        const zoneBroadcast =
          message.type === "PERMISSION" &&
          isPermissionZonePendingBroadcastVisibility(message.permission_visibility);
        const privateAudit =
          message.type === "PERMISSION" && isPermissionDirectVisibility(message.permission_visibility);
        return (
          <li key={message.id}>
            <button
              type="button"
              onClick={() => onSelect(message.id)}
              className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                active
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
                        : "border-[#DCE6F2] bg-white hover:border-[#C2D2E6]"
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 rounded-lg bg-[#EDF3FB] p-2">
                  <MessageCircle className="h-4 w-4 text-[#2F80ED]" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-[#EDF3FB] px-2 py-0.5 text-[#566784]">
                      {messageZoneLabel(message, { viewerOwnerId, zoneNames })}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 font-semibold ${
                        isUnknown
                          ? "bg-[#C62828] text-sm font-extrabold text-white"
                          : isService
                            ? "bg-[#2E7D32] text-sm font-extrabold text-white"
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
                    <span className="rounded-full bg-[#EDF3FB] px-2 py-0.5 text-[#566784]">
                      {message.category}
                    </span>
                    <span
                      className="rounded-full bg-[#EDF3FB] px-2 py-0.5 font-mono text-[#566784]"
                      title="Sender coordinates"
                    >
                      {formatMessageCoordinatesLabel(message)}
                    </span>
                    {message.receiver_id != null && (
                      <span className="rounded-full bg-[#EDF3FB] px-2 py-0.5 text-[#566784]">
                        to {message.receiver_id}
                      </span>
                    )}
                    <span className="text-[#8694AC]">
                      {new Date(message.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p
                    className={`mt-2 font-bold ${
                      isUnknown
                        ? "text-lg text-[#B71C1C]"
                        : isService
                          ? "text-lg text-[#1B5E20]"
                          : message.subject
                            ? "text-base text-[#0F2C5C]"
                            : "text-sm text-[#0F2C5C]"
                    }`}
                  >
                    {message.subject ||
                      (getBroadcastName
                        ? getBroadcastName(message)
                        : `from ${formatMessageSenderLabel(message)}`)}
                  </p>
                  {message.subject ? (
                    <p className="mt-1 text-xs font-semibold text-[#566784]">
                      {getBroadcastName
                        ? getBroadcastName(message)
                        : `from ${formatMessageSenderLabel(message)}`}
                    </p>
                  ) : null}
                  {message.message && message.message !== message.subject ? (
                    <p
                      className={`mt-1 line-clamp-3 ${
                        isUnknown
                          ? "text-base font-semibold text-[#7A1622]"
                          : isService
                            ? "text-base font-semibold text-[#33691E]"
                            : "text-sm text-[#566784]"
                      }`}
                    >
                      {message.message}
                    </p>
                  ) : null}
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
