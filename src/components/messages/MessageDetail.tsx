import { useState } from "react";
import { Lock, MessagesSquare } from "lucide-react";
import { formatMessageSenderLabel, type Message } from "../../services/api/messages";
import { toMessageTypeLabel } from "../../lib/messageTypes";
import { readMessageBroadcastName } from "../../lib/messageBroadcast";
import {
  isPermissionDirectVisibility,
  isPermissionZonePendingBroadcastVisibility,
} from "../../lib/permissionVisibility";
import { getMessageWorkflow, isUnknownMessageType, priorityBadgeClass } from "../../lib/messageWorkflow";
import { WellnessAckPanel } from "./WellnessAckPanel";
import { PrivateThreadModal } from "./PrivateThreadModal";

function resolvePrivateCounterpart(
  message: Message,
  currentOwnerId: number,
): number | null {
  const sender = message.sender_id ?? null;
  const receiver = message.receiver_id ?? null;
  if (sender != null && sender !== currentOwnerId) return sender;
  if (receiver != null && receiver !== currentOwnerId) return receiver;
  return null;
}

export function MessageDetail({
  message,
  currentOwnerId,
  ownerNameById,
}: {
  message: Message | null;
  currentOwnerId?: number | null;
  ownerNameById?: Map<number, string>;
}) {
  const [threadOtherId, setThreadOtherId] = useState<number | null>(null);
  return (
    <section className="rounded-2xl border border-[#DCE6F2] bg-white p-5 shadow-sm">
      {!message ? (
        <p className="text-sm text-[#566784]">
          Select a message to view full details.
        </p>
      ) : (
        <div className="space-y-4">
          {(() => {
            const workflow = getMessageWorkflow(message.type);
            if (!workflow) return null;
            return (
              <span
                className={`inline-flex rounded-full px-2 py-1 font-bold uppercase tracking-wide ${priorityBadgeClass(workflow.priority)}`}
              >
                Priority {workflow.priority}
              </span>
            );
          })()}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-[#EDF3FB] px-2 py-1 text-[#566784]">
              Zone {message.zone_id}
            </span>
            <span
              className={`rounded-full px-2 py-1 font-semibold ${
                isUnknownMessageType(message.type)
                  ? "bg-[#C62828] text-sm font-extrabold text-white"
                  : "bg-[#EDF3FB] text-[#2F80ED]"
              }`}
            >
              {toMessageTypeLabel(message.type)}
            </span>
            {message.topic_label ? (
              <span className="rounded-full bg-[#FBEFD8] px-2 py-1 font-semibold text-[#E0992A]">
                {message.topic_label}
              </span>
            ) : null}
            {message.type === "PERMISSION" &&
            isPermissionZonePendingBroadcastVisibility(message.permission_visibility) ? (
              <span
                className="rounded-full bg-[#FBEFD8] px-2 py-1 font-medium text-[#E0992A]"
                title="Unscheduled guest waiting for approval"
              >
                Zone alert
              </span>
            ) : null}
            {message.type === "PERMISSION" && isPermissionDirectVisibility(message.permission_visibility) ? (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-[#EDF3FB] px-2 py-1 text-[#566784]">
                <Lock className="h-3 w-3" aria-hidden />
                Private
              </span>
            ) : null}
            <span className="rounded-full bg-[#EDF3FB] px-2 py-1 text-[#566784]">
              Category {message.category}
            </span>
            <span className="rounded-full bg-[#EDF3FB] px-2 py-1 capitalize text-[#566784]">
              Scope {message.scope}
            </span>
            {message.receiver_id != null && (
              <span className="rounded-full bg-[#EDF3FB] px-2 py-1 text-[#566784]">
                receiver {message.receiver_id}
              </span>
            )}
            <span className="text-[#8694AC]">
              {new Date(message.created_at).toLocaleString()}
            </span>
            {message.latitude != null && message.longitude != null ? (
              <a
                className="rounded-full bg-[#EDF3FB] px-2 py-1 text-[#2F80ED] hover:underline"
                href={`https://www.google.com/maps?q=${message.latitude},${message.longitude}`}
                target="_blank"
                rel="noreferrer"
              >
                {message.latitude.toFixed(4)}, {message.longitude.toFixed(4)}
              </a>
            ) : null}
          </div>
          <div>
            <p
              className={`font-extrabold ${
                isUnknownMessageType(message.type)
                  ? "text-xl text-[#B71C1C]"
                  : message.subject
                    ? "text-lg text-[#0F2C5C]"
                    : "text-base text-[#0F2C5C]"
              }`}
            >
              {message.subject ||
                readMessageBroadcastName(message) ||
                `Member ${formatMessageSenderLabel(message)}`}
            </p>
            {message.subject ? (
              <p className="mt-1 text-sm font-semibold text-[#566784]">
                {readMessageBroadcastName(message) ??
                  `Member ${formatMessageSenderLabel(message)}`}
              </p>
            ) : null}
            {message.message && message.message !== message.subject ? (
              <p
                className={`mt-1 leading-relaxed ${
                  isUnknownMessageType(message.type)
                    ? "text-base font-semibold text-[#7A1622]"
                    : "text-sm text-[#566784]"
                }`}
              >
                {message.message}
              </p>
            ) : null}
          </div>
          {message.delivered_owner_ids && message.delivered_owner_ids.length > 0 ? (
            <div className="rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#8694AC]">
                Delivered to
              </p>
              <ul className="mt-1 space-y-1 text-sm text-[#566784]">
                {message.delivered_owner_ids.map((oid) => (
                  <li key={`delivered-${oid}`}>
                    {ownerNameById?.get(oid) ?? `Member ${oid}`}
                    <span className="ml-1 font-mono text-xs text-[#8694AC]">({oid})</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {message.type === "WELLNESS_CHECK" && currentOwnerId ? (
            <WellnessAckPanel
              messageEventId={message.id}
              currentOwnerId={currentOwnerId}
              senderId={message.sender_id}
            />
          ) : null}
          {message.type === "PRIVATE" && currentOwnerId
            ? (() => {
                const otherId = resolvePrivateCounterpart(message, currentOwnerId);
                if (otherId == null) return null;
                return (
                  <button
                    type="button"
                    onClick={() => setThreadOtherId(otherId)}
                    className="inline-flex items-center gap-2 rounded-lg border border-[#DCE6F2] bg-white px-3 py-2 text-sm font-semibold text-[#2F80ED] transition hover:bg-[#EDF3FB]"
                  >
                    <MessagesSquare className="h-4 w-4" aria-hidden />
                    View private thread
                  </button>
                );
              })()
            : null}
          {message.raw_payload && (
            <pre className="overflow-auto rounded-md border border-[#DCE6F2] bg-[#F7FAFE] p-3 text-xs text-[#566784]">
              {JSON.stringify(message.raw_payload, null, 2)}
            </pre>
          )}
        </div>
      )}
      {threadOtherId != null && currentOwnerId ? (
        <PrivateThreadModal
          otherOwnerId={threadOtherId}
          currentOwnerId={currentOwnerId}
          onClose={() => setThreadOtherId(null)}
        />
      ) : null}
    </section>
  );
}
