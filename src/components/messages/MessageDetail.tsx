import { Lock } from "lucide-react";
import { formatMessageSenderLabel, type Message } from "../../services/api/messages";
import { toMessageTypeLabel } from "../../lib/messageTypes";
import { readMessageBroadcastName } from "../../lib/messageBroadcast";
import {
  isPermissionDirectVisibility,
  isPermissionZonePendingBroadcastVisibility,
} from "../../lib/permissionVisibility";

export function MessageDetail({ message }: { message: Message | null }) {
  return (
    <section className="rounded-2xl border border-[#DCE6F2] bg-white p-5 shadow-sm">
      {!message ? (
        <p className="text-sm text-[#566784]">
          Select a message to view full details.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-[#EDF3FB] px-2 py-1 text-[#566784]">
              Zone {message.zone_id}
            </span>
            <span className="rounded-full bg-[#EDF3FB] px-2 py-1 font-semibold text-[#2F80ED]">
              {toMessageTypeLabel(message.type)}
            </span>
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
          </div>
          <div>
            <p className="text-base font-extrabold text-[#0F2C5C]">
              {readMessageBroadcastName(message) ??
                `Member ${formatMessageSenderLabel(message)}`}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-[#566784]">
              {message.message}
            </p>
          </div>
          {message.raw_payload && (
            <pre className="overflow-auto rounded-md border border-[#DCE6F2] bg-[#F7FAFE] p-3 text-xs text-[#566784]">
              {JSON.stringify(message.raw_payload, null, 2)}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}
