import { Lock, MessageCircle } from "lucide-react";
import { formatMessageSenderLabel, type Message } from "../../services/api/messages";
import { toMessageTypeLabel } from "../../lib/messageTypes";
import {
  isPermissionDirectVisibility,
  isPermissionZonePendingBroadcastVisibility,
} from "../../lib/permissionVisibility";

export function MessageList({
  messages,
  activeId,
  onSelect,
  emptyLabel = "No messages found for current filters.",
  getBroadcastName,
}: {
  messages: Message[];
  activeId: string | null;
  onSelect: (id: string) => void;
  /** Shown when the (possibly filtered) section has no rows. */
  emptyLabel?: string;
  /** Resolve a sender's broadcast name for prominent display. */
  getBroadcastName?: (message: Message) => string;
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
                  ? "border-[#2F80ED] bg-[#EDF3FB]"
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
                      Zone {message.zone_id}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 font-semibold ${toneForCategory(message.category)}`}
                    >
                      {toMessageTypeLabel(message.type)}
                    </span>
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
                    <span className="rounded-full bg-[#EDF3FB] px-2 py-0.5 capitalize text-[#566784]">
                      {message.scope}
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
                  <p className="mt-2 text-sm font-bold text-[#0F2C5C]">
                    {getBroadcastName
                      ? getBroadcastName(message)
                      : `from ${formatMessageSenderLabel(message)}`}
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm text-[#566784]">
                    {message.message}
                  </p>
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
