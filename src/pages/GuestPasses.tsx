import { useState } from "react";
import { Ticket } from "lucide-react";
import { useGuestNetworkId } from "../hooks/useGuestNetworkId";
import { GuestPassRequestForm } from "../components/dashboard/GuestPassRequestForm";
import { GuestPassListSection } from "../components/dashboard/GuestPassListSection";

type Tab = "request" | "list";

export default function GuestPasses() {
  const { zoneId, options, isAdmin, setPickedZoneId } = useGuestNetworkId();
  const [activeTab, setActiveTab] = useState<Tab>("request");

  if (!zoneId) {
    return (
      <section className="space-y-6">
        <h1 className="text-2xl font-semibold text-[#0F2C5C] sm:text-3xl">
          Guest Passes
        </h1>
        <p className="text-sm text-[#566784]">
          No network ID found on your account. You need to be assigned to a zone to
          use guest passes.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-0">
      <div className="rounded-lg border border-[#DCE6F2] bg-white overflow-hidden shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DCE6F2] px-4 py-3 sm:px-6">
          <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#0F2C5C]">
            <Ticket className="h-4 w-4 text-[#2F80ED]" />
            Guest Passes
          </span>
          {options.length > 1 ? (
            <select
              value={zoneId}
              onChange={(e) => setPickedZoneId(e.target.value)}
              className="rounded-full border border-[#DCE6F2] bg-[#EDF3FB] px-3 py-1.5 font-mono text-xs text-[#2F80ED] outline-none"
            >
              {options.map((zid) => (
                <option key={zid} value={zid}>
                  {zid}
                </option>
              ))}
            </select>
          ) : (
            <span className="rounded-full border border-[#DCE6F2] bg-[#EDF3FB] px-3 py-1.5 font-mono text-xs text-[#2F80ED]">
              {zoneId}
            </span>
          )}
        </header>

        <div className="flex gap-4 border-b border-[#DCE6F2] px-4 sm:px-6">
          {(
            [
              { key: "request" as const, label: "Create Guest Pass" },
              { key: "list" as const, label: "Guest Passes" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`py-3 text-xs font-bold uppercase tracking-[0.15em] transition ${
                activeTab === tab.key
                  ? "border-b-2 border-[#2F80ED] text-[#2F80ED]"
                  : "text-[#8694AC] hover:text-[#566784]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="px-4 py-5 sm:px-6">
          {activeTab === "request" && (
            <GuestPassRequestForm zoneId={zoneId} />
          )}
          {activeTab === "list" && (
            <GuestPassListSection zoneId={zoneId} isAdmin={isAdmin} />
          )}
        </div>
      </div>
    </section>
  );
}
