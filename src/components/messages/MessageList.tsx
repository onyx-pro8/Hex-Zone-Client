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
}: {
  messages: Message[];
  activeId: string | null;
  onSelect: (id: string) => void;
  /** Shown when the (possibly filtered) section has no rows. */
  emptyLabel?: string;
}) {
  if (messages.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-800/80 bg-slate-950/80 p-8 text-center text-slate-400">
        {emptyLabel}
      </div>
    );
  }

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
                  ? "border-[#00E5D1]/60 bg-[#00E5D1]/10"
                  : zoneBroadcast
                    ? "border-amber-500/50 bg-amber-950/30 hover:border-amber-500/70"
                    : "border-slate-800/80 bg-slate-950/80 hover:border-slate-700"
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 rounded-lg bg-[#00E5D1]/10 p-2">
                  <MessageCircle className="h-4 w-4 text-[#00E5D1]" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-slate-900 px-2 py-0.5 text-slate-300">
                      {message.zone_id}
                    </span>
                    <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[#00E5D1]">
                      {toMessageTypeLabel(message.type)}
                    </span>
                    {zoneBroadcast ? (
                      <span
                        className="rounded-full bg-amber-500/20 px-2 py-0.5 font-medium text-amber-200"
                        title="Unscheduled guest waiting for approval"
                      >
                        Zone alert
                      </span>
                    ) : null}
                    {privateAudit ? (
                      <span
                        className="inline-flex items-center gap-0.5 rounded-full bg-slate-800/90 px-2 py-0.5 text-slate-300"
                        title="Private staff audit between sender and receiver; other zone members may not see this row."
                      >
                        <Lock className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
                        Private
                      </span>
                    ) : null}
                    <span className="rounded-full bg-slate-900 px-2 py-0.5 text-amber-300">
                      {message.category}
                    </span>
                    <span className="rounded-full bg-slate-900 px-2 py-0.5 text-slate-300 capitalize">
                      {message.scope}
                    </span>
                    <span className="rounded-full bg-slate-900 px-2 py-0.5 text-slate-400">
                      from {formatMessageSenderLabel(message)}
                    </span>
                    {message.receiver_id != null && (
                      <span className="rounded-full bg-slate-900 px-2 py-0.5 text-slate-400">
                        to {message.receiver_id}
                      </span>
                    )}
                    <span className="text-slate-500">
                      {new Date(message.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-slate-200">
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
