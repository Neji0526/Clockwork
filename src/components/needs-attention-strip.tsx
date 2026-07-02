import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertCircle, Clock, Edit3, Tag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  computeNeedsAttention,
  iconKeyFor,
  type AdminAction,
  type BreakSeg,
  type NeedsAttentionKind,
  type SessionSeg,
  UNTAGGED_THRESHOLD_MIN as _UNTAGGED_THRESHOLD_MIN,
} from "@/lib/needs-attention";

// Display-only "Needs attention" strip for the admin VA detail page.
// Surfaces ONLY exception events. Computation lives in @/lib/needs-attention
// so the dashboard's team-wide widget shares the exact same logic.

type Props = {
  vaId: string;
  activeSession: { id: string; last_activity_at: string | null } | null;
  todayBreaks: BreakSeg[];
  todaySegments: SessionSeg[];
  sessionIds14d: string[];
  sessionTimeoutMin: number;
  maxBreakSec: number;
  lowEngagementOngoing: boolean;
  lowEngagementRunSec: number;
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function iconFor(kind: NeedsAttentionKind) {
  switch (iconKeyFor(kind)) {
    case "alert": return <AlertCircle className="size-3.5 text-warning" />;
    case "clock": return <Clock className="size-3.5 text-warning" />;
    case "edit":  return <Edit3 className="size-3.5 text-muted-foreground" />;
    case "tag":   return <Tag className="size-3.5 text-warning" />;
  }
}

export function NeedsAttentionStrip(props: Props) {
  const {
    vaId, activeSession, todayBreaks, todaySegments, sessionIds14d,
    sessionTimeoutMin, maxBreakSec, lowEngagementOngoing, lowEngagementRunSec,
  } = props;

  const sevenDaysAgoIso = useMemo(
    () => new Date(Date.now() - 7 * 86_400_000).toISOString(),
    [],
  );

  const actionsQ = useQuery<AdminAction[]>({
    queryKey: ["va-admin-actions-7d", vaId, sessionIds14d.length],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_actions")
        .select("id, action, created_at, metadata")
        .in("action", ["session_stale_closed", "session_break_capped", "session_adjusted"])
        .gte("created_at", sevenDaysAgoIso)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      const ids = new Set(sessionIds14d);
      return (data ?? []).filter((a) => {
        const m = (a.metadata ?? {}) as Record<string, unknown>;
        if (a.action === "session_adjusted") {
          const sid = typeof m.session_id === "string" ? m.session_id : null;
          return sid != null && ids.has(sid);
        }
        return m.va_id === vaId;
      }) as AdminAction[];
    },
  });

  const { todayFlags, earlierCount } = useMemo(
    () => computeNeedsAttention({
      vaId,
      activeSession,
      todayBreaks,
      todaySegments,
      sessionTimeoutMin,
      maxBreakSec,
      lowEngagementOngoing,
      lowEngagementRunSec,
      adminActions: actionsQ.data ?? [],
    }),
    [vaId, activeSession, todayBreaks, todaySegments, sessionTimeoutMin, maxBreakSec, lowEngagementOngoing, lowEngagementRunSec, actionsQ.data],
  );

  const hasAny = todayFlags.length > 0 || earlierCount > 0;

  return (
    <section
      aria-label="Needs attention"
      className="rounded-lg border border-warning/30 bg-warning/[0.04] px-4 py-3"
    >
      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-medium mb-2">
        Needs attention
      </div>
      {!hasAny ? (
        <div className="text-xs text-muted-foreground italic">No flags today.</div>
      ) : (
        <ul className="space-y-1.5">
          {todayFlags.map((f) => (
            <li key={f.key} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5 shrink-0">{iconFor(f.kind)}</span>
              <span className="min-w-0 flex-1">
                <span className="text-foreground">{f.message}</span>
                {f.when && (
                  <span className="text-muted-foreground tabular-nums ml-1.5">
                    · {fmtTime(f.when)}
                  </span>
                )}
              </span>
            </li>
          ))}
          {earlierCount > 0 && (
            <li className="text-xs text-muted-foreground pt-1">
              <Link
                to="/admin/$vaId"
                params={{ vaId }}
                hash="activity-log"
                className="underline-offset-2 hover:underline"
              >
                +{earlierCount} earlier this week
              </Link>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

// Re-export for any legacy callers (none today, but preserves prior surface).
export const UNTAGGED_THRESHOLD_MIN = _UNTAGGED_THRESHOLD_MIN;
