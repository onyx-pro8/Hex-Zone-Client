import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { MessageDetail } from "../components/messages/MessageDetail";
import { MessageList } from "../components/messages/MessageList";
import { useAuth } from "../hooks/useAuth";
import { useAlarmInbox } from "../state/alarm/AlarmInboxContext";
import { messageBroadcastLabel } from "../lib/messageBroadcast";
import { resolveBroadcastName } from "../lib/appSettings";
import { getMembers, type Member } from "../services/api/members";

export default function Alerts() {
  const { user } = useAuth();
  const selfBroadcastName = resolveBroadcastName(user?.name);
  const ownerId = Number(user?.id);
  const { alarmMessages, loading, error, markAlarmsSeen } = useAlarmInbox();
  const [members, setMembers] = useState<Member[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getMembers().then((res) => {
      if (active) setMembers(res.data ?? []);
    });
    return () => {
      active = false;
    };
  }, []);

  const ownerNameById = useMemo(() => {
    const map = new Map<number, string>();
    members.forEach((row) => {
      const id = Number(row.id);
      if (!Number.isFinite(id) || id <= 0) return;
      const name =
        row.name ||
        `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() ||
        row.email ||
        "";
      if (name) map.set(id, name);
    });
    return map;
  }, [members]);

  const sortedAlarms = useMemo(
    () =>
      [...alarmMessages].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [alarmMessages],
  );

  const activeMessage = useMemo(
    () => sortedAlarms.find((message) => message.id === activeId) ?? null,
    [sortedAlarms, activeId],
  );

  const getBroadcastName = useCallback(
    (message: Parameters<typeof messageBroadcastLabel>[0]) =>
      messageBroadcastLabel(message, {
        selfOwnerId: Number.isFinite(ownerId) ? ownerId : null,
        selfBroadcastName,
        resolveOwnerName: (id) => ownerNameById.get(id) ?? null,
      }),
    [ownerId, selfBroadcastName, ownerNameById],
  );

  const handleSelect = (messageId: string) => {
    setActiveId(messageId);
    void markAlarmsSeen([messageId]);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-2xl border border-[#F3C2CA] bg-[#FCE7EA] px-4 py-3 text-sm text-[#7A1622]">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#E23B4E]" />
        <div>
          <p className="font-semibold">Incoming alarms</p>
          <p className="text-[#7A1622]/90">
            PANIC, SENSOR, NS-PANIC, WELLNESS CHECK and other alarm-category
            messages appear here so they stay separate from general Messages.
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-3">
          {error ? (
            <p className="text-sm text-[#E23B4E]">{error}</p>
          ) : null}
          {loading && sortedAlarms.length === 0 ? (
            <p className="text-sm text-[#566784]">Loading alarms…</p>
          ) : (
            <MessageList
              messages={sortedAlarms}
              activeId={activeId}
              onSelect={handleSelect}
              emptyLabel="No incoming alarms."
              getBroadcastName={getBroadcastName}
            />
          )}
        </div>
        <MessageDetail
          message={activeMessage}
          currentOwnerId={Number.isFinite(ownerId) ? ownerId : null}
          ownerNameById={ownerNameById}
        />
      </div>
    </div>
  );
}
