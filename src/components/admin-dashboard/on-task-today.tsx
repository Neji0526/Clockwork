// On-task % over the selected range — team-wide, weighted by time.
// Sum productive_sec across all VAs / sum (productive_sec + unproductive_sec).
import { useMemo } from "react";
import { useTeamProductivityRange } from "@/hooks/use-productivity";
import { MetricTile } from "@/components/ui/metric-tile";
import { DeltaChip } from "./delta-chip";
import { previousRange, type RangePreset, type ResolvedRange } from "@/lib/dashboard-range";

function onTaskPctFromByVa(byVa: Map<string, { productive: number; unproductive: number }>): number | null {
  let prod = 0;
  let unprod = 0;
  for (const b of byVa.values()) {
    const denom = b.productive + b.unproductive;
    if (denom <= 0) continue;
    prod += b.productive;
    unprod += b.unproductive;
  }
  const total = prod + unprod;
  if (total <= 0) return null;
  return Math.round((prod / total) * 100);
}

export function OnTaskTodayWidget({
  from,
  to,
  preset,
}: {
  from: string;
  to: string;
  preset: RangePreset;
}) {
  const { byVa, isLoading, hasData } = useTeamProductivityRange({ from, to });

  const prev = useMemo(
    () => previousRange({ from, to } as ResolvedRange, preset),
    [from, to, preset],
  );
  const prevQ = useTeamProductivityRange({ from: prev.from, to: prev.to });

  const { pct, vaCount, unratedSec } = useMemo(() => {
    let prod = 0;
    let unprod = 0;
    let neutral = 0;
    let contributing = 0;
    for (const b of byVa.values()) {
      neutral += b.neutral;
      const denom = b.productive + b.unproductive;
      if (denom <= 0) continue;
      prod += b.productive;
      unprod += b.unproductive;
      contributing += 1;
    }
    const total = prod + unprod;
    if (total <= 0) {
      return { pct: null as number | null, vaCount: 0, unratedSec: neutral };
    }
    return { pct: Math.round((prod / total) * 100), vaCount: contributing, unratedSec: neutral };
  }, [byVa]);

  const prevPct = useMemo(() => onTaskPctFromByVa(prevQ.byVa), [prevQ.byVa]);

  const notLoaded = !hasData || isLoading;
  const loadedButEmpty = !notLoaded && pct === null;
  // Distinguish: (a) genuinely zero activity in the period vs (b) activity
  // exists but no productivity_rule matched it. Same denom=0 outcome, very
  // different actionability — (b) means "add rules", not "nothing happened".
  const hasUnratedActivity = loadedButEmpty && unratedSec > 0;
  const formatUnrated = (sec: number): string => {
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.round(sec / 60)}m`;
    const h = sec / 3600;
    return h < 10 ? `${h.toFixed(1)}h` : `${Math.round(h)}h`;
  };
  const emptyCopy = hasUnratedActivity
    ? `${formatUnrated(unratedSec)} of activity, none rated — add productivity rules`
    : "No activity yet in this range";

  return (
    <MetricTile
      label="On-task %"
      value={notLoaded || pct === null ? "—" : `${pct}%`}
      caption={
        notLoaded ? null : (
          <span className="flex flex-col gap-1">
            <span>
              {loadedButEmpty
                ? emptyCopy
                : `Weighted by time · ${vaCount} ${vaCount === 1 ? "teammate" : "teammates"}`}
            </span>
            <DeltaChip
              current={pct}
              previous={prevPct}
              label={prev.label}
              isLoading={prevQ.isLoading || !prevQ.hasData}
              isPartial={prev.isPartial}
              daysCompared={prev.daysCompared}
              fullLength={prev.fullLength}
              partialLabel={prev.partialLabel}
              tone="directional"
            />
          </span>
        )
      }
    />
  );
}
