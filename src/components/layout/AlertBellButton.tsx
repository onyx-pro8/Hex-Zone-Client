import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { useMessageFeed } from "../../hooks/useMessageFeed";
import { useAlarmNotifications } from "../../hooks/useAlarmNotifications";
import { useAuth } from "../../hooks/useAuth";
import {
  countUnreadAlarms,
  isAlarmUnread,
  unreadAlarmIds,
} from "../../lib/alarmRead";
import { markAlarmsRead } from "../../services/api/messageFeature";

export function AlertBellButton() {
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const ownerId = user?.id;
  const { messages, refreshInbox } = useMessageFeed([]);
  const { activeAlarms, dismissAllAlarms } = useAlarmNotifications(token);

  const inboxUnread =
    ownerId != null ? countUnreadAlarms(messages, ownerId) : 0;
  const liveUnread =
    ownerId != null
      ? activeAlarms.filter((alarm) => {
          const feedRow = messages.find((message) => message.id === alarm.id);
          if (feedRow) return isAlarmUnread(feedRow, ownerId);
          return true;
        }).length
      : activeAlarms.length;
  const badgeCount = inboxUnread + liveUnread;

  const handleOpen = useCallback(() => {
    void (async () => {
      if (ownerId != null) {
        const ids = new Set(unreadAlarmIds(messages, ownerId));
        activeAlarms.forEach((alarm) => ids.add(alarm.id));
        if (ids.size > 0) {
          await markAlarmsRead([...ids]);
          await refreshInbox();
        }
        dismissAllAlarms();
      }
      navigate("/alerts");
    })();
  }, [activeAlarms, dismissAllAlarms, messages, navigate, ownerId, refreshInbox]);

  return (
    <button
      type="button"
      aria-label="Open incoming alarms"
      className="relative grid h-9 w-9 place-items-center rounded-full border border-[#DCE6F2] bg-[#EDF3FB] transition hover:bg-[#DCE6F2]"
      onClick={handleOpen}
    >
      <Bell className="h-4 w-4 text-[#2F80ED]" />
      {badgeCount > 0 ? (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#E23B4E] px-1 text-[10px] font-bold text-white">
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      ) : null}
    </button>
  );
}
