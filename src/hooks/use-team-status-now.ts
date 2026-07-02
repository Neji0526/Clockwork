// Team-wide rollup of computeLiveStatus across all active VAs.
// Read-only aggregation — same inputs as the per-VA live status, just batched.
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { computeLiveStatus, type LiveState, type LiveStatus } from "@/lib/live-status";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";

export type TeamStatusCounts = Record<LiveState, number> & { total: number };

export type TeamMemberStatus = {
  vaId: string;
  name: string;
  status: LiveStatus;
  sessionStartedAt: string | null;
};

export function useTeamStatusNow(nowMs: number) {
  const cfgQ = useQuery({
    queryKey: ["app-config-timeouts"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("app_config")
        .select("session_timeout_minutes, idle_threshold_sec")
        .eq("id", 1)
        .maybeSingle();
      return data;
    },
  });

  const q = useQuery({
    queryKey: ["team-status-now"],
    refetchInterval: 15_000,
    queryFn: async () => {
      const [{ data: vas }, { data: actives }] = await Promise.all([
        supabase
          .from("profiles")
          .select("user_id, display_name")
          .eq("role", "va")
          .eq("status", "active"),
        supabase
          .from("work_sessions")
          .select("id, va_id, started_at, last_activity_at")
          .eq("status", "active"),
      ]);

      const sessionIds = (actives ?? []).map((a) => a.id);
      const [breaksRes, idleRes] = await Promise.all([
        sessionIds.length
          ? supabase
              .from("break_segments")
              .select("session_id, started_at")
              .is("ended_at", null)
              .in("session_id", sessionIds)
          : Promise.resolve({ data: [] as any[] }),
        sessionIds.length
          ? supabase
              .from("idle_segments")
              .select("session_id, started_at")
              .in("session_id", sessionIds)
              .order("started_at", { ascending: false })
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const openBreakBySession = new Map<string, { started_at: string }>();
      for (const b of breaksRes.data ?? []) {
        openBreakBySession.set(b.session_id, { started_at: b.started_at });
      }
      const latestIdleBySession = new Map<string, { started_at: string }>();
      for (const i of idleRes.data ?? []) {
        if (!latestIdleBySession.has(i.session_id)) {
          latestIdleBySession.set(i.session_id, { started_at: i.started_at });
        }
      }

      return {
        vas: vas ?? [],
        actives: actives ?? [],
        openBreakBySession,
        latestIdleBySession,
      };
    },
  });

  useRealtimeInvalidate("team-status-now", [
    { table: "work_sessions", invalidate: [["team-status-now"]] },
    { table: "break_segments", invalidate: [["team-status-now"]] },
    { table: "idle_segments", invalidate: [["team-status-now"]] },
  ]);

  const sessionTimeoutMin = (cfgQ.data as any)?.session_timeout_minutes ?? 10;
  const idleThresholdMin = Math.max(
    1,
    Math.round(((cfgQ.data as any)?.idle_threshold_sec ?? 300) / 60),
  );

  const { counts, members } = useMemo(() => {
    const base: TeamStatusCounts = { working: 0, break: 0, idle: 0, off: 0, total: 0 };
    const list: TeamMemberStatus[] = [];
    if (!q.data) return { counts: base, members: list };
    const { vas, actives, openBreakBySession, latestIdleBySession } = q.data;
    base.total = vas.length;
    const activeByVa = new Map<string, (typeof actives)[number]>();
    for (const s of actives) {
      const prev = activeByVa.get(s.va_id);
      if (!prev || new Date(s.started_at) > new Date(prev.started_at)) {
        activeByVa.set(s.va_id, s);
      }
    }
    for (const va of vas) {
      const active = activeByVa.get(va.user_id) ?? null;
      const status = computeLiveStatus({
        activeSession: active ? { id: active.id, started_at: active.started_at } : null,
        openBreak: active ? openBreakBySession.get(active.id) ?? null : null,
        latestIdle: active ? latestIdleBySession.get(active.id) ?? null : null,
        lastActivityAt: active?.last_activity_at ?? null,
        sessionTimeoutMin,
        idleThresholdMin,
        now: nowMs,
      });
      base[status.state] += 1;
      list.push({
        vaId: va.user_id,
        name: (va as any).display_name ?? "Unknown",
        status,
        sessionStartedAt: active?.started_at ?? null,
      });
    }
    return { counts: base, members: list };
  }, [q.data, nowMs, sessionTimeoutMin, idleThresholdMin]);

  return { counts, members, isLoading: q.isLoading || cfgQ.isLoading };
}
