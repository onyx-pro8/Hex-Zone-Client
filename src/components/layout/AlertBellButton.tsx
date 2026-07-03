import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { useAlarmNotifications } from "../../hooks/useAlarmNotifications";
import { useAuth } from "../../hooks/useAuth";
import { useAlarmInbox } from "../../state/alarm/AlarmInboxContext";
import { countUniqueUnreadAlarmBadge } from "../../lib/alarmRead";

export function AlertBellButton() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const ownerId = user?.id;
  const { alarmMessages, markAlarmsSeen } = useAlarmInbox();
  const { activeAlarms, dismissAllAlarms } = useAlarmNotifications();

  const badgeCount = countUniqueUnreadAlarmBadge(
    alarmMessages,
    activeAlarms,
    ownerId,
  );

  const handleOpen = useCallback(() => {
    void (async () => {
      await markAlarmsSeen(activeAlarms.map((alarm) => alarm.id));
      dismissAllAlarms();
      navigate("/alerts");
    })();
  }, [activeAlarms, dismissAllAlarms, markAlarmsSeen, navigate]);

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
