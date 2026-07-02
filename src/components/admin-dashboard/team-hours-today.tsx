// Hours over the selected range — sums active_sec + idle_sec on work slices
// from report_segment_day_slices. "Clocked" = on-the-clock time; the matching
// Active tile reports the productive subset.
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchSlices } from "@/lib/reporting";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { MetricTile } from "@/components/ui/metric-tile";
import { fmtSecHuman } from "@/lib/format";
import { DeltaChip } from "./delta-chip";
import { previousRange, type RangePreset, type ResolvedRange } from "@/lib/dashboard-range";

function sumClocked(slices: { kind: string; active_sec: number; idle_sec: number }[]): number {
  let s = 0;
  for (const r of slices) if (r.kind === "work") s += r.active_sec + r.idle_sec;
  return s;
}

export function TeamHoursTodayWidget({
  from,
  to,
  preset,
}: {
  from: string;
  to: string;
  preset: RangePreset;
}) {
  const key = ["team-hours-range", from, to] as const;
  const q = useQuery({
    queryKey: key,
    queryFn: () => fetchSlices(from, to, null),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const prev = useMemo(
    () => previousRange({ from, to } as ResolvedRange, preset),
    [from, to, preset],
  );
  const prevQ = useQuery({
    queryKey: ["team-hours-range-prev", prev.from, prev.to] as const,
    queryFn: () => fetchSlices(prev.from, prev.to, null),
    staleTime: 60_000,
  });

  useRealtimeInvalidate("team-hours-range", [
    { table: "work_sessions", invalidate: [[...key]] },
    { table: "activity_events", invalidate: [[...key]] },
    { table: "idle_segments", invalidate: [[...key]] },
  ]);

  const { clockedSec, idleSec } = useMemo(() => {
    let a = 0, i = 0;
    for (const s of q.data ?? []) {
      if (s.kind !== "work") continue;
      a += s.active_sec;
      i += s.idle_sec;
    }
    return { clockedSec: a + i, idleSec: i };
  }, [q.data]);

  const prevClockedSec = useMemo(() => (prevQ.data ? sumClocked(prevQ.data) : null), [prevQ.data]);

  const singleDay = from === to;
  return (
    <MetricTile
      label={singleDay ? "Clocked" : "Clocked (range)"}
      value={q.isLoading ? "—" : fmtSecHuman(clockedSec)}
      caption={
        q.isLoading ? null : (
          <span className="flex flex-col gap-1">
            <span>Active + {fmtSecHuman(idleSec)} idle</span>
            <DeltaChip
              current={clockedSec}
              previous={prevClockedSec}
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
