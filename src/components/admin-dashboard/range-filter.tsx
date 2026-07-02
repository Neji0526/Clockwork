// Date-range selector for the admin dashboard. Drives only the ranged widgets;
// the "live" widgets ignore it. All resolution flows through @/lib/dashboard-range
// which delegates to the ET-aware helpers in @/lib/reporting.
import { useMemo, useState } from "react";
import { Calendar as CalendarIcon, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import {
  PRESET_LABEL,
  resolveRange,
  type RangePreset,
  type ResolvedRange,
} from "@/lib/dashboard-range";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { REPORT_TZ, todayLocal } from "@/lib/reporting";

const PRESETS: RangePreset[] = [
  "today",
  "yesterday",
  "this-week",
  "last-week",
  "this-month",
  "last-month",
  "custom",
];

function fmtETLabel(day: string): string {
  // Render "Jun 18" from a "YYYY-MM-DD" ET local-day string.
  const anchor = fromZonedTime(`${day}T12:00:00`, REPORT_TZ);
  return formatInTimeZone(anchor, REPORT_TZ, "MMM d");
}

function dayToDate(day: string): Date {
  return fromZonedTime(`${day}T12:00:00`, REPORT_TZ);
}
function dateToDay(d: Date): string {
  return formatInTimeZone(d, REPORT_TZ, "yyyy-MM-dd");
}

export function RangeFilter({
  preset,
  custom,
  onChange,
}: {
  preset: RangePreset;
  custom: ResolvedRange;
  onChange: (next: { preset: RangePreset; custom: ResolvedRange }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const today = todayLocal();
  const resolved = useMemo(
    () => resolveRange(preset, custom, today),
    [preset, custom, today],
  );

  const rangeLabel =
    resolved.from === resolved.to
      ? `${fmtETLabel(resolved.from)} (ET)`
      : `${fmtETLabel(resolved.from)} – ${fmtETLabel(resolved.to)} (ET)`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <CalendarIcon className="size-3.5" />
            <span>{PRESET_LABEL[preset]}</span>
            <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-44 p-1">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                if (p === "custom") {
                  onChange({ preset: "custom", custom });
                  setOpen(false);
                  setCustomOpen(true);
                } else {
                  onChange({ preset: p, custom });
                  setOpen(false);
                }
              }}
              className={cn(
                "w-full text-left px-2 py-1.5 rounded-md text-sm hover:bg-accent",
                preset === p && "bg-accent",
              )}
            >
              {PRESET_LABEL[p]}
            </button>
          ))}
        </PopoverContent>
      </Popover>

      {preset === "custom" && (
        <Popover open={customOpen} onOpenChange={setCustomOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              Pick dates
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <Calendar
              mode="range"
              selected={{ from: dayToDate(custom.from), to: dayToDate(custom.to) }}
              onSelect={(r) => {
                if (!r?.from) return;
                const from = dateToDay(r.from);
                const to = dateToDay(r.to ?? r.from);
                onChange({ preset: "custom", custom: { from, to } });
              }}
              numberOfMonths={2}
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>
      )}

      <span className="text-xs text-muted-foreground tabular-nums">{rangeLabel}</span>
    </div>
  );
}

export function LiveBadge() {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.15em] text-success font-medium"
      title="Always current — not affected by the date filter"
    >
      <span aria-hidden className="relative inline-flex size-1.5">
        <span className="absolute inset-0 rounded-full bg-success animate-ping opacity-60" />
        <span className="relative inline-block size-1.5 rounded-full bg-success" />
      </span>
      Live · now
    </span>
  );
}
