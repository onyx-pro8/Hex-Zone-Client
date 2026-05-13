import { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { GuestPassRequestForm } from "../components/dashboard/GuestPassRequestForm";
import { GuestPassListSection } from "../components/dashboard/GuestPassListSection";
import { Ticket } from "lucide-react";

type Tab = "request" | "list";

export default function GuestPasses() {
  const { user } = useAuth();
  const zoneId = String(user?.zone_id ?? user?.zoneId ?? "").trim();
  const isAdmin = String(user?.role ?? "").toLowerCase() === "administrator";
  const [activeTab, setActiveTab] = useState<Tab>("request");

  if (!zoneId) {
    return (
      <section className="space-y-6 p-8">
        <h1 className="text-2xl font-semibold text-white sm:text-3xl">
          Guest Passes
        </h1>
        <p className="text-sm text-slate-400">
          No zone ID found on your account. You need to be assigned to a zone to
          use guest passes.
        </p>
      </section>
    );
  }

  const tabs: { key: Tab; label: string; adminOnly: boolean }[] = [
    { key: "request", label: "Request Guest Pass", adminOnly: false },
    { key: "list", label: "Guest Pass Requests", adminOnly: true },
  ];

  const visibleTabs = tabs;
  const showTabs = visibleTabs.length > 1;

  return (
    <section className="space-y-0">
      <div className="rounded-lg border border-slate-800/60 bg-[#0B0E11] overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 px-4 py-3 sm:px-6">
          <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-white">
            <Ticket className="h-4 w-4 text-[#00E5D1]" />
            Guest Passes
          </span>
          <span className="rounded-full border border-slate-700/80 bg-[#151a20] px-3 py-1.5 font-mono text-xs text-[#00E5D1]">
            {zoneId}
          </span>
        </header>

        {showTabs && (
          <div className="flex gap-4 border-b border-slate-800/60 px-4 sm:px-6">
            {visibleTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`py-3 text-xs font-bold uppercase tracking-[0.15em] transition ${
                  activeTab === tab.key
                    ? "border-b-2 border-[#00E5D1] text-[#00E5D1]"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        <div className="px-4 py-5 sm:px-6">
          {activeTab === "request" && <GuestPassRequestForm zoneId={zoneId} />}
          {activeTab === "list" && (
            <GuestPassListSection zoneId={zoneId} isAdmin={isAdmin} />
          )}
        </div>
      </div>
    </section>
  );
}
