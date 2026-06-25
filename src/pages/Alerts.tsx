import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { MessageList } from "../components/messages/MessageList";
import { useMessageFeed } from "../hooks/useMessageFeed";
import { useAuth } from "../hooks/useAuth";
import { unreadAlarmIds } from "../lib/alarmRead";
import { markAlarmRead, markAlarmsRead } from "../services/api/messageFeature";
import { messageBroadcastLabel } from "../lib/messageBroadcast";
import { resolveBroadcastName } from "../lib/appSettings";
import { getMembers, type Member } from "../services/api/members";

export default function Alerts() {
  const { user } = useAuth();
  const selfBroadcastName = resolveBroadcastName(user?.name);
  const ownerId = Number(user?.id);
  const { messages, loading, error, refreshInbox } = useMessageFeed([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(ownerId) || ownerId <= 0 || loading) return;
    const ids = unreadAlarmIds(
      messages.filter((message) => message.category === "Alarm"),
      ownerId,
    );
    if (ids.length === 0) return;
    void markAlarmsRead(ids).then(() => refreshInbox());
  }, [ownerId, loading, messages, refreshInbox]);

  useEffect(() => {
    let active = true;
    void getMembers().then((res) => {
      if (active) setMembers(res.data ?? []);
    });
    return () => {
      active = false;
    };
  }, []);

  const ownerNames = useMemo(() => {
    const map: Record<number, string> = {};
    members.forEach((row) => {
      const id = Number(row.id);
      if (!Number.isFinite(id) || id <= 0) return;
      const name =
        row.name ||
        `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() ||
        row.email ||
        "";
      if (name) map[id] = name;
    });
    return map;
  }, [members]);

  const alarmMessages = useMemo(
    () =>
      [...messages]
        .filter((m) => m.category === "Alarm")
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        ),
    [messages],
  );

  const handleSelect = (messageId: string) => {
    setActiveId(messageId);
    void markAlarmRead(messageId).then(() => refreshInbox());
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-2xl border border-[#F3C2CA] bg-[#FCE7EA] px-4 py-3 text-sm text-[#7A1622]">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#E23B4E]" />
        <div>
          <p className="font-semibold">Incoming alarms</p>
          <p className="text-[#7A1622]/90">
            PANIC, SENSOR, NS-PANIC and other alarm-category messages appear
            here so they stay separate from general Messages.
          </p>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-[#E23B4E]">{error}</p>
      ) : null}
      {loading && alarmMessages.length === 0 ? (
        <p className="text-sm text-[#566784]">Loading alarms…</p>
      ) : (
        <MessageList
          messages={alarmMessages}
          activeId={activeId}
          onSelect={handleSelect}
          emptyLabel="No incoming alarms."
          getBroadcastName={(message) =>
            messageBroadcastLabel(message, {
              selfOwnerId: ownerId,
              selfBroadcastName,
              resolveOwnerName: (id) => ownerNames[id] ?? null,
            })
          }
        />
      )}
    </div>
  );
}
