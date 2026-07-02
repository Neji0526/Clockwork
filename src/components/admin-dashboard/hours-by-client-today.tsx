// Hours by client over the selected range — groups active_sec by client_id
// from report_segment_day_slices. null client_id → "Untagged".
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchSlices } from "@/lib/reporting";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { ShareRow } from "@/components/ui/ratio-bar";
import { fmtSecHuman } from "@/lib/format";

export function HoursByClientTodayWidget({ from, to }: { from: string; to: string }) {
  const key = ["team-hours-by-client-range", from, to] as const;
  const slicesQ = useQuery({
    queryKey: key,
    queryFn: () => fetchSlices(from, to, null),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  useRealtimeInvalidate("team-hours-by-client-range", [
    { table: "work_sessions", invalidate: [[...key]] },
    { table: "activity_events", invalidate: [[...key]] },
    { table: "session_segments", invalidate: [[...key]] },
  ]);

  const clientsQ = useQuery({
    queryKey: ["clients-min"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("id, name");
      return data ?? [];
    },
  });
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clientsQ.data ?? []) m.set(c.id, c.name);
    return m;
  }, [clientsQ.data]);

  const rows = useMemo(() => {
    const byClient = new Map<string | null, number>();
    let total = 0;
    for (const s of slicesQ.data ?? []) {
      if (s.kind !== "work") continue;
      const k = s.client_id ?? null;
      byClient.set(k, (byClient.get(k) ?? 0) + s.active_sec);
      total += s.active_sec;
    }
    const arr = Array.from(byClient.entries())
      .map(([id, sec]) => ({
        id,
        label: id ? (nameById.get(id) ?? "Unknown brand") : "Untagged",
        sec,
        isUntagged: !id,
      }))
      .sort((a, b) => b.sec - a.sec);
    return { items: arr, total };
  }, [slicesQ.data, nameById]);

  const isLoading = slicesQ.isLoading || clientsQ.isLoading;
  const singleDay = from === to;

  return (
    <section className="rounded-xl border border-border bg-card/60 p-5">
      <div className="flex items-baseline justify-between">
        <div className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
          Hours by brand {singleDay ? "(today)" : "(range)"}
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {isLoading ? "—" : <><span className="text-foreground font-medium">{fmtSecHuman(rows.total)}</span> total</>}
        </div>
      </div>

      <div className="mt-3 divide-y divide-border/60">
        {isLoading ? (
          <div className="py-6 text-xs text-muted-foreground">Loading…</div>
        ) : rows.items.length === 0 ? (
          <div className="py-6 text-xs text-muted-foreground">No tracked hours in this range.</div>
        ) : (
          rows.items.map((r) => {
            const pct = rows.total > 0 ? Math.round((r.sec / rows.total) * 100) : 0;
            return (
              <ShareRow
                key={r.id ?? "untagged"}
                label={r.label}
                value={r.sec}
                max={rows.total}
                valueLabel={`${fmtSecHuman(r.sec)} · ${pct}%`}
                accent={r.isUntagged}
              />
            );
          })
        )}
      </div>
    </section>
  );
}
