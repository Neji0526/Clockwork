import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { RequireAuth } from "@/components/require-auth";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MetricTile } from "@/components/ui/metric-tile";
import { CountUp } from "@/components/ui/count-up";
import { RatioBar, ShareRow } from "@/components/ui/ratio-bar";
import { Sparkline } from "@/components/ui/sparkline";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonGrid } from "@/components/ui/skeletons";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { fmtDuration, fmtHoursHuman, fmtSecHuman, hostOf } from "@/lib/format";
import { setUserPayRate } from "@/lib/admin.functions";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowLeft, Activity, Coffee, Timer, DollarSign, Calendar,
  Image as ImageIcon, AppWindow, Clock, User, Link2, Copy, Trash2, Plus, X,
} from "lucide-react";
import { listClientShareTokens, createClientShareToken, revokeClientShareToken } from "@/lib/client-share.functions";
import { ScreenshotLightbox } from "@/components/screenshot-lightbox";
import { computeLiveStatus } from "@/lib/live-status";
import { VaActivityLog } from "@/components/va-activity-log";
import { useProductivityRules } from "@/hooks/use-productivity";
import { aggregate, classify, keyOf, ratingColor, scorePct } from "@/lib/productivity";
import { ProductivityBar, ProductivityScore } from "@/components/productivity-score";
import { CaptureNowButton } from "@/components/capture-now-button";
import { LowEngagementChip, useLowEngagementThreshold, useLowEngagementToday } from "@/components/low-engagement-chip";
import { computeLowEngagement, fmtMin } from "@/lib/low-engagement";
import { DevicesPanel } from "@/components/devices-panel";
import { NeedsAttentionStrip } from "@/components/needs-attention-strip";
import { DaySegmentTimeline } from "@/components/day-segment-timeline";

export const Route = createFileRoute("/admin_/$vaId")({
  head: () => ({ meta: [{ title: "Member — ClockWork" }] }),
  component: () => (
    <RequireAuth><Gate /></RequireAuth>
  ),
});

function Gate() {
  const { profile } = useAuth();
  if (profile?.role !== "admin") {
    return <AppShell><p className="text-sm text-muted-foreground">Admin only.</p></AppShell>;
  }
  return <AppShell><VaDetail /></AppShell>;
}

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x; }

function VaDetail() {
  const { vaId } = Route.useParams();
  const router = useRouter();

  const profileQ = useQuery({
    queryKey: ["va-profile", vaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, display_name, role, status, consent_at, created_at, pay_rate_cents, pay_currency")
        .eq("user_id", vaId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // 14-day window
  const range = useMemo(() => {
    const end = new Date();
    const start = startOfDay(new Date(Date.now() - 13 * 86_400_000));
    return { start, end };
  }, []);

  const sessionsQ = useQuery({
    queryKey: ["va-sessions-14d", vaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_sessions")
        .select("id, started_at, ended_at, status, active_sec, idle_sec")
        .eq("va_id", vaId)
        .gte("started_at", range.start.toISOString())
        .order("started_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const todayStart = useMemo(() => startOfDay(new Date()).toISOString(), []);
  const todayEnd = useMemo(() => { const e = startOfDay(new Date()); e.setHours(23,59,59,999); return e.toISOString(); }, []);

  const todayQ = useQuery({
    queryKey: ["va-today", vaId],
    refetchInterval: 30_000,
    queryFn: async () => {
      const [sess, idles, breaks, shots, acts] = await Promise.all([
        supabase.from("work_sessions").select("id, started_at, ended_at, status, active_sec, idle_sec, last_activity_at")
          .eq("va_id", vaId).gte("started_at", todayStart).lte("started_at", todayEnd).order("started_at"),
        supabase.from("idle_segments").select("id, session_id, started_at, duration_sec")
          .gte("started_at", todayStart).lte("started_at", todayEnd),
        supabase.from("break_segments").select("id, session_id, started_at, ended_at")
          .gte("started_at", todayStart).lte("started_at", todayEnd),
        supabase.from("screenshots").select("id, storage_path, captured_at")
          .eq("va_id", vaId).gte("captured_at", todayStart).order("captured_at", { ascending: false }).limit(12),
        supabase.from("activity_events").select("app, url, title, started_at, duration_sec")
          .eq("va_id", vaId).gte("started_at", todayStart).order("started_at", { ascending: false }).limit(500),
      ]);
      return {
        sessions: sess.data ?? [],
        idles: (idles.data ?? []).filter(i => (sess.data ?? []).some(s => s.id === i.session_id)),
        breaks: (breaks.data ?? []).filter(b => (sess.data ?? []).some(s => s.id === b.session_id)),
        screenshots: shots.data ?? [],
        activity: acts.data ?? [],
      };
    },
  });

  useRealtimeInvalidate(`va-detail:${vaId}`, [
    { table: "work_sessions", filter: `va_id=eq.${vaId}`, invalidate: [["va-today", vaId], ["va-sessions-14d", vaId], ["va-activity-log", vaId]] },
    { table: "activity_events", filter: `va_id=eq.${vaId}`, invalidate: [["va-today", vaId], ["va-activity-log", vaId]] },
    { table: "screenshots", filter: `va_id=eq.${vaId}`, invalidate: [["va-today", vaId]] },
    { table: "idle_segments", filter: `va_id=eq.${vaId}`, invalidate: [["va-today", vaId]] },
    { table: "break_segments", filter: `va_id=eq.${vaId}`, invalidate: [["va-today", vaId]] },
    { table: "workflow_steps", filter: `va_id=eq.${vaId}`, invalidate: [["va-activity-log", vaId]] },
    { table: "session_segments", filter: `va_id=eq.${vaId}`, invalidate: [["va-segments-today", vaId, todayStart]] },
    { table: "admin_actions", event: "INSERT", invalidate: [["va-admin-actions-7d", vaId]] },
  ]);

  // Daily roll-up for 14-day chart
  const daily = useMemo(() => {
    const days: { date: Date; active: number; idle: number }[] = [];
    for (let i = 0; i < 14; i++) {
      const d = startOfDay(new Date(range.start.getTime() + i * 86_400_000));
      days.push({ date: d, active: 0, idle: 0 });
    }
    for (const s of sessionsQ.data ?? []) {
      const idx = Math.floor((new Date(s.started_at).getTime() - range.start.getTime()) / 86_400_000);
      if (idx >= 0 && idx < 14) {
        days[idx].active += s.active_sec ?? 0;
        days[idx].idle += s.idle_sec ?? 0;
      }
    }
    return days;
  }, [sessionsQ.data, range.start]);

  const totals = useMemo(() => {
    const active = daily.reduce((a, d) => a + d.active, 0);
    const idle = daily.reduce((a, d) => a + d.idle, 0);
    const daysWorked = daily.filter(d => d.active > 0).length;
    const avgPerActiveDay = daysWorked > 0 ? active / daysWorked : 0;
    return { active, idle, daysWorked, avgPerActiveDay };
  }, [daily]);

  const rulesQ = useProductivityRules();
  const productivity = useMemo(() => {
    return aggregate(todayQ.data?.activity ?? [], rulesQ.data ?? []);
  }, [todayQ.data, rulesQ.data]);

  const topApps = useMemo(() => {
    const rules = rulesQ.data ?? [];
    const m = new Map<string, number>();
    for (const a of todayQ.data?.activity ?? []) {
      const key = keyOf(a) || (a.app ?? hostOf(a.url) ?? "Unknown");
      m.set(key, (m.get(key) ?? 0) + (a.duration_sec ?? 0));
    }
    return Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, sec]) => ({ name, sec, rating: classify(name, rules) }));
  }, [todayQ.data, rulesQ.data]);

  const p = profileQ.data;
  const activeSession = (todayQ.data?.sessions ?? []).find(s => s.status === "active") ?? null;
  const openBreak = activeSession
    ? ((todayQ.data?.breaks ?? []).find(b => b.session_id === activeSession.id && !b.ended_at) ?? null)
    : null;
  const latestIdleForSession = activeSession
    ? (todayQ.data?.idles ?? [])
        .filter(i => i.session_id === activeSession.id)
        .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())[0] ?? null
    : null;
  const cfgQ = useQuery({
    queryKey: ["app-config-timeouts"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("app_config")
        .select("session_timeout_minutes, idle_threshold_sec, max_break_sec")
        .eq("id", 1)
        .maybeSingle();
      return data;
    },
  });
  const sessionTimeoutMin = (cfgQ.data as any)?.session_timeout_minutes ?? 10;
  const idleThresholdMin = Math.max(1, Math.round(((cfgQ.data as any)?.idle_threshold_sec ?? 300) / 60));
  const maxBreakSec = (cfgQ.data as any)?.max_break_sec ?? 3600;
  const live = computeLiveStatus({
    activeSession: activeSession ? { id: activeSession.id, started_at: activeSession.started_at } : null,
    openBreak: openBreak ? { started_at: openBreak.started_at } : null,
    latestIdle: latestIdleForSession ? { started_at: latestIdleForSession.started_at } : null,
    lastActivityAt: (activeSession as any)?.last_activity_at ?? null,
    sessionTimeoutMin,
    idleThresholdMin,
  });

  // Today's session_segments across all sessions, for the Switches sub-block
  // and the untagged-work flag. Read-only.
  const segmentsTodayQ = useQuery({
    queryKey: ["va-segments-today", vaId, todayStart],
    refetchInterval: activeSession ? 30_000 : false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("session_segments")
        .select("id, session_id, client_id, started_at, ended_at, active_sec, kind")
        .eq("va_id", vaId)
        .eq("kind", "work")
        .gte("started_at", todayStart)
        .lte("started_at", todayEnd)
        .order("started_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; session_id: string; client_id: string | null;
        started_at: string; ended_at: string | null; active_sec: number | null; kind: string;
      }>;
    },
  });

  // Client name map — shared cache key with ClientShareLinks below.
  const clientsForMapQ = useQuery({
    queryKey: ["clients-for-share"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, archived")
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; archived: boolean }[];
    },
  });
  const clientMap = useMemo(
    () => new Map((clientsForMapQ.data ?? []).map((c) => [c.id, c.name])),
    [clientsForMapQ.data],
  );

  // Low-engagement live state (re-uses LowEngagementCard's queries via cache).
  const lowEngThr = useLowEngagementThreshold();
  const lowEngSamples = useLowEngagementToday(vaId);
  const lowEngSummary = useMemo(() => {
    if (!lowEngThr.data || !lowEngSamples.data) return null;
    return computeLowEngagement(lowEngSamples.data as any, lowEngThr.data);
  }, [lowEngThr.data, lowEngSamples.data]);

  const sessionIds14d = useMemo(
    () => (sessionsQ.data ?? []).map((s) => s.id),
    [sessionsQ.data],
  );



  return (
    <div className="space-y-6">
      <div>
        <button
          onClick={() => router.history.back()}
          className="inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3.5" /> Back
        </button>
      </div>

      {/* Hero */}
      <div className="surface-card relative overflow-hidden p-6 md:p-8">
        <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/40 to-transparent" />
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="flex items-start gap-4 min-w-0">
            <div className="size-14 rounded-full ring-1 ring-gold/30 bg-gold/10 grid place-items-center shrink-0">
              <User className="size-6 text-foreground/70" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.22em] text-gold/90 font-medium mb-1">Team member</div>
              <h1 className="font-display text-3xl md:text-4xl leading-[1.05] truncate">
                {p?.display_name ?? (profileQ.isLoading ? "Loading…" : "Unknown")}
              </h1>
              <div className="mt-2 flex items-center gap-2 flex-wrap text-xs">
                {p && <Badge variant={p.role === "admin" ? "default" : "secondary"}>{p.role}</Badge>}
                {p && p.status !== "active" && <Badge variant="outline">{p.status}</Badge>}
                <Badge variant="outline" className={`gap-1.5 font-normal ${live.state === "working" ? "border-success/40" : live.state === "break" ? "border-warning/40" : ""}`}>
                  <span className={`relative inline-flex size-2`}>
                    {live.state === "working" && <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-75 animate-ping" />}
                    <span className={`relative inline-flex rounded-full size-2 ${live.dotClass}`} />
                  </span>
                  {live.label}
                </Badge>
                <CaptureNowButton vaId={vaId} isClockedIn={!!activeSession && live.state !== "off"} />
                <LowEngagementChip vaId={vaId} />


                {p && (
                  <span className="text-muted-foreground inline-flex items-center gap-1">
                    <Calendar className="size-3" />
                    Joined {new Date(p.created_at).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
          </div>
          {p && (
            <PayRateEditor userId={p.user_id} cents={p.pay_rate_cents ?? 0} currency={p.pay_currency ?? "USD"} />
          )}
        </div>
      </div>

      {/* Needs attention — exception events only, quiet when clean */}
      <NeedsAttentionStrip
        vaId={vaId}
        activeSession={activeSession ? { id: activeSession.id, last_activity_at: (activeSession as any).last_activity_at ?? null } : null}
        todayBreaks={(todayQ.data?.breaks ?? []) as any}
        todaySegments={(segmentsTodayQ.data ?? []) as any}
        sessionIds14d={sessionIds14d}
        sessionTimeoutMin={sessionTimeoutMin}
        maxBreakSec={maxBreakSec}
        lowEngagementOngoing={!!lowEngSummary?.currentlyLow}
        lowEngagementRunSec={lowEngSummary?.currentRunSec ?? 0}
      />

      {/* 14-day tiles */}
      <div className="stagger-children grid gap-4 grid-cols-2 lg:grid-cols-4">
        <MetricTile
          label="Active 14d"
          accent
          icon={<Timer className="size-3" />}
          value={<CountUp value={totals.active / 3600} format={fmtHoursHuman} />}
          trend={daily.map(d => d.active / 3600)}
          caption="Hours worked"
        />
        <MetricTile
          label="Idle 14d"
          icon={<Coffee className="size-3" />}
          value={<CountUp value={totals.idle / 3600} format={fmtHoursHuman} />}
          trend={daily.map(d => d.idle / 3600)}
          caption={totals.active + totals.idle > 0 ? `${Math.round((totals.idle / (totals.active + totals.idle)) * 100)}% of session` : "—"}
        />
        <MetricTile
          label="Days worked"
          icon={<Calendar className="size-3" />}
          value={<CountUp value={totals.daysWorked} />}
          caption={`of last 14`}
        />
        <MetricTile
          label="Avg active / day"
          icon={<Activity className="size-3" />}
          value={<CountUp value={totals.avgPerActiveDay / 3600} format={fmtHoursHuman} />}
          caption="On days worked"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Daily chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">14-day activity</CardTitle>
            <p className="text-xs text-muted-foreground">Hours of active vs idle time per day</p>
          </CardHeader>
          <CardContent>
            <DailyChart days={daily} />
          </CardContent>
        </Card>

        {/* Top apps today */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><AppWindow className="size-4" />Top apps today</CardTitle>
          </CardHeader>
          <CardContent>
            {todayQ.isLoading ? (
              <div className="space-y-2">{Array.from({length:4}).map((_,i) => <div key={i} className="h-8 rounded bg-muted/60 animate-pulse" />)}</div>
            ) : topApps.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet today.</p>
            ) : (
              <div className="space-y-1.5">
                {topApps.map((app, i) => {
                  const c = ratingColor(app.rating);
                  return (
                    <div key={app.name} className="flex items-center gap-2">
                      <span className={`size-1.5 rounded-full ${c.dot} shrink-0`} title={app.rating} />
                      <div className="flex-1 min-w-0">
                        <ShareRow
                          label={app.name}
                          value={app.sec}
                          max={topApps[0].sec}
                          valueLabel={fmtDuration(app.sec)}
                          accent={i === 0}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Productivity today */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><Activity className="size-4" />Productivity today</CardTitle>
            <p className="text-xs text-muted-foreground">Productive vs unproductive time, by host/app classification.</p>
          </div>
          <div className="text-right">
            {(() => {
              const pct = scorePct(productivity.breakdown);
              return (
                <>
                  <div className="font-display text-3xl tabular-nums leading-none">{pct === null ? "—" : `${pct}%`}</div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mt-1">Productive share</div>
                </>
              );
            })()}
          </div>
        </CardHeader>
        <CardContent>
          <ProductivityBar breakdown={productivity.breakdown} height={8} />
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
            <div><span className="text-emerald-600 tabular-nums">{fmtDuration(productivity.breakdown.productive)}</span> productive</div>
            <div><span className="text-rose-600 tabular-nums">{fmtDuration(productivity.breakdown.unproductive)}</span> unproductive</div>
            <div><span className="tabular-nums">{fmtDuration(productivity.breakdown.neutral)}</span> neutral</div>
          </div>
        </CardContent>
      </Card>

      {/* Today timeline */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Clock className="size-4" />Today's timeline</CardTitle>
          <p className="text-xs text-muted-foreground">Sessions, breaks and idle stretches</p>
        </CardHeader>
        <CardContent>
          <TodayTimeline data={todayQ.data} loading={todayQ.isLoading} />
          <DaySegmentTimeline segments={segmentsTodayQ.data ?? []} clientMap={clientMap} />
        </CardContent>
      </Card>

      {/* Low engagement today */}
      <LowEngagementCard vaId={vaId} />

      {/* Connected devices (native desktop agents) */}
      <DevicesPanel vaId={vaId} />

      {/* Activity log */}
      <VaActivityLog vaId={vaId} />

      {/* Client share links */}
      <ClientShareLinks vaId={vaId} vaName={profileQ.data?.display_name ?? "this member"} />

      {/* Screenshot reel */}
      <ScreenshotReel
        loading={todayQ.isLoading}
        shots={todayQ.data?.screenshots ?? []}
      />
    </div>
  );
}

const SHOT_CAP = 12;

function ScreenshotReel({ loading, shots }: { loading: boolean; shots: { id: string; storage_path: string; captured_at: string }[] }) {
  const [zoomIdx, setZoomIdx] = useState<number | null>(null);
  const n = shots.length;
  const subtitle = loading
    ? "Loading captures…"
    : n === 0
      ? "No captures today yet"
      : n >= SHOT_CAP
        ? `Showing latest ${SHOT_CAP} captures today`
        : `${n} capture${n === 1 ? "" : "s"} today`;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><ImageIcon className="size-4" />Recent screenshots</CardTitle>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <SkeletonGrid count={6} variant="card" />
        ) : n === 0 ? (
          <EmptyState
            icon={<ImageIcon />}
            eyebrow="No captures"
            title="Nothing yet today"
            description="Screenshots will appear here as soon as the member's extension uploads them."
          />
        ) : (
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
            {shots.map((s, i) => (
              <ScreenshotThumb key={s.id} path={s.storage_path} captured={s.captured_at} onOpen={() => setZoomIdx(i)} />
            ))}
          </div>
        )}
      </CardContent>
      {zoomIdx !== null && (
        <ScreenshotLightbox
          shots={shots.map(s => ({ storage_path: s.storage_path, captured_at: s.captured_at }))}
          initialIndex={zoomIdx}
          onClose={() => setZoomIdx(null)}
        />
      )}
    </Card>
  );
}


function DailyChart({ days }: { days: { date: Date; active: number; idle: number }[] }) {
  const max = Math.max(1, ...days.map(d => (d.active + d.idle) / 3600));
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-1.5 h-40">
        {days.map((d, i) => {
          const activeH = d.active / 3600;
          const idleH = d.idle / 3600;
          const totalH = activeH + idleH;
          const ah = (activeH / max) * 100;
          const ih = (idleH / max) * 100;
          const isToday = i === days.length - 1;
          return (
            <div key={i} className="group flex-1 flex flex-col items-stretch h-full justify-end relative">
              <div
                className="w-full bg-[color-mix(in_oklab,var(--color-warning)_60%,transparent)] transition-all"
                style={{ height: `${ih}%` }}
                title={`Idle: ${fmtHoursHuman(idleH)}`}
              />
              <div
                className={`w-full transition-all ${isToday ? "bg-gold" : "bg-primary/85 group-hover:bg-primary"}`}
                style={{ height: `${ah}%` }}
                title={`Active: ${fmtHoursHuman(activeH)}`}
              />
              {totalH > 0 && (
                <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] tabular-nums text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                  {fmtHoursHuman(totalH)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5">
        {days.map((d, i) => (
          <div key={i} className="flex-1 text-center text-[9px] uppercase tracking-wider text-muted-foreground">
            {d.date.toLocaleDateString([], { weekday: "narrow" })}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 text-[10px] uppercase tracking-[0.18em] text-muted-foreground pt-2 border-t border-border">
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-primary/85" />Active</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-[color-mix(in_oklab,var(--color-warning)_60%,transparent)]" />Idle</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-gold" />Today</span>
      </div>
    </div>
  );
}

function TodayTimeline({ data, loading }: { data: any; loading: boolean }) {
  if (loading) return <div className="h-24 bg-muted/40 rounded animate-pulse" />;
  const sessions = (data?.sessions ?? []) as any[];
  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={<Clock />}
        eyebrow="Off the clock"
        title="No sessions today"
        description="Once they clock in you'll see a live ribbon of their work, breaks and idle time."
      />
    );
  }
  // Show each session as its own row with active/idle/break ratio
  const breaksBySession = new Map<string, any[]>();
  for (const b of (data?.breaks ?? [])) {
    const arr = breaksBySession.get(b.session_id) ?? []; arr.push(b); breaksBySession.set(b.session_id, arr);
  }
  return (
    <div className="space-y-4">
      {sessions.map((s) => {
        const breaks = breaksBySession.get(s.id) ?? [];
        const breakSec = breaks.reduce((a, b) => a + (b.ended_at ? Math.max(0, (new Date(b.ended_at).getTime() - new Date(b.started_at).getTime()) / 1000) : 0), 0);
        const total = (s.active_sec ?? 0) + (s.idle_sec ?? 0) + breakSec;
        const start = new Date(s.started_at);
        const end = s.ended_at ? new Date(s.ended_at) : null;
        return (
          <div key={s.id} className="space-y-2">
            <div className="flex items-baseline justify-between text-sm gap-3 flex-wrap">
              <div className="font-medium tabular-nums">
                {start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                {" → "}
                {end ? end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : <span className="text-success">live</span>}
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {fmtDuration(s.active_sec ?? 0)} active · {fmtDuration(s.idle_sec ?? 0)} idle{breakSec > 0 && ` · ${fmtDuration(Math.round(breakSec))} break`}
              </div>
            </div>
            <RatioBar
              height={10}
              segments={[
                { value: s.active_sec ?? 0, color: "var(--color-primary)", label: "Active" },
                { value: s.idle_sec ?? 0, color: "color-mix(in oklab, var(--color-warning) 70%, transparent)", label: "Idle" },
                { value: breakSec, color: "color-mix(in oklab, var(--color-muted-foreground) 35%, transparent)", label: "Break" },
              ]}
            />
          </div>
        );
      })}
    </div>
  );
}

function ScreenshotThumb({ path, captured, onOpen }: { path: string; captured: string; onOpen: () => void }) {
  const q = useQuery({
    queryKey: ["va-shot", path],
    queryFn: async () => {
      const { data } = await supabase.storage.from("va-screenshots").createSignedUrl(path, 120);
      return data?.signedUrl ?? null;
    },
    staleTime: 90_000,
  });
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open screenshot from ${new Date(captured).toLocaleTimeString()}`}
      className="group relative overflow-hidden rounded-md border border-border text-left cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {q.data ? (
        <img src={q.data} alt="Screenshot" className="aspect-video w-full object-cover transition-transform duration-500 group-hover:scale-105" />
      ) : (
        <div className="aspect-video w-full bg-muted animate-pulse" />
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 text-[10px] text-white tabular-nums opacity-0 group-hover:opacity-100 transition-opacity">
        {new Date(captured).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
      </div>
    </button>
  );
}

// ScreenshotLightbox moved to @/components/screenshot-lightbox (shared with the Live board).


function PayRateEditor({ userId, cents, currency }: { userId: string; cents: number; currency: string }) {
  const setPay = useServerFn(setUserPayRate);
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState((cents / 100).toFixed(2));
  const fmt = (cents / 100).toLocaleString(undefined, { style: "currency", currency });
  async function save() {
    const n = Math.max(0, Math.round(Number(val) * 100));
    if (!Number.isFinite(n)) { setEditing(false); return; }
    try {
      await setPay({ data: { user_id: userId, pay_rate_cents: n, pay_currency: currency } });
      toast.success("Pay rate updated");
      qc.invalidateQueries({ queryKey: ["va-profile", userId] });
      qc.invalidateQueries({ queryKey: ["admin-team"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    setEditing(false);
  }
  return (
    <div className="surface-card px-4 py-3 space-y-1 min-w-[180px]">
      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-1.5">
        <DollarSign className="size-3" /> Hourly rate
      </div>
      {editing ? (
        <div className="flex items-center gap-1">
          <Input
            autoFocus type="number" step="0.01" min={0}
            value={val} onChange={(e) => setVal(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
            className="h-8 w-24 text-sm"
          />
          <span className="text-xs text-muted-foreground">{currency}/hr</span>
        </div>
      ) : (
        <button
          onClick={() => { setVal((cents / 100).toFixed(2)); setEditing(true); }}
          className="font-display text-2xl leading-none hover:text-gold transition-colors tabular-nums"
        >
          {cents > 0 ? `${fmt}` : "Set rate"}
          <span className="text-xs text-muted-foreground font-sans ml-1">/hr</span>
        </button>
      )}
    </div>
  );
}

function ClientShareLinks({ vaId, vaName }: { vaId: string; vaName: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listClientShareTokens);
  const create = useServerFn(createClientShareToken);
  const revoke = useServerFn(revokeClientShareToken);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState<string>("30");
  const [clientId, setClientId] = useState<string>("");
  const [creating, setCreating] = useState(false);

  const tokensQ = useQuery({
    queryKey: ["client-share-tokens", vaId],
    queryFn: () => list({ data: { vaId } }),
    staleTime: 30_000,
  });

  // Clients available to scope a share link to. Admin must pick exactly one
  // — every new token is bound to a single (VA, client) pair so the holder
  // can only see that one client's hours.
  const clientsQ = useQuery({
    queryKey: ["clients-for-share"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, archived")
        .eq("archived", false)
        .order("name");
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; name: string; archived: boolean }[];
    },
  });
  const clients = clientsQ.data ?? [];
  const clientNameById = new Map(clients.map(c => [c.id, c.name]));

  async function onCreate() {
    if (!clientId) {
      toast.error("Pick a brand — share links must be scoped to one brand.");
      return;
    }
    setCreating(true);
    try {
      const expiresInDays = days === "never" ? undefined : parseInt(days, 10);
      await create({ data: { vaId, clientId, label: label.trim() || undefined, expiresInDays } });
      setLabel("");
      toast.success("Share link created");
      qc.invalidateQueries({ queryKey: ["client-share-tokens", vaId] });
    } catch (e: any) {
      toast.error(e.message ?? "Couldn't create link");
    } finally {
      setCreating(false);
    }
  }

  async function onCopy(token: string) {
    const url = `${window.location.origin}/c/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.message(url);
    }
  }

  async function onRevoke(token: string) {
    if (!confirm("Revoke this share link? Anyone using it will lose access.")) return;
    try {
      await revoke({ data: { token } });
      toast.success("Link revoked");
      qc.invalidateQueries({ queryKey: ["client-share-tokens", vaId] });
    } catch (e: any) {
      toast.error(e.message ?? "Couldn't revoke");
    }
  }

  const rows = tokensQ.data ?? [];
  const active = rows.filter((r) => !r.revoked_at && (!r.expires_at || new Date(r.expires_at).getTime() > Date.now()));
  const inactive = rows.filter((r) => !active.includes(r));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Link2 className="size-4" />Brand share links</CardTitle>
        <p className="text-xs text-muted-foreground">
          Generate a read-only public link to {vaName}'s last 30 days of hours <em>for one brand</em>. The holder sees only that brand's hours and sessions — never other brands.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_140px_auto]">
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            aria-label="Brand"
          >
            <option value="">Pick a brand…</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <Input
            placeholder="Label (optional, e.g. Acme weekly)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={80}
          />
          <select
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            aria-label="Expires in"
          >
            <option value="7">Expires in 7 days</option>
            <option value="30">Expires in 30 days</option>
            <option value="90">Expires in 90 days</option>
            <option value="never">Never expires</option>
          </select>
          <Button size="sm" onClick={onCreate} disabled={creating || !clientId}>
            <Plus className="size-4 mr-1.5" />{creating ? "Creating…" : "Create link"}
          </Button>
        </div>

        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No share links yet.</p>
        ) : (
          <div className="space-y-2">
            {active.map((r) => (
              <ShareRowItem
                key={r.token} row={r}
                clientName={r.client_id ? clientNameById.get(r.client_id) ?? null : null}
                onCopy={onCopy} onRevoke={onRevoke}
              />
            ))}
            {inactive.length > 0 && (
              <details className="text-xs text-muted-foreground pt-1">
                <summary className="cursor-pointer hover:text-foreground">
                  {inactive.length} revoked or expired
                </summary>
                <div className="mt-2 space-y-2">
                  {inactive.map((r) => (
                    <ShareRowItem
                      key={r.token} row={r}
                      clientName={r.client_id ? clientNameById.get(r.client_id) ?? null : null}
                      onCopy={onCopy} onRevoke={onRevoke} inactive
                    />
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ShareRowItem({
  row, clientName, onCopy, onRevoke, inactive = false,
}: {
  row: { token: string; label: string | null; created_at: string; expires_at: string | null; revoked_at: string | null; client_id: string | null };
  clientName: string | null;
  onCopy: (t: string) => void;
  onRevoke: (t: string) => void;
  inactive?: boolean;
}) {
  const tail = row.token.slice(-6);
  const url = typeof window !== "undefined" ? `${window.location.origin}/c/${row.token}` : `/c/${row.token}`;
  const isLegacy = !row.client_id;
  const status =
    row.revoked_at ? "Revoked"
    : row.expires_at && new Date(row.expires_at).getTime() < Date.now() ? "Expired"
    : isLegacy ? "Reissue required (legacy unscoped link)"
    : row.expires_at ? `Expires ${new Date(row.expires_at).toLocaleDateString()}`
    : "No expiry";
  return (
    <div className={`flex items-center justify-between gap-3 rounded-md border border-border p-2.5 ${inactive ? "opacity-60" : isLegacy ? "bg-amber-500/5 border-amber-500/30" : "bg-background/40"}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium truncate">{row.label || "Untitled link"}</span>
          {clientName && <Badge variant="outline" className="text-[10px] shrink-0">{clientName}</Badge>}
          <Badge variant="outline" className="text-[10px] shrink-0">…{tail}</Badge>
        </div>
        <div className="text-[11px] text-muted-foreground truncate mt-0.5">{url}</div>
        <div className={`text-[11px] mt-0.5 ${isLegacy ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>{status}</div>
      </div>
      {!inactive && (
        <div className="flex items-center gap-1 shrink-0">
          <Button size="sm" variant="ghost" onClick={() => onCopy(row.token)} title="Copy link">
            <Copy className="size-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onRevoke(row.token)} title="Revoke link">
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      )}
    </div>
  );
}



function LowEngagementCard({ vaId }: { vaId: string }) {
  const thr = useLowEngagementThreshold();
  const samples = useLowEngagementToday(vaId);
  if (!thr.data || !samples.data) return null;
  const summary = computeLowEngagement(samples.data as any, thr.data);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <span className="inline-flex size-2 rounded-full bg-warning" />
          Low engagement today
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Stretches where the member was clocked in and active but registered no clicks, typing, or scrolling for at least {thr.data} min. Counts only — no keystrokes or text are recorded.
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-3 mb-3">
          <div className="font-display text-3xl tabular-nums text-warning">
            {fmtMin(summary.totalSec)}
          </div>
          <div className="text-xs text-muted-foreground">total today</div>
          {summary.currentlyLow && (
            <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider border border-warning/40 bg-warning/10 text-warning">
              Ongoing · {fmtMin(summary.currentRunSec)}
            </span>
          )}
        </div>
        {summary.stretches.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No low-engagement stretches today.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {summary.stretches.map((s, i) => (
              <li key={i} className="py-2 flex items-center justify-between text-sm">
                <span className="inline-flex items-center gap-2">
                  <span className="inline-flex size-1.5 rounded-full bg-warning" />
                  <span className="tabular-nums">
                    {new Date(s.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    {" – "}
                    {new Date(s.endedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </span>
                <span className="text-warning font-medium tabular-nums">{fmtMin(s.durationSec)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
