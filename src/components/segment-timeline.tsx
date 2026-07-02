import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowRight, Briefcase } from "lucide-react";

// Display-only view of session_segments for one session. Shows the work-kind
// segment switches in order, with wall-clock per segment. Durations here are
// wall-clock per segment by design — they intentionally won't tie out to the
// Reporting tab, which sums active_sec (idle excluded). Different question,
// different number. No reads or writes affect billing or report RPCs.

function fmtDur(sec: number) {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

type Seg = {
  id: string;
  client_id: string | null;
  started_at: string;
  ended_at: string | null;
  active_sec: number;
};

export function SegmentTimeline({
  sessionId,
  clientMap,
}: {
  sessionId: string;
  clientMap: Map<string, string>;
}) {
  const segsQ = useQuery({
    queryKey: ["session-segments", sessionId],
    queryFn: async (): Promise<Seg[]> => {
      const { data } = await supabase
        .from("session_segments")
        .select("id,client_id,started_at,ended_at,active_sec")
        .eq("session_id", sessionId)
        .eq("kind", "work")
        .order("started_at", { ascending: true });
      return (data ?? []) as Seg[];
    },
    refetchInterval: 15_000,
  });

  const items = useMemo(() => {
    const now = Date.now();
    return (segsQ.data ?? [])
      .map((s) => {
        const live = !s.ended_at;
        const wallSec = Math.max(
          0,
          Math.round(
            ((live ? now : new Date(s.ended_at!).getTime()) -
              new Date(s.started_at).getTime()) / 1000,
          ),
        );
        return { ...s, live, wallSec };
      })
      // Hide zero-duration seed segments (the auto-opened "no client" stub
      // closed within a second when the VA picks a client). Display-only;
      // rows still exist in the database.
      .filter((s) => s.live || s.wallSec >= 2);
  }, [segsQ.data]);

  if (items.length === 0) return null;

  return (
    <div className="pt-3 border-t border-success/20">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-2 flex items-center gap-1">
        <Briefcase className="size-3" /> Today's switches
      </div>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-sm">
        {items.map((s, i) => {
          const name = s.client_id
            ? (clientMap.get(s.client_id) ?? "Unknown client")
            : "Untagged";
          return (
            <span key={s.id} className="inline-flex items-center gap-1.5">
              {i > 0 && <ArrowRight className="size-3.5 text-muted-foreground" />}
              <span
                className={
                  "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 " +
                  (s.live
                    ? "border-success/40 bg-success/10"
                    : "border-border bg-muted/40")
                }
              >
                <span className="font-medium">{name}</span>
                <span className="tabular-nums text-muted-foreground text-xs">
                  {s.live ? "live" : fmtDur(s.wallSec)}
                </span>
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
