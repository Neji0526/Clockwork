import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { computeLowEngagement, fmtMin } from "@/lib/low-engagement";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

function startOfTodayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Reads the configured low-engagement threshold (minutes). */
export function useLowEngagementThreshold() {
  return useQuery({
    queryKey: ["app-config-low-engagement"],
    queryFn: async () => {
      const { data } = await supabase
        .from("app_config")
        .select("low_engagement_minutes")
        .eq("id", 1)
        .maybeSingle();
      return ((data as any)?.low_engagement_minutes as number) ?? 10;
    },
    staleTime: 60_000,
  });
}

/** Fetches today's engagement samples for one VA. */
export function useLowEngagementToday(vaId: string | null | undefined) {
  return useQuery({
    queryKey: ["engagement-today", vaId],
    enabled: !!vaId,
    queryFn: async () => {
      const since = startOfTodayIso();
      const { data, error } = await supabase
        .from("engagement_samples")
        .select("sampled_at, window_sec, interacted")
        .eq("va_id", vaId!)
        .gte("sampled_at", since)
        .order("sampled_at", { ascending: true })
        .limit(5000);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 60_000,
  });
}

export function LowEngagementChip({ vaId, compact = false }: { vaId: string; compact?: boolean }) {
  const thr = useLowEngagementThreshold();
  const samples = useLowEngagementToday(vaId);
  if (!thr.data || !samples.data || samples.data.length === 0) return null;
  const summary = computeLowEngagement(samples.data as any, thr.data);
  if (summary.totalSec < 60 && !summary.currentlyLow) return null;

  const label = summary.currentlyLow
    ? `Low engagement now · ${fmtMin(summary.currentRunSec)}`
    : `Low engagement · ${fmtMin(summary.totalSec)} today`;

  const tip = `Clocked in and not idle, but no clicks, typing, or scrolling for ${fmtMin(
    summary.currentlyLow ? summary.currentRunSec : summary.totalSec,
  )} — 10+ continuous minutes triggers this. Counts only — no keystrokes or text recorded.`;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 text-warning ${
              compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]"
            } font-medium uppercase tracking-wider`}
          >
            <AlertTriangle className={compact ? "size-2.5" : "size-3"} />
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">{tip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
