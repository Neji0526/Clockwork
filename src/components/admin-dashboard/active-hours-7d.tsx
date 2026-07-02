// Active-hours trend over the selected range — per-day series from
// report_segment_day_slices grouped by local_day (ET). For single-day ranges
// the tile shows just that day's value with no sparkline.
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchSlices, nextDay } from "@/lib/reporting";
import { MetricTile } from "@/components/ui/metric-tile";
import { fmtSecHuman } from "@/lib/format";
import { DeltaChip } from "./delta-chip";
import { previousRange, type RangePreset, type ResolvedRange } from "@/lib/dashboard-range";

// Enumerate the ET local-day strings between `from` and `to` inclusive.
// Uses the same noon-anchor pattern as nextDay (DST-safe) and steps by 24h,
// formatting each step in REPORT_TZ so we get correct ET calendar days.
function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  for (let i = 0; i < 400 && cur <= to; i++) {
    out.push(cur);
    if (cur === to) break;
    cur = nextDay(cur);
  }
  return out;
}

function sumActive(slices: { kind: string; active_sec: number }[]): number {
  let s = 0;
  for (const r of slices) if (r.kind === "work") s += r.active_sec;
  return s;
}

export function ActiveHours7dWidget({
  from,
  to,
  preset,
}: {
  from: string;
  to: string;
  preset: RangePreset;
}) {
  const days = useMemo(() => daysBetween(from, to), [from, to]);

  const q = useQuery({
    queryKey: ["team-active-hours-trend", from, to],
    queryFn: () => fetchSlices(from, to, null),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const prev = useMemo(
    () => previousRange({ from, to } as ResolvedRange, preset),
    [from, to, preset],
  );
  const prevQ = useQuery({
    queryKey: ["team-active-hours-trend-prev", prev.from, prev.to] as const,
    queryFn: () => fetchSlices(prev.from, prev.to, null),
    staleTime: 60_000,
  });

  const { series, latestSec, clockedSec } = useMemo(() => {
    const byDay = new Map<string, number>(days.map((d) => [d, 0]));
    let totalActive = 0;
    let totalIdle = 0;
    for (const s of q.data ?? []) {
      if (s.kind !== "work") continue;
      totalActive += s.active_sec;
      totalIdle += s.idle_sec;
      const cur = byDay.get(s.local_day);
      if (cur !== undefined) byDay.set(s.local_day, cur + s.active_sec);
    }
    const series = days.map((d) => byDay.get(d) ?? 0);
    const latestDaySec = series.length > 0 ? series[series.length - 1] : 0;
    return {
      series,
      latestSec: days.length === 1 ? latestDaySec : totalActive,
      clockedSec: totalActive + totalIdle,
    };
  }, [q.data, days]);

  const prevActiveSec = useMemo(
    () => (prevQ.data ? sumActive(prevQ.data) : null),
    [prevQ.data],
  );

  const trend = days.length > 1 ? series.map((sec) => sec / 3600) : undefined;
  const singleDay = from === to;
  const label = singleDay ? "Active" : `${days.length}-day active`;
  const pct = clockedSec > 0 ? Math.round((latestSec / clockedSec) * 100) : null;

  return (
    <MetricTile
      label={label}
      value={q.isLoading ? "—" : fmtSecHuman(latestSec)}
      trend={trend}
      caption={
        q.isLoading ? null : (
          <span className="flex flex-col gap-1">
            <span>
              {pct === null
                ? singleDay ? "Selected day" : `${days.length} days · total`
                : `${pct}% of clocked time`}
            </span>
            <DeltaChip
              current={latestSec}
              previous={prevActiveSec}
              label={prev.label}
              isLoading={prevQ.isLoading}
              isPartial={prev.isPartial}
              daysCompared={prev.daysCompared}
              fullLength={prev.fullLength}
              partialLabel={prev.partialLabel}
              tone="neutral"
            />
          </span>
        )
      }
    />
  );
}
