import { CalendarRange, Search, X } from "lucide-react";
import type { MessageType } from "../../lib/messageTypes";
import type { ZoneNameLookup } from "../../lib/messageZoneLabel";

export type MessageInboxFilterBarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  zoneFilter: string;
  onZoneFilterChange: (value: string) => void;
  zoneIds: string[];
  zoneNames?: ZoneNameLookup;
  typeFilter: "all" | MessageType;
  onTypeFilterChange: (value: "all" | MessageType) => void;
  typeOptions: Array<{ type: MessageType; label: string; category?: string }>;
  typeGroups?: Array<{
    category: string;
    options: Array<{ type: MessageType; label: string }>;
  }>;
  typeAllLabel?: string;
  dateFrom: string;
  onDateFromChange: (value: string) => void;
  dateTo: string;
  onDateToChange: (value: string) => void;
  searchPlaceholder?: string;
};

const fieldClass =
  "h-10 w-full rounded-lg border border-[#DCE6F2] bg-white px-3 text-sm text-[#0F2C5C] outline-none transition focus:border-[#2F80ED] focus:ring-2 focus:ring-[#2F80ED]/15";

const labelClass =
  "mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8694AC]";

export function MessageInboxFilterBar({
  search,
  onSearchChange,
  zoneFilter,
  onZoneFilterChange,
  zoneIds,
  zoneNames,
  typeFilter,
  onTypeFilterChange,
  typeOptions,
  typeGroups,
  typeAllLabel = "All types",
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
  searchPlaceholder = "Search keyword…",
}: MessageInboxFilterBarProps) {
  const hasActiveFilters =
    search.trim().length > 0 ||
    zoneFilter !== "all" ||
    typeFilter !== "all" ||
    Boolean(dateFrom) ||
    Boolean(dateTo);

  const clearFilters = () => {
    onSearchChange("");
    onZoneFilterChange("all");
    onTypeFilterChange("all");
    onDateFromChange("");
    onDateToChange("");
  };

  return (
    <div className="rounded-2xl border border-[#DCE6F2] bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8694AC]"
            aria-hidden
          />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label="Search"
            className={`${fieldClass} pl-9 pr-3`}
          />
        </div>
        {hasActiveFilters ? (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 text-sm font-medium text-[#566784] transition hover:border-[#B8C9DE] hover:text-[#0F2C5C]"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            Clear
          </button>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_minmax(260px,1.2fr)]">
        <label className="min-w-0">
          <span className={labelClass}>Zone</span>
          <select
            value={zoneFilter}
            onChange={(e) => onZoneFilterChange(e.target.value)}
            aria-label="Filter by zone"
            className={fieldClass}
          >
            <option value="all">All zones</option>
            {zoneIds.map((zone) => (
              <option key={zone} value={zone}>
                {zoneNames?.get(zone)
                  ? `${zoneNames.get(zone)} (${zone})`
                  : zone}
              </option>
            ))}
          </select>
        </label>

        <label className="min-w-0">
          <span className={labelClass}>Type</span>
          <select
            value={typeFilter}
            onChange={(e) =>
              onTypeFilterChange(e.target.value as "all" | MessageType)
            }
            aria-label="Filter by message type"
            className={fieldClass}
          >
            <option value="all">{typeAllLabel}</option>
            {typeGroups
              ? typeGroups.map((group) => (
                  <optgroup key={group.category} label={group.category}>
                    {group.options.map((option) => (
                      <option key={option.type} value={option.type}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                ))
              : typeOptions.map((option) => (
                  <option key={option.type} value={option.type}>
                    {option.label}
                  </option>
                ))}
          </select>
        </label>

        <div className="min-w-0 sm:col-span-2 xl:col-span-1">
          <span className={labelClass}>
            <span className="inline-flex items-center gap-1.5">
              <CalendarRange className="h-3 w-3" aria-hidden />
              Date range
            </span>
          </span>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => onDateFromChange(e.target.value)}
              aria-label="From date"
              className={`${fieldClass} min-w-0 flex-1`}
            />
            <span className="shrink-0 text-xs font-medium text-[#8694AC]">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => onDateToChange(e.target.value)}
              aria-label="To date"
              className={`${fieldClass} min-w-0 flex-1`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
