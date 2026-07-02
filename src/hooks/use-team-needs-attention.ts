// Team-wide Needs Attention aggregator. Reads exactly the same inputs as the
// per-VA strip, just batched, and calls the shared computeNeedsAttention.
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import {
  computeNeedsAttention,
  type AdminAction,
  type NeedsAttentionFlag,
} from "@/lib/needs-attention";
import { computeLowEngagement, type EngagementSample } from "@/lib/low-engagement";

function startOfTodayIso() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export type TeamFlag = NeedsAttentionFlag & { vaName: string };

export type TeamNeedsAttention = {
  flags: TeamFlag[];
  earlierCount: number;
  vaCountWithFlags: number;
};

export function useTeamNeedsAttention() {
  const cfgQ = useQuery({
    queryKey: ["app-config-needs-attention"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("app_config")
        .select("session_timeout_minutes, max_break_sec, low_engagement_minutes")
        .eq("id", 1)
        .maybeSingle();
      return data as any;
    },
  });

  const sessionTimeoutMin = (cfgQ.data?.session_timeout_minutes as number | undefined) ?? 10;
  const maxBreakSec = (cfgQ.data?.max_break_sec as number | undefined) ?? 3600;
  const lowEngageMin = (cfgQ.data?.low_engagement_minutes as number | undefined) ?? 10;

  const q = useQuery({
    queryKey: ["team-needs-attention"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const todayIso = startOfTodayIso();
      const sevenDaysAgoIso = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const fourteenDaysAgoIso = new Date(Date.now() - 14 * 86_400_000).toISOString();

      const [vasRes, activesRes, breaksRes, segsRes, sessions14dRes, actionsRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("user_id, display_name")
          .eq("role", "va")
          .eq("status", "active"),
        supabase
          .from("work_sessions")
          .select("id, va_id, last_activity_at")
          .eq("status", "active"),
        supabase
          .from("break_segments")
          .select("id, session_id, va_id, started_at, ended_at")
          .gte("started_at", todayIso),
        supabase
          .from("session_segments")
          .select("id, va_id, client_id, active_sec, kind")
          .gte("started_at", todayIso)
          .eq("kind", "work"),
        supabase
          .from("work_sessions")
          .select("id, va_id")
          .gte("started_at", fourteenDaysAgoIso),
        supabase
          .from("admin_actions")
          .select("id, action, created_at, metadata")
          .in("action", ["session_stale_closed", "session_break_capped", "session_adjusted"])
          .gte("created_at", sevenDaysAgoIso)
          .order("created_at", { ascending: false })
          .limit(500),
      ]);

      const vas = vasRes.data ?? [];
      const actives = (activesRes.data ?? []) as Array<{ id: string; va_id: string; last_activity_at: string | null }>;
      const breaks = (breaksRes.data ?? []) as Array<{ id: string; session_id: string; va_id: string; started_at: string; ended_at: string | null }>;
      const segs = (segsRes.data ?? []) as Array<{ id: string; va_id: string; client_id: string | null; active_sec: number | null }>;
      const sessions14d = (sessions14dRes.data ?? []) as Array<{ id: string; va_id: string }>;
      const actions = (actionsRes.data ?? []) as AdminAction[];

      // Only fetch engagement_samples for VAs with an active session — low
      // engagement is only meaningful while clocked in.
      const activeVaIds = Array.from(new Set(actives.map((a) => a.va_id)));
      let samplesByVa = new Map<string, EngagementSample[]>();
      if (activeVaIds.length) {
        const { data: samplesData } = await supabase
          .from("engagement_samples")
          .select("va_id, sampled_at, window_sec, interacted")
          .in("va_id", activeVaIds)
          .gte("sampled_at", todayIso)
          .order("sampled_at", { ascending: true })
          .limit(20_000);
        for (const s of (samplesData ?? []) as Array<EngagementSample & { va_id: string }>) {
          const arr = samplesByVa.get(s.va_id) ?? [];
          arr.push({ sampled_at: s.sampled_at, window_sec: s.window_sec, interacted: s.interacted });
          samplesByVa.set(s.va_id, arr);
        }
      }

      return { vas, actives, breaks, segs, sessions14d, actions, samplesByVa };
    },
  });

  useRealtimeInvalidate("team-needs-attention", [
    { table: "work_sessions", invalidate: [["team-needs-attention"]] },
    { table: "break_segments", invalidate: [["team-needs-attention"]] },
    { table: "session_segments", invalidate: [["team-needs-attention"]] },
    { table: "admin_actions", invalidate: [["team-needs-attention"]] },
    { table: "engagement_samples", invalidate: [["team-needs-attention"]] },
  ]);

  const result: TeamNeedsAttention = useMemo(() => {
    const empty: TeamNeedsAttention = { flags: [], earlierCount: 0, vaCountWithFlags: 0 };
    if (!q.data) return empty;
    const { vas, actives, breaks, segs, sessions14d, actions, samplesByVa } = q.data;

    const activeByVa = new Map<string, (typeof actives)[number]>();
    for (const s of actives) activeByVa.set(s.va_id, s);

    const breaksByVa = new Map<string, typeof breaks>();
    for (const b of breaks) {
      const arr = breaksByVa.get(b.va_id) ?? [];
      arr.push(b); breaksByVa.set(b.va_id, arr);
    }
    const segsByVa = new Map<string, typeof segs>();
    for (const s of segs) {
      const arr = segsByVa.get(s.va_id) ?? [];
      arr.push(s); segsByVa.set(s.va_id, arr);
    }
    const sessIdsByVa = new Map<string, string[]>();
    for (const s of sessions14d) {
      const arr = sessIdsByVa.get(s.va_id) ?? [];
      arr.push(s.id); sessIdsByVa.set(s.va_id, arr);
    }

    const allFlags: TeamFlag[] = [];
    let earlierTotal = 0;
    const vaWith = new Set<string>();

    for (const va of vas) {
      const sessIds = new Set(sessIdsByVa.get(va.user_id) ?? []);
      const vaActions = actions.filter((a) => {
        const m = (a.metadata ?? {}) as Record<string, unknown>;
        if (a.action === "session_adjusted") {
          const sid = typeof m.session_id === "string" ? m.session_id : null;
          return sid != null && sessIds.has(sid);
        }
        return m.va_id === va.user_id;
      });

      const samples = samplesByVa.get(va.user_id) ?? [];
      const leSummary = samples.length
        ? computeLowEngagement(samples, lowEngageMin)
        : { currentlyLow: false, currentRunSec: 0 };

      const active = activeByVa.get(va.user_id) ?? null;
      const { todayFlags, earlierCount } = computeNeedsAttention({
        vaId: va.user_id,
        activeSession: active ? { id: active.id, last_activity_at: active.last_activity_at } : null,
        todayBreaks: breaksByVa.get(va.user_id) ?? [],
        todaySegments: segsByVa.get(va.user_id) ?? [],
        sessionTimeoutMin,
        maxBreakSec,
        lowEngagementOngoing: !!leSummary.currentlyLow,
        lowEngagementRunSec: leSummary.currentRunSec ?? 0,
        adminActions: vaActions,
      });

      if (todayFlags.length) vaWith.add(va.user_id);
      earlierTotal += earlierCount;
      for (const f of todayFlags) {
        allFlags.push({ ...f, vaName: va.display_name ?? "Unknown" });
      }
    }

    // Sort: rows with `when` newest-first, then anchorless rows (untagged,
    // live low-engagement) last in deterministic VA-name order.
    allFlags.sort((a, b) => {
      if (a.when && b.when) return b.when.localeCompare(a.when);
      if (a.when) return -1;
      if (b.when) return 1;
      return a.vaName.localeCompare(b.vaName);
    });

    return { flags: allFlags, earlierCount: earlierTotal, vaCountWithFlags: vaWith.size };
  }, [q.data, sessionTimeoutMin, maxBreakSec, lowEngageMin]);

  return { ...result, isLoading: q.isLoading || cfgQ.isLoading };
}
