import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { aggregate, type Rule, type Breakdown } from "@/lib/productivity";
import { useMemo } from "react";
import { todayLocal, tzDayStart, nextDay } from "@/lib/reporting";

export function useProductivityRules() {
  return useQuery({
    queryKey: ["productivity-rules"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("productivity_rules" as any)
        .select("id,pattern,rating")
        .order("pattern");
      return ((data as unknown) as Rule[]) ?? [];
    },
  });
}

/**
 * Batched fetch of activity_events for all VAs across an ET date range.
 * Window is half-open [tzDayStart(from), tzDayStart(nextDay(to))) so the
 * last second of `to` is included exactly once.
 */
export function useTeamProductivityRange({ from, to }: { from: string; to: string }) {
  const rulesQ = useProductivityRules();
  const startIso = useMemo(() => tzDayStart(from), [from]);
  const endIso = useMemo(() => tzDayStart(nextDay(to)), [to]);
  const q = useQuery({
    queryKey: ["team-productivity-range", from, to],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("activity_events")
        .select("va_id, app, url, duration_sec")
        .gte("started_at", startIso)
        .lt("started_at", endIso);
      return data ?? [];
    },
  });
  const byVa = useMemo(() => {
    const m = new Map<string, Breakdown>();
    if (!q.data || !rulesQ.data) return m;
    const groups = new Map<string, typeof q.data>();
    for (const e of q.data) {
      const arr = groups.get(e.va_id) ?? [];
      arr.push(e); groups.set(e.va_id, arr);
    }
    for (const [va, evs] of groups) {
      m.set(va, aggregate(evs, rulesQ.data).breakdown);
    }
    return m;
  }, [q.data, rulesQ.data]);
  const isLoading = q.isLoading || rulesQ.isLoading || q.isFetching || rulesQ.isFetching;
  const hasData = q.data !== undefined && rulesQ.data !== undefined;
  return { byVa, rules: rulesQ.data ?? [], isLoading, hasData };
}

/** Back-compat wrapper: today-only call site preserved for existing callers
 * (admin.tsx, etc.) that don't take a range. New ranged widgets use
 * useTeamProductivityRange directly. */
export function useTeamProductivityToday() {
  const today = todayLocal();
  return useTeamProductivityRange({ from: today, to: today });
}
