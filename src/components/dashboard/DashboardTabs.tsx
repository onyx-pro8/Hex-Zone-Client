type DashboardTab = "zones" | "messages" | "members" | "alerts";

const tabs: { id: DashboardTab; label: string }[] = [
  { id: "zones", label: "Zones" },
  { id: "messages", label: "Messages" },
  { id: "members", label: "Members" },
  { id: "alerts", label: "Alerts" },
];

export function DashboardTabs({
  activeTab,
  onChange,
}: {
  activeTab: DashboardTab;
  onChange: (tab: DashboardTab) => void;
}) {
  return (
    <div className="mb-3 grid grid-cols-4 gap-2">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`rounded-md border px-2 py-2 text-xs transition ${
            activeTab === tab.id
              ? "border-[#2F80ED] bg-[#EDF3FB] text-[#2F80ED]"
              : "border-[#DCE6F2] bg-white text-[#8694AC] hover:bg-[#EDF3FB]"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export type { DashboardTab };
