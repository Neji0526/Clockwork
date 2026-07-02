import { createFileRoute, redirect } from "@tanstack/react-router";
import { RequireAuth } from "@/components/require-auth";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { useEffect, useMemo, useState } from "react";
import { fmtDuration, fmtHoursHuman, fmtSecHuman } from "@/lib/format";
import { setUserRole, setUserStatus, listTeam, setUserPayRate } from "@/lib/admin.functions";
import { getClientHistory, deleteClient, getProjectHistory, deleteProject } from "@/lib/clients.functions";
import { createAdminInvite, listAdminInvites, revokeAdminInvite } from "@/lib/admin-invites.functions";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { UserPlus, AlertTriangle, Copy, Check, Briefcase, Plus, Archive, ArchiveRestore, Pencil, BookOpen, Printer, Lock as LockIcon, DollarSign, Settings as SettingsIcon, Coffee, Users, Activity, Timer, ShieldCheck, Link2, Trash2, ChevronRight, ChevronDown, Layers, X } from "lucide-react";



import { Link } from "@tanstack/react-router";
import { AdminOnboardingChecklist } from "@/components/admin-onboarding-checklist";
import { RatioBar, ShareRow } from "@/components/ui/ratio-bar";
import { MetricTile } from "@/components/ui/metric-tile";
import { CountUp } from "@/components/ui/count-up";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { computeLiveStatus } from "@/lib/live-status";
import { ScreenshotLightbox } from "@/components/screenshot-lightbox";
import { CaptureNowButton } from "@/components/capture-now-button";
import { LowEngagementChip } from "@/components/low-engagement-chip";
import { ProductivityScore, ProductivityBar } from "@/components/productivity-score";
import { StatusLegend, tooltipForLive } from "@/components/status-legend";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useTeamProductivityToday } from "@/hooks/use-productivity";
import { PlatformChip } from "@/components/platform-chip";
import { ReportingPanel } from "@/components/admin/reporting-panel";
import { fetchSlices, todayLocal, type Slice } from "@/lib/reporting";

const ADMIN_TABS = ["today","reporting","clients","vas"] as const;
type AdminTab = typeof ADMIN_TABS[number];
const STATUS_FILTERS = ["working","break","idle","off"] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Team — ClockWork" }] }),
  // Bookmark safety nets — all redirects land on the final destination
  // in a single hop:
  //  - old "Settings" tab moved to /admin/settings
  //  - old "Live" tab merged into Today (always live now)
  //  - old "Payroll"/"Invoices"/"Financials" tabs now live on /financials
  //    (top-level sidebar item, no longer a Team tab).
  beforeLoad: ({ location }) => {
    const params = new URLSearchParams(location.searchStr ?? "");
    const raw = params.get("tab");
    if (raw === "settings") {
      throw redirect({ to: "/admin/settings", replace: true });
    }
    if (raw === "live") {
      throw redirect({ to: "/admin", replace: true });
    }
    if (raw === "timesheets") {
      throw redirect({ to: "/financials", search: { section: "timesheets" }, replace: true });
    }
    if (raw === "signatures") {
      throw redirect({ to: "/sops", search: { section: "signals" }, replace: true });
    }
    if (raw === "productivity") {
      throw redirect({ to: "/admin/settings", search: { section: "productivity" }, replace: true });
    }
    if (raw === "audit") {
      throw redirect({ to: "/admin/settings", search: { section: "audit" }, replace: true });
    }
    if (raw === "payroll") {
      throw redirect({ to: "/financials", search: { section: "payroll" }, replace: true });
    }
    if (raw === "invoices") {
      throw redirect({ to: "/financials", replace: true });
    }
    if (raw === "financials") {
      const sec = params.get("section");
      throw redirect({
        to: "/financials",
        search:
          sec === "payroll" ? { section: "payroll" }
          : sec === "timesheets" ? { section: "timesheets" }
          : {},
        replace: true,
      });
    }
  },
  validateSearch: (s: Record<string, unknown>): { tab?: AdminTab; status?: StatusFilter } => {
    const t = typeof s.tab === "string" ? s.tab : undefined;
    const st = typeof s.status === "string" ? s.status : undefined;
    return {
      tab: (ADMIN_TABS as readonly string[]).includes(t ?? "") ? (t as AdminTab) : undefined,
      status: (STATUS_FILTERS as readonly string[]).includes(st ?? "") ? (st as StatusFilter) : undefined,
    };
  },
  component: () => (
    <RequireAuth><AdminGate /></RequireAuth>
  ),
});

function AdminGate() {
  const { profile } = useAuth();
  if (profile?.role !== "admin") {
    return <AppShell><p className="text-sm text-muted-foreground">Admin only.</p></AppShell>;
  }
  return <AppShell><AdminDashboard /></AppShell>;
}

function startOfDayISO(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x.toISOString(); }
function endOfDayISO(d: Date) { const x = new Date(d); x.setHours(23,59,59,999); return x.toISOString(); }

function AdminDashboard() {
  const navigate = Route.useNavigate();
  const { tab: tabFromUrl } = Route.useSearch();
  const tab = tabFromUrl ?? "today";
  const setTab = (next: string) => {
    navigate({ search: { tab: next === "today" ? undefined : (next as AdminTab) }, replace: true });
  };


  // Detect whether the workspace has any VAs at all — drives day-zero state.
  const teamSizeQ = useQuery({
    queryKey: ["admin-team-size"],
    queryFn: async () => {
      const { count } = await supabase
        .from("profiles")
        .select("user_id", { head: true, count: "exact" })
        .eq("role", "va");
      return count ?? 0;
    },
    staleTime: 30_000,
  });

  const noTeam = (teamSizeQ.data ?? null) === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-gold/90 font-medium mb-1.5">Operations</div>
          <h1 className="font-display text-4xl md:text-5xl leading-[1.05]">Team</h1>
        </div>
      </div>

      {noTeam ? (
        <EmptyState
          icon={<UserPlus />}
          eyebrow="Day one"
          title="Invite your first member"
          description="ClockWork comes alive once your first member clocks in. Send an invite — they'll get an email with their login and a one-page installer for the tracker extension."
          action={
            <Button onClick={() => setTab("vas")}>
              <UserPlus className="size-4 mr-1.5" /> Open Members tab
            </Button>
          }
        />
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto scrollbar-none [mask-image:linear-gradient(to_right,transparent,black_16px,black_calc(100%-16px),transparent)] sm:[mask-image:none]">
          <TabsList
            className="w-max sm:w-auto h-auto rounded-none gap-1 bg-transparent p-0 border-b border-border
              [&>[role=tab]]:rounded-none [&>[role=tab]]:px-3 [&>[role=tab]]:py-2
              [&>[role=tab]]:text-[13px] [&>[role=tab]]:font-normal
              [&>[role=tab]]:text-muted-foreground
              [&>[role=tab]:hover]:text-foreground
              [&>[role=tab][data-state=active]]:bg-transparent
              [&>[role=tab][data-state=active]]:shadow-none
              [&>[role=tab][data-state=active]]:text-foreground
              [&>[role=tab]]:after:-bottom-px"
          >
            <TabsTrigger value="today">Today</TabsTrigger>
            <TabsTrigger value="reporting">Reporting</TabsTrigger>
            <TabsTrigger value="clients">Brands</TabsTrigger>
            <TabsTrigger value="vas">Members</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="today" className="mt-6"><TodayPanel /></TabsContent>
        <TabsContent value="reporting" className="mt-6"><ReportingPanel /></TabsContent>
        <TabsContent value="clients" className="mt-6"><ClientsPanel /></TabsContent>
        <TabsContent value="vas" className="mt-6"><VasPanel /></TabsContent>
      </Tabs>
    </div>
  );
}










function relTime(iso?: string | null) {
  if (!iso) return "—";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  return `${Math.floor(s/3600)}h ago`;
}

function TodayThumb({ path }: { path: string | null | undefined }) {
  const q = useQuery({
    queryKey: ["admin-today-thumb", path],
    enabled: !!path,
    queryFn: async () => {
      const { data } = await supabase.storage.from("va-screenshots").createSignedUrl(path!, 60);
      return data?.signedUrl ?? null;
    },
    staleTime: 45_000,
    refetchInterval: 45_000,
  });
  if (!path) return <div className="aspect-video w-full rounded-md bg-muted flex items-center justify-center text-xs text-muted-foreground">No screenshot yet</div>;
  if (!q.data) return <div className="aspect-video w-full rounded-md bg-muted animate-pulse" />;
  return <img src={q.data} alt="Latest screenshot" className="aspect-video w-full rounded-md object-cover border border-border" />;
}

function TodayPanel() {
  const { user } = useAuth();
  const { status: statusFilter } = Route.useSearch();
  const navigate = Route.useNavigate();
  const clearStatusFilter = () =>
    navigate({ search: (prev: { tab?: AdminTab; status?: StatusFilter }) => ({ ...prev, status: undefined }), replace: true });
  const [now, setNow] = useState(Date.now());
  // Today is always-live: tick every second so running-times stay smooth.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const fetchTeamForEmails = useServerFn(listTeam);
  const teamQ = useQuery({ queryKey: ["admin-team"], queryFn: () => fetchTeamForEmails() });
  const emailByVa = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of (teamQ.data ?? []) as any[]) if (p.email) m.set(p.user_id, p.email);
    return m;
  }, [teamQ.data]);
  const todayStart = useMemo(() => startOfDayISO(new Date()), []);
  const todayEnd = useMemo(() => endOfDayISO(new Date()), []);

  const q = useQuery({
    queryKey: ["admin-today"],
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data: vas } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .eq("role", "va")
        .eq("status", "active")
        .order("display_name");
      if (!vas?.length) return [];

      const [{ data: todaySessions }, { data: liveSessions }] = await Promise.all([
        supabase
          .from("work_sessions")
          .select("id, va_id, client_id, started_at, ended_at, status, active_sec, idle_sec, last_activity_at, platform, source")
          .gte("started_at", todayStart)
          .lte("started_at", todayEnd),
        // Always include currently-active sessions even if they started before
        // local midnight — otherwise a VA who clocked in last night appears
        // "off" here while the live dashboard tile (which doesn't filter by
        // date) correctly shows them as working.
        supabase
          .from("work_sessions")
          .select("id, va_id, client_id, started_at, ended_at, status, active_sec, idle_sec, last_activity_at, platform, source")
          .eq("status", "active"),
      ]);

      const byId = new Map<string, NonNullable<typeof todaySessions>[number]>();
      for (const s of todaySessions ?? []) byId.set(s.id, s);
      for (const s of liveSessions ?? []) if (!byId.has(s.id)) byId.set(s.id, s);
      const sessions = Array.from(byId.values());

      const sessByVa = new Map<string, typeof sessions>();
      for (const s of sessions) {
        const arr = sessByVa.get(s.va_id) ?? [];
        arr.push(s); sessByVa.set(s.va_id, arr);
      }

      return Promise.all(vas.map(async (va) => {
        const list = sessByVa.get(va.user_id) ?? [];
        const active = list.reduce((a, s) => a + (s.active_sec ?? 0), 0);
        const idle = list.reduce((a, s) => a + (s.idle_sec ?? 0), 0);
        const activeSession = list.find(s => s.status === "active");

        const { data: lastShot } = await supabase
          .from("screenshots")
          .select("storage_path, captured_at")
          .eq("va_id", va.user_id)
          .gte("captured_at", todayStart)
          .order("captured_at", { ascending: false }).limit(1).maybeSingle();

        const { data: lastAct } = await supabase
          .from("activity_events")
          .select("app, url, title, started_at")
          .eq("va_id", va.user_id)
          .gte("started_at", todayStart)
          .order("started_at", { ascending: false }).limit(1).maybeSingle();

        const { count: clicksToday } = await supabase
          .from("workflow_steps")
          .select("id", { head: true, count: "exact" })
          .eq("va_id", va.user_id)
          .gte("created_at", todayStart);

        let idleRecently = false;
        let latestIdle: { started_at: string } | null = null;
        let openBreak: { started_at: string } | null = null;
        if (activeSession) {
          const { data: li } = await supabase
            .from("idle_segments")
            .select("started_at")
            .eq("session_id", activeSession.id)
            .order("started_at", { ascending: false }).limit(1).maybeSingle();
          latestIdle = li ?? null;
          idleRecently = !!latestIdle && (Date.now() - new Date(latestIdle.started_at).getTime()) < 5 * 60_000;

          const { data: ob } = await supabase
            .from("break_segments")
            .select("started_at")
            .eq("session_id", activeSession.id)
            .is("ended_at", null)
            .order("started_at", { ascending: false }).limit(1).maybeSingle();
          openBreak = ob ?? null;
        }

        return { va, sessions: list, active, idle, activeSession, lastShot, lastAct, idleRecently, latestIdle, openBreak, clicksToday: clicksToday ?? 0 };
      }));
    },
  });

  // Realtime — any tracking activity refreshes the team view.
  useRealtimeInvalidate("admin-today", [
    { table: "work_sessions", invalidate: [["admin-today"]] },
    { table: "activity_events", invalidate: [["admin-today"]] },
    { table: "screenshots", invalidate: [["admin-today"]] },
    { table: "idle_segments", invalidate: [["admin-today"]] },
    { table: "break_segments", invalidate: [["admin-today"]] },
  ]);



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
  const sessionTimeoutMin = (cfgQ.data as any)?.session_timeout_minutes ?? 10;
  const idleThresholdMin = Math.max(1, Math.round(((cfgQ.data as any)?.idle_threshold_sec ?? 300) / 60));

  // Today's work-segment active/idle per VA — same RPC the Reporting tab uses,
  // so this tile matches Reporting exactly and ticks live for open segments.
  const todaySlicesQ = useQuery({
    queryKey: ["admin-today-slices"],
    queryFn: () => fetchSlices(todayLocal(), todayLocal(), null),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const segActiveByVa = useMemo(() => {
    const m = new Map<string, { active: number; idle: number }>();
    for (const s of todaySlicesQ.data ?? []) {
      const cur = m.get(s.va_id) ?? { active: 0, idle: 0 };
      if (s.kind === "work") cur.active += s.active_sec;
      cur.idle += s.idle_sec; // idle counted across all segments
      m.set(s.va_id, cur);
    }
    return m;
  }, [todaySlicesQ.data]);

  const totals = useMemo(() => {
    const rows = q.data ?? [];
    let working = 0, onIdle = 0, onBreak = 0, off = 0, active = 0, idle = 0;
    for (const r of rows) {
      const seg = segActiveByVa.get(r.va.user_id);
      active += seg?.active ?? r.active;
      idle   += seg?.idle   ?? r.idle;
      const s = computeLiveStatus({
        activeSession: r.activeSession ? { id: r.activeSession.id, started_at: r.activeSession.started_at } : null,
        openBreak: r.openBreak ?? null,
        latestIdle: r.latestIdle ?? null,
        lastActivityAt: (r.activeSession as any)?.last_activity_at ?? null,
        sessionTimeoutMin,
        idleThresholdMin,
        now,
      });
      if (s.state === "working") working++;
      else if (s.state === "break") onBreak++;
      else if (s.state === "idle") onIdle++;
      else off++;
    }
    return { active, idle, working, onIdle, onBreak, off, team: rows.length };
  }, [q.data, now, sessionTimeoutMin, idleThresholdMin, segActiveByVa]);

  // Optional ?status= filter: derived in the same way `totals` computes each row's
  // live state, so the dashboard tile counts match this filtered list exactly.
  const filteredRows = useMemo(() => {
    const rows = q.data ?? [];
    if (!statusFilter) return rows;
    return rows.filter((r) => {
      const s = computeLiveStatus({
        activeSession: r.activeSession ? { id: r.activeSession.id, started_at: r.activeSession.started_at } : null,
        openBreak: r.openBreak ?? null,
        latestIdle: r.latestIdle ?? null,
        lastActivityAt: (r.activeSession as any)?.last_activity_at ?? null,
        sessionTimeoutMin,
        idleThresholdMin,
        now,
      });
      return s.state === statusFilter;
    });
  }, [q.data, statusFilter, sessionTimeoutMin, idleThresholdMin, now]);

  const STATUS_LABEL: Record<StatusFilter, string> = {
    working: "Working",
    break: "On break",
    idle: "Idle",
    off: "Off the clock",
  };



  const { byVa: prodByVa } = useTeamProductivityToday();


  const dateStr = new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="space-y-6">
      {user?.id && <AdminOnboardingChecklist userId={user.id} />}
      {/* Light overview band */}
      <header className="px-1">
        <div className="flex flex-col gap-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] font-medium mb-2 inline-flex items-center gap-1.5 text-muted-foreground">
                <span className="size-1.5 rounded-full bg-gold animate-pulse" aria-hidden />
                <Activity className="size-3" /> Live overview
              </div>
              <h2 className="font-display text-3xl md:text-4xl xl:text-5xl leading-[1.04] tracking-tight text-foreground">
                Today, <span className="text-gold">{dateStr}.</span>
              </h2>
            </div>
          </div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground -mt-2">
            Full roster · updating live
          </p>




          {q.data && q.data.length > 0 && (
            <div className="stagger-children grid gap-3 grid-cols-2 lg:grid-cols-5">
              <MetricTile
                label="Working now"
                accent
                icon={<Activity className="size-3" />}
                value={<CountUp value={totals.working} />}
                caption={`of ${totals.team} on the team`}
              />
              <MetricTile
                label="On break"
                icon={<Coffee className="size-3" />}
                value={<CountUp value={totals.onBreak} />}
                caption={totals.onBreak === 1 ? "Member on break" : "Members on break"}
              />
              <MetricTile
                label="Idle"
                icon={<Coffee className="size-3" />}
                value={<CountUp value={totals.onIdle} />}
                caption={
                  <span className="flex flex-col gap-0.5">
                    <span>{totals.onIdle === 1 ? "Member idle" : "Members idle"}</span>
                    <span className="text-[10px] text-muted-foreground/80">
                      Idle after {idleThresholdMin} min of no activity
                    </span>
                  </span>
                }
              />
              {/* "Active hours" = sum of work-segment active_sec for today (Eastern),
                  via report_segment_day_slices. Matches the Reporting tab exactly,
                  ticks live during open segments, excludes idle and break. */}
              <MetricTile
                label="Active hours"
                icon={<Timer className="size-3" />}
                value={<CountUp value={totals.active / 3600} format={fmtHoursHuman} />}
                caption="Team total today"
              />
              <MetricTile
                label="Idle hours"
                icon={<Users className="size-3" />}
                value={<CountUp value={totals.idle / 3600} format={fmtHoursHuman} />}
                caption={totals.active + totals.idle > 0 ? `${Math.round((totals.idle / (totals.active + totals.idle)) * 100)}% of session time` : "—"}
              />
            </div>
          )}

        </div>
      </header>

      <NeedsReviewSops />

      <TodayByClientCard />

      {q.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {q.data && q.data.length === 0 ? (
        <EmptyState
          icon={<Users />}
          eyebrow="Quiet today"
          title="No active members yet"
          description="Once a member installs the tracker and clocks in, their session lands here automatically."
        />
      ) : (
        <>





        {statusFilter && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs">
            <span className="text-muted-foreground">
              Showing{" "}
              <span className="text-foreground font-medium tabular-nums">{filteredRows.length}</span>{" "}
              <span className="text-foreground">{STATUS_LABEL[statusFilter as StatusFilter]}</span>
              <span className="text-muted-foreground"> · {(q.data ?? []).length} on the team</span>
            </span>
            <button
              type="button"
              onClick={clearStatusFilter}
              className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              Show all
            </button>
          </div>
        )}

        {statusFilter && filteredRows.length === 0 ? (
          <EmptyState
            icon={<Users />}
            eyebrow="Filtered view"
            title={`No teammates currently ${STATUS_LABEL[statusFilter as StatusFilter].toLowerCase()}.`}
            description="Clear the filter to see the full team."
            action={
              <Button variant="outline" onClick={clearStatusFilter}>Show all</Button>
            }
          />
        ) : (
        <div className="rounded-xl border border-border bg-card/40 overflow-x-auto">
          <div className="hidden md:grid grid-cols-[minmax(220px,1.8fr)_minmax(150px,0.9fr)_minmax(190px,1.1fr)_minmax(240px,1.5fr)_16px] gap-4 px-4 py-2.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground border-b border-border bg-muted/20">
            <div>Member</div>
            <div>Status</div>
            <div>Worked / Idle</div>
            <div>On-task</div>
            <div />
          </div>

          <ul className="divide-y divide-border">
          {filteredRows.map((row) => {
            const seg = segActiveByVa.get(row.va.user_id);
            const rowActive = seg?.active ?? row.active;
            const rowIdle   = seg?.idle   ?? row.idle;
            const total = rowActive + rowIdle;
            const idleRatio = total > 0 ? rowIdle / total : 0;
            const live = computeLiveStatus({
              activeSession: row.activeSession,
              openBreak: row.openBreak,
              latestIdle: row.latestIdle,
              lastActivityAt: (row.activeSession as any)?.last_activity_at ?? null,
              sessionTimeoutMin,
              idleThresholdMin,
              now,
            });
            const showSinceLabel =
              live.state === "break"
                ? `On break · ${fmtDuration(live.sinceSec)}`
                : live.state === "idle"
                  ? `Idle · ${fmtDuration(live.sinceSec)}`
                  : live.label;
            const initials = (row.va.display_name ?? "?")
              .split(/\s+/).map((w: string) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "·";
            const avatarClass =
              live.state === "break"
                ? "bg-warning/15 text-warning ring-1 ring-warning/40"
                : live.state === "working"
                  ? "bg-success/15 text-success ring-1 ring-success/40"
                  : "bg-muted text-muted-foreground ring-1 ring-border";
            return (
              <li key={row.va.user_id}>
                <Link
                  to="/admin/$vaId"
                  params={{ vaId: row.va.user_id }}
                  className="group grid md:grid-cols-[minmax(220px,1.8fr)_minmax(150px,0.9fr)_minmax(190px,1.1fr)_minmax(240px,1.5fr)_16px] grid-cols-1 gap-4 px-4 py-4 items-center hover:bg-muted/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold/60"
                >


                  {/* VA */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="relative shrink-0">
                      <div className={`grid place-items-center size-9 rounded-full font-display text-sm ${avatarClass}`}>
                        {initials}
                      </div>
                      <span className="absolute -bottom-0.5 -right-0.5 grid place-items-center size-3.5 rounded-full bg-background ring-2 ring-background">
                        <span className="relative flex size-2">
                          {live.state === "working" && (
                            <span className={`absolute inline-flex h-full w-full rounded-full ${live.dotClass} opacity-75 animate-ping`} />
                          )}
                          <span className={`relative inline-flex rounded-full size-2 ${live.dotClass}`} />
                        </span>
                      </span>
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate group-hover:text-gold transition-colors">
                        {row.va.display_name ?? "Unknown"}
                      </div>
                      {emailByVa.get(row.va.user_id) && (
                        <div className="text-[11px] font-mono text-muted-foreground truncate" title={emailByVa.get(row.va.user_id)}>
                          {emailByVa.get(row.va.user_id)}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Status */}
                  <div className="min-w-0">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="outline" className="gap-1.5 font-normal max-w-full cursor-help">
                            <span className={`inline-flex size-2 rounded-full ${live.dotClass} shrink-0`} />
                            <span className="truncate">{showSinceLabel}</span>
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[280px] text-xs leading-snug">
                          {tooltipForLive(live.state, live.label)}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>

                  {/* Worked / Idle */}
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2 tabular-nums whitespace-nowrap">
                      <span className="font-display text-base text-foreground">{fmtDuration(rowActive)}</span>
                      <span className="text-muted-foreground text-xs">/</span>
                      <span className="text-muted-foreground text-sm">{fmtDuration(rowIdle)}</span>
                      {idleRatio > 0.3 && total > 0 && (
                        <span className="inline-flex items-center text-warning" title="High idle today">
                          <AlertTriangle className="size-3" />
                        </span>
                      )}
                    </div>
                    {total > 0 && (
                      <div className="mt-1.5">
                        <RatioBar
                          segments={[
                            { value: rowActive, color: "var(--color-primary)", label: "Active" },
                            { value: rowIdle, color: "color-mix(in oklab, var(--color-warning) 70%, transparent)", label: "Idle" },
                          ]}
                        />
                        <div className="text-[10px] text-muted-foreground mt-0.5">{Math.round(idleRatio * 100)}% idle</div>
                      </div>
                    )}
                  </div>

                  {/* On-task */}
                  <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                    {prodByVa.get(row.va.user_id) && (
                      <ProductivityScore
                        breakdown={prodByVa.get(row.va.user_id)!}
                        muted={live.state === "idle" || live.state === "off"}
                      />
                    )}
                    <LowEngagementChip vaId={row.va.user_id} compact />
                  </div>



                  <ChevronRight className="hidden md:block size-4 text-muted-foreground/40 group-hover:text-gold transition-colors" />
                </Link>
              </li>
            );
          })}
          </ul>
        </div>
        )}
        </>
      )}
    </div>
  );
}

function TodayByClientCard() {
  const day = todayLocal();
  const slicesQ = useQuery({
    queryKey: ["today-by-client-slices", day],
    queryFn: () => fetchSlices(day, day, null),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const clientsQ = useQuery({
    queryKey: ["clients-lookup"],
    queryFn: async () => (await supabase.from("clients").select("id,name").order("name")).data ?? [],
    staleTime: 60_000,
  });
  const clientName = useMemo(
    () => new Map((clientsQ.data ?? []).map((c) => [c.id, c.name])),
    [clientsQ.data],
  );

  const { buckets, coveragePct } = useMemo(() => {
    const work = (slicesQ.data ?? []).filter((s: Slice) => s.kind === "work");
    const map = new Map<string, number>();
    let total = 0;
    let tagged = 0;
    for (const s of work) {
      const key = s.client_id ?? "__none__";
      map.set(key, (map.get(key) ?? 0) + s.active_sec);
      total += s.active_sec;
      if (s.project_id) tagged += s.active_sec;
    }
    const arr = Array.from(map.entries())
      .map(([k, sec]) => ({
        key: k,
        label: k === "__none__" ? "Untagged" : clientName.get(k) ?? "Unknown brand",
        sec,
      }))
      .filter((b) => b.sec > 0)
      .sort((a, b) => b.sec - a.sec);
    return {
      buckets: arr,
      coveragePct: total > 0 ? Math.round((tagged / total) * 100) : 0,
    };
  }, [slicesQ.data, clientName]);

  if (buckets.length === 0) return null;
  const total = buckets.reduce((a, b) => a + b.sec, 0);
  const max = buckets[0].sec;
  const palette = [
    "var(--color-primary)",
    "var(--color-gold)",
    "color-mix(in oklab, var(--color-primary) 70%, white)",
    "color-mix(in oklab, var(--color-gold) 70%, white)",
    "color-mix(in oklab, var(--color-primary) 40%, var(--color-muted-foreground))",
  ];

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-baseline justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <Briefcase className="size-4" />Today by brand
        </CardTitle>
        <span className="text-xs text-muted-foreground tabular-nums">{fmtSecHuman(total)} tracked</span>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex h-2 w-full overflow-hidden rounded-full bg-muted/40">
          {buckets.map((b, i) => (
            <div
              key={b.key}
              className="h-full transition-[width] duration-500"
              style={{ width: `${(b.sec / total) * 100}%`, background: palette[i % palette.length] }}
              title={`${b.label} · ${fmtSecHuman(b.sec)}`}
            />
          ))}
        </div>
        <ul className="space-y-2.5">
          {buckets.map((b, i) => {
            const pct = Math.max(2, (b.sec / max) * 100);
            return (
              <li key={b.key} className="text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="size-2 rounded-full shrink-0" style={{ background: palette[i % palette.length] }} />
                    <span className={`truncate ${b.key === "__none__" ? "text-muted-foreground italic" : "text-foreground"}`}>{b.label}</span>
                  </span>
                  <span className="text-muted-foreground tabular-nums text-xs">
                    {fmtSecHuman(b.sec)} <span className="opacity-60">· {Math.round((b.sec / total) * 100)}%</span>
                  </span>
                </div>
                <div className="mt-1 h-[3px] rounded-full bg-muted/40 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: palette[i % palette.length] }} />
                </div>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 pt-3 border-t text-xs text-muted-foreground flex items-center justify-between">
          <span>Project coverage</span>
          <span className="tabular-nums"><strong className="text-foreground">{coveragePct}%</strong> of tracked time is tagged to a project</span>
        </div>
      </CardContent>
    </Card>
  );
}



function ClientsPanel() {
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const q = useQuery({
    queryKey: ["clients-admin"],
    queryFn: async () => ((await (supabase as any)
      .rpc("admin_list_clients_with_billing")).data ?? []) as Array<{ id: string; name: string; archived: boolean; created_at: string; bill_rate_cents: number | null; bill_currency: string }>,
  });

  async function addClient(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("clients").insert({ name });
      if (error) throw error;
      setNewName("");
      toast.success("Brand added");
      qc.invalidateQueries({ queryKey: ["clients-admin"] });
      qc.invalidateQueries({ queryKey: ["clients-lookup"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to add brand");
    } finally { setBusy(false); }
  }

  async function saveRename(id: string) {
    const name = editName.trim();
    if (!name) { setEditId(null); return; }
    const { error } = await supabase.from("clients").update({ name }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Brand renamed");
    setEditId(null);
    qc.invalidateQueries({ queryKey: ["clients-admin"] });
    qc.invalidateQueries({ queryKey: ["clients-lookup"] });
  }

  async function toggleArchive(id: string, archived: boolean) {
    const { error } = await supabase.from("clients").update({ archived: !archived }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success(archived ? "Brand restored" : "Brand archived");
    qc.invalidateQueries({ queryKey: ["clients-admin"] });
    qc.invalidateQueries({ queryKey: ["clients-lookup"] });
  }

  const clients = q.data ?? [];
  const active = clients.filter(c => !c.archived);
  const archived = clients.filter(c => c.archived);
  const [showArchived, setShowArchived] = useState(false);

  return (
    <div className="space-y-6">
      {/* Editorial header */}
      <div className="surface-card relative overflow-hidden p-6 md:p-7">
        <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-5">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-gold/90 font-medium mb-1.5 inline-flex items-center gap-1.5">
              <Briefcase className="size-3" /> Brands
            </div>
            <h2 className="font-display text-2xl md:text-3xl leading-tight">Who the team works for.</h2>
            <p className="text-sm text-muted-foreground mt-1.5 max-w-md">
              Members tag each session with a brand from the browser extension at clock-in.
            </p>
          </div>
          <div className="flex items-center gap-5 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            <div>
              <div className="font-display text-2xl text-foreground tabular-nums leading-none">{active.length}</div>
              <div className="mt-1">Active</div>
            </div>
            <div className="h-8 w-px bg-border" />
            <div>
              <div className="font-display text-2xl text-foreground/60 tabular-nums leading-none">{archived.length}</div>
              <div className="mt-1">Archived</div>
            </div>
          </div>
        </div>

        {/* Inline add */}
        <form onSubmit={addClient} className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="new-client" className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Add a brand</Label>
            <Input id="new-client" placeholder="e.g. Acme Studio" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
          <Button type="submit" disabled={busy || !newName.trim()} className="press">
            <Plus className="size-4 mr-1.5" />{busy ? "Adding…" : "Add brand"}
          </Button>
        </form>
      </div>

      {/* Active clients */}
      {active.length === 0 ? (
        <EmptyState
          icon={<Briefcase />}
          eyebrow="No brands yet"
          title="Add your first brand."
          description="Once you've added a brand, members can pick it from the tracker at clock-in — and every session flows into the right bucket for billing."
        />
      ) : (
        <div className="stagger-children grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {active.map(c => (
            <ClientCard key={c.id} client={c} editId={editId} editName={editName} setEditId={setEditId} setEditName={setEditName} saveRename={saveRename} toggleArchive={toggleArchive} onRateSaved={() => { qc.invalidateQueries({ queryKey: ["clients-admin"] }); qc.invalidateQueries({ queryKey: ["clients-lookup"] }); }} />
          ))}
        </div>
      )}

      {/* Archived */}
      {archived.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowArchived(v => !v)}
            className="text-xs uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
          >
            <Archive className="size-3" />
            Archived ({archived.length}) {showArchived ? "—" : "+"}
          </button>
          {showArchived && (
            <div className="mt-3 divide-y divide-border border border-border rounded-lg bg-card/40">
              {archived.map(c => (
                <div key={c.id} className="px-4 py-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Briefcase className="size-4 text-muted-foreground shrink-0" />
                      <span className="text-sm text-muted-foreground line-through truncate">{c.name}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="sm" className="text-xs" onClick={() => toggleArchive(c.id, c.archived)}>
                        <ArchiveRestore className="size-3.5 mr-1.5" />Restore
                      </Button>
                      <DeleteArchivedBrandButton clientId={c.id} name={c.name} onDeleted={() => qc.invalidateQueries({ queryKey: ["clients-admin"] })} />
                    </div>
                  </div>
                  {/* Read-only project list when the parent brand is archived:
                      shows the same data members would see, but with all
                      edit controls intentionally hidden — they re-enable
                      when the brand is restored. */}
                  <ProjectsSection clientId={c.id} clientName={c.name} readOnly={true} />
                </div>
              ))}
            </div>

          )}
        </div>
      )}
    </div>
  );
}

function PayRateInline({ userId, cents, currency }: { userId: string; cents: number; currency: string }) {
  const setPay = useServerFn(setUserPayRate);
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState((cents / 100).toFixed(2));
  const fmt = (cents / 100).toLocaleString(undefined, { style: "currency", currency });
  if (!editing) {
    return (
      <button
        onClick={() => { setVal((cents / 100).toFixed(2)); setEditing(true); }}
        className="inline-flex items-center gap-1 hover:text-foreground"
        title="Set hourly pay rate"
      >
        <DollarSign className="size-3" />
        {cents > 0 ? `${fmt}/hr` : "Set rate"}
      </button>
    );
  }
  async function save() {
    const n = Math.max(0, Math.round(Number(val) * 100));
    if (!Number.isFinite(n)) { setEditing(false); return; }
    try {
      await setPay({ data: { user_id: userId, pay_rate_cents: n, pay_currency: currency } });
      toast.success("Pay rate updated");
      qc.invalidateQueries({ queryKey: ["admin-team"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    setEditing(false);
  }
  return (
    <span className="inline-flex items-center gap-1">
      <DollarSign className="size-3" />
      <Input
        autoFocus
        type="number"
        step="0.01"
        min={0}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
        className="h-6 w-20 text-xs"
      />
      <span className="text-muted-foreground">/hr</span>
    </span>
  );
}


function VasPanel() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const setRole = useServerFn(setUserRole);
  const setStatus = useServerFn(setUserStatus);
  const fetchTeam = useServerFn(listTeam);

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [invited, setInvited] = useState<{ email: string; password: string; display_name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const q = useQuery({
    queryKey: ["admin-team"],
    queryFn: () => fetchTeam(),
  });

  const adminCount = useMemo(
    () => (q.data ?? []).filter((p: any) => p.role === "admin").length,
    [q.data],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-invite", {
        body: { email, display_name: name },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      setInvited({ email, display_name: name, password: (data as any).temp_password });
      setEmail(""); setName("");
      qc.invalidateQueries({ queryKey: ["admin-team"] });
      toast.success("Member invited. Share the temporary password below.");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to invite member");
    } finally { setBusy(false); }
  }

  function closeInvite() {
    setInvited(null);
    setOpen(false);
    setCopied(false);
  }

  async function copyCreds() {
    if (!invited) return;
    const text = `Email: ${invited.email}\nTemporary password: ${invited.password}`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const team = q.data ?? [];
  const counts = useMemo(() => ({
    total: team.length,
    admins: team.filter((p: any) => p.role === "admin").length,
    vas: team.filter((p: any) => p.role === "va").length,
    invited: team.filter((p: any) => p.status === "invited").length,
    disabled: team.filter((p: any) => p.status === "disabled").length,
  }), [team]);

  return (
    <div className="space-y-6">
      {/* Editorial header */}
      <div className="surface-card relative overflow-hidden p-6 md:p-7">
        <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-5">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-gold/90 font-medium mb-1.5 inline-flex items-center gap-1.5">
              <Users className="size-3" /> Team members
            </div>
            <h2 className="font-display text-2xl md:text-3xl leading-tight">Who's on the clock.</h2>
            <p className="text-sm text-muted-foreground mt-1.5 max-w-md">
              Invite members, promote partners to admin, and manage account status.
            </p>
          </div>
          <div className="flex items-center gap-5 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            <div>
              <div className="font-display text-2xl text-foreground tabular-nums leading-none">{counts.vas}</div>
              <div className="mt-1">Members</div>
            </div>
            <div className="h-8 w-px bg-border" />
            <div>
              <div className="font-display text-2xl text-gold tabular-nums leading-none">{counts.admins}</div>
              <div className="mt-1">Admins</div>
            </div>
            <div className="h-8 w-px bg-border" />
            <div>
              <div className="font-display text-2xl text-foreground/60 tabular-nums leading-none">{counts.invited}</div>
              <div className="mt-1">Invited</div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Dialog open={open} onOpenChange={(v) => { if (!v) closeInvite(); else setOpen(true); }}>
            <DialogTrigger asChild>
              <Button className="press"><UserPlus className="size-4 mr-1.5" />Invite member</Button>
            </DialogTrigger>
            <DialogContent>
              {invited ? (
                <>
                  <DialogHeader>
                    <DialogTitle>Member invited</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3 text-sm">
                    <p className="text-muted-foreground">
                      Share these credentials with <span className="font-medium text-foreground">{invited.display_name}</span>. They can sign in to the web app and the browser extension immediately.
                    </p>
                    <div className="rounded-md border bg-muted/40 p-3 space-y-2 font-mono text-xs">
                      <div><span className="text-muted-foreground">Email: </span>{invited.email}</div>
                      <div><span className="text-muted-foreground">Temp password: </span>{invited.password}</div>
                    </div>
                    <p className="text-xs text-muted-foreground">This password won't be shown again. Ask them to change it after first login.</p>
                  </div>
                  <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={copyCreds}>
                      {copied ? <Check className="size-4 mr-1.5" /> : <Copy className="size-4 mr-1.5" />}
                      {copied ? "Copied" : "Copy"}
                    </Button>
                    <Button onClick={closeInvite}>Done</Button>
                  </DialogFooter>
                </>
              ) : (
                <>
                  <DialogHeader><DialogTitle>Invite a member</DialogTitle></DialogHeader>
                  <form onSubmit={submit} className="space-y-4">
                    <div className="space-y-2"><Label>Name</Label><Input value={name} onChange={e=>setName(e.target.value)} required /></div>
                    <div className="space-y-2"><Label>Email</Label><Input type="email" value={email} onChange={e=>setEmail(e.target.value)} required /></div>
                    <p className="text-xs text-muted-foreground">We'll generate a one-time temporary password for you to share with them.</p>
                    <DialogFooter>
                      <Button type="submit" disabled={busy}>{busy ? "Inviting…" : "Create account"}</Button>
                    </DialogFooter>
                  </form>
                </>
              )}
            </DialogContent>
          </Dialog>
          <AdminInviteLinkCreate />
        </div>
      </div>

      <AdminInviteLinksList />



      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : team.length === 0 ? (
        <EmptyState
          icon={<UserPlus />}
          eyebrow="No team yet"
          title="Invite your first member."
          description="ClockWork comes alive once a virtual assistant clocks in. Send an invite — they'll get login credentials and a one-page installer for the tracker."
        />
      ) : (
        <div className="stagger-children grid gap-3 md:grid-cols-2">
          {team.map((p: any) => {
            const isSelf = p.user_id === user?.id;
            const isLastAdmin = p.role === "admin" && counts.admins <= 1;
            const initials = (p.display_name ?? p.email ?? "?")
              .split(/\s+/).map((w: string) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
            const isAdmin = p.role === "admin";
            return (
              <div key={p.user_id} className="surface-card group p-4 lift transition-all">
                <div className="flex items-start gap-3">
                  <div className={`grid place-items-center size-11 rounded-full font-display text-base shrink-0 ${
                    isAdmin ? "bg-gold/15 text-gold ring-1 ring-gold/40" : "bg-muted text-foreground ring-1 ring-border"
                  }`}>
                    {initials || "·"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {p.role === "va" ? (
                        <Link
                          to="/admin/$vaId"
                          params={{ vaId: p.user_id }}
                          className="font-display text-base leading-tight hover:text-gold transition-colors truncate"
                        >
                          {p.display_name ?? "—"}
                        </Link>
                      ) : (
                        <span className="font-display text-base leading-tight truncate">{p.display_name ?? "—"}</span>
                      )}
                      {isSelf && <Badge variant="outline" className="text-[10px] uppercase tracking-wider">you</Badge>}
                    </div>
                    <div className="text-sm text-foreground/80 font-mono truncate mt-0.5" title={p.email ?? ""}>{p.email ?? "no email on file"}</div>
                    <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider ${
                        isAdmin
                          ? "bg-gold/15 text-gold border border-gold/40"
                          : "bg-muted/60 text-muted-foreground border border-border"
                      }`}>{p.role}</span>
                      {p.status === "active" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider bg-success/15 text-success border border-success/40">
                          <span className="size-1.5 rounded-full bg-success animate-pulse" />active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider bg-muted/60 text-muted-foreground border border-border">
                          {p.status}
                        </span>
                      )}
                      {!p.consent_at && p.role === "va" && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider bg-warning/15 text-warning border border-warning/40">
                          <AlertTriangle className="size-2.5" />no consent
                        </span>
                      )}
                    </div>
                    <div className="mt-2 text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
                      <span>Joined {new Date(p.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
                      {p.role === "va" && (
                        <>
                          <span className="text-border">·</span>
                          <PayRateInline userId={p.user_id} cents={p.pay_rate_cents ?? 0} currency={p.pay_currency ?? "USD"} />
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-border/60 flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Manage</span>
                  <div className="flex items-center gap-2">
                    <Select
                      value={p.role}
                      disabled={isLastAdmin}
                      onValueChange={async (v) => {
                        if (v === p.role) return;
                        if (v === "va" && isSelf) {
                          if (!confirm("Demote yourself to member? You will lose admin access immediately.")) return;
                        }
                        try {
                          await setRole({ data: { user_id: p.user_id, role: v as "admin"|"va" } });
                          toast.success("Role updated");
                          qc.invalidateQueries({ queryKey: ["admin-team"] });
                        } catch (e: any) { toast.error(e.message); }
                      }}
                    >
                      <SelectTrigger className="w-24 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="va">va</SelectItem><SelectItem value="admin">admin</SelectItem></SelectContent>
                    </Select>
                    <Select
                      value={p.status}
                      onValueChange={async (v) => {
                        if (v === p.status) return;
                        try {
                          await setStatus({ data: { user_id: p.user_id, status: v as any } });
                          toast.success("Status updated");
                          qc.invalidateQueries({ queryKey: ["admin-team"] });
                        } catch (e: any) { toast.error(e.message); }
                      }}
                    >
                      <SelectTrigger className="w-24 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">active</SelectItem>
                        <SelectItem value="invited">invited</SelectItem>
                        <SelectItem value="disabled">disabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


function AdminInviteLinkCreate() {
  const qc = useQueryClient();
  const create = useServerFn(createAdminInvite);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [expiresDays, setExpiresDays] = useState<number>(7);
  const [maxUses, setMaxUses] = useState<number>(1);
  const [busy, setBusy] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const row: any = await create({
        data: { label: label.trim() || undefined, expires_days: expiresDays, max_uses: maxUses },
      });
      const url = `${window.location.origin}/admin-invite/${row.token}`;
      setCreatedUrl(url);
      qc.invalidateQueries({ queryKey: ["admin-invite-links"] });
      toast.success("Admin invite link created.");
    } catch (err: any) {
      toast.error(err?.message ?? "Couldn't create invite link");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setOpen(false);
    setCreatedUrl(null);
    setLabel("");
    setExpiresDays(7);
    setMaxUses(1);
    setCopied(false);
  }

  async function copyUrl() {
    if (!createdUrl) return;
    await navigator.clipboard.writeText(createdUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : reset())}>
      <DialogTrigger asChild>
        <Button variant="outline" className="press">
          <ShieldCheck className="size-4 mr-1.5" />Create admin invite link
        </Button>
      </DialogTrigger>
      <DialogContent>
        {createdUrl ? (
          <>
            <DialogHeader>
              <DialogTitle>Admin invite link ready</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                Anyone who opens this link and signs in will be promoted to admin. Share it carefully.
              </p>
              <div className="rounded-md border bg-muted/40 p-3 font-mono text-xs break-all">
                {createdUrl}
              </div>
              <p className="text-xs text-muted-foreground">
                You can revoke this link anytime from the list below.
              </p>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={copyUrl}>
                {copied ? <Check className="size-4 mr-1.5" /> : <Copy className="size-4 mr-1.5" />}
                {copied ? "Copied" : "Copy link"}
              </Button>
              <Button onClick={reset}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Create admin invite link</DialogTitle>
            </DialogHeader>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label>Label <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. For Sarah" maxLength={80} />
                <p className="text-xs text-muted-foreground">Helps you remember who the link was for.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Expires in (days)</Label>
                  <Input type="number" min={1} max={90} value={expiresDays} onChange={(e) => setExpiresDays(Math.max(1, Math.min(90, Number(e.target.value) || 1)))} required />
                </div>
                <div className="space-y-2">
                  <Label>Max uses</Label>
                  <Input type="number" min={1} max={100} value={maxUses} onChange={(e) => setMaxUses(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} required />
                </div>
              </div>
              <div className="rounded-md border border-gold/30 bg-gold/[0.05] p-3 text-xs text-foreground/90 flex items-start gap-2">
                <AlertTriangle className="size-3.5 mt-0.5 text-gold shrink-0" />
                <span>Anyone with the link will gain admin access after signing in — treat it like a password.</span>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create link"}</Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AdminInviteLinksList() {
  const qc = useQueryClient();
  const fetchList = useServerFn(listAdminInvites);
  const revoke = useServerFn(revokeAdminInvite);
  const q = useQuery({
    queryKey: ["admin-invite-links"],
    queryFn: () => fetchList(),
  });
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const items = q.data ?? [];
  if (q.isLoading) return null;
  if (items.length === 0) return null;

  function statusOf(row: any): { label: string; tone: "default" | "secondary" | "destructive" | "outline" } {
    if (row.revoked_at) return { label: "Revoked", tone: "destructive" };
    if (new Date(row.expires_at).getTime() < Date.now()) return { label: "Expired", tone: "outline" };
    if (row.uses >= row.max_uses) return { label: "Used up", tone: "outline" };
    return { label: "Active", tone: "secondary" };
  }

  async function copyLink(row: any) {
    const url = `${window.location.origin}/admin-invite/${row.token}`;
    await navigator.clipboard.writeText(url);
    setCopiedId(row.id);
    setTimeout(() => setCopiedId(null), 1500);
    toast.success("Invite link copied");
  }

  async function handleRevoke(row: any) {
    if (!confirm(`Revoke this admin invite link${row.label ? ` ("${row.label}")` : ""}? It can no longer be used after this.`)) return;
    try {
      await revoke({ data: { id: row.id } });
      qc.invalidateQueries({ queryKey: ["admin-invite-links"] });
      toast.success("Invite link revoked");
    } catch (err: any) {
      toast.error(err?.message ?? "Could not revoke");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="size-4 text-gold" />
          Admin invite links
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {items.map((row: any) => {
            const s = statusOf(row);
            const url = `${window.location.origin}/admin-invite/${row.token}`;
            const active = s.label === "Active";
            return (
              <li key={row.id} className="py-3 flex items-center gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{row.label || "Admin invite"}</span>
                    <Badge variant={s.tone}>{s.label}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {row.uses}/{row.max_uses} used · expires {new Date(row.expires_at).toLocaleDateString()}
                  </div>
                  {active && (
                    <div className="font-mono text-[11px] text-muted-foreground/80 mt-1 truncate" title={url}>
                      {url}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {active && (
                    <Button size="sm" variant="outline" onClick={() => copyLink(row)}>
                      {copiedId === row.id ? <Check className="size-3.5 mr-1.5" /> : <Copy className="size-3.5 mr-1.5" />}
                      {copiedId === row.id ? "Copied" : "Copy"}
                    </Button>
                  )}
                  {!row.revoked_at && (
                    <Button size="sm" variant="ghost" onClick={() => handleRevoke(row)} title="Revoke">
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function NeedsReviewSops() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["sops-needs-review"],
    queryFn: async () => {
      const { data: sops, error } = await supabase
        .from("sops")
        .select("id, title, updated_at, generated_for_va")
        .eq("needs_review", true)
        .order("updated_at", { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      const ids = (sops ?? []).map((s) => s.id);
      const counts = new Map<string, number>();
      if (ids.length) {
        const { data: cs } = await supabase
          .from("sop_comments")
          .select("sop_id")
          .eq("is_question", true)
          .in("sop_id", ids);
        for (const r of cs ?? []) counts.set(r.sop_id, (counts.get(r.sop_id) ?? 0) + 1);
      }
      return (sops ?? []).map((s) => ({ ...s, questions: counts.get(s.id) ?? 0 }));
    },
  });

  async function resolve(id: string) {
    setBusy(id);
    const { error } = await supabase.from("sops").update({ needs_review: false }).eq("id", id);
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success("Resolved");
    qc.invalidateQueries({ queryKey: ["sops-needs-review"] });
  }

  if (!q.data?.length) return null;

  return (
    <Card className="border-amber-500/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="size-4 text-amber-500" />
          SOPs needing review
          <Badge variant="outline" className="ml-1">{q.data.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {q.data.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-card/40 px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{s.title}</div>
              <div className="text-xs text-muted-foreground">
                {s.questions} question{s.questions === 1 ? "" : "s"} · updated {relTime(s.updated_at)}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button asChild variant="outline" size="sm">
                <Link to="/sops/$sopId" params={{ sopId: s.id }}>Open</Link>
              </Button>
              <Button size="sm" onClick={() => resolve(s.id)} disabled={busy === s.id}>
                {busy === s.id ? "…" : "Resolve"}
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}


// ====================== CLIENT BILL RATE CARD ======================
// Two states driven by `bill_rate_cents`:
//   NULL  → "Time tracking only · not invoiced" (deliberate, not forgotten).
//           Hours still appear in Reporting & Timesheets — just never invoiced.
//   > 0   → Billable at that rate.
// Typed 0 (or empty) on save resolves to NULL — we never persist the
// ambiguous "billable at $0" state.
function ClientCard({ client, editId, editName, setEditId, setEditName, saveRename, toggleArchive, onRateSaved }: {
  client: { id: string; name: string; archived: boolean; created_at: string; bill_rate_cents: number | null; bill_currency: string };
  editId: string | null; editName: string; setEditId: (id: string | null) => void; setEditName: (s: string) => void;
  saveRename: (id: string) => void; toggleArchive: (id: string, archived: boolean) => void; onRateSaved: () => void;
}) {
  const isBillable = (client.bill_rate_cents ?? 0) > 0;
  const [rate, setRate] = useState(isBillable ? (client.bill_rate_cents! / 100).toString() : "");
  const [cur, setCur] = useState(client.bill_currency ?? "USD");
  const [saving, setSaving] = useState(false);
  // Show the rate editor when this brand is already billable, OR when the
  // admin has explicitly clicked "Set a bill rate" on a tracking-only brand.
  const [editing, setEditing] = useState(isBillable);

  const parsedCents = (() => {
    const n = Number(rate);
    if (!rate.trim() || !Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 100);
  })();
  const dirty = parsedCents !== (client.bill_rate_cents ?? null) || cur !== (client.bill_currency ?? "USD");

  async function saveRate() {
    setSaving(true);
    try {
      const typedZero = rate.trim() !== "" && parsedCents === null;
      const payload: Record<string, unknown> = { bill_rate_cents: parsedCents, bill_currency: cur };
      const { error } = await (supabase as any).from("clients").update(payload).eq("id", client.id);
      if (error) throw error;
      if (parsedCents === null) {
        toast.success(typedZero
          ? "A bill rate must be above 0 — brand set to time-tracking-only."
          : "Brand set to time-tracking-only.");
        setEditing(false);
        setRate("");
      } else {
        toast.success("Bill rate saved");
      }
      onRateSaved();
    } catch (e: any) { toast.error(e?.message ?? "Failed to save"); } finally { setSaving(false); }
  }

  async function clearRate() {
    setSaving(true);
    try {
      const { error } = await (supabase as any).from("clients").update({ bill_rate_cents: null }).eq("id", client.id);
      if (error) throw error;
      toast.success("Brand set to time-tracking-only.");
      setRate("");
      setEditing(false);
      onRateSaved();
    } catch (e: any) { toast.error(e?.message ?? "Failed to clear"); } finally { setSaving(false); }
  }

  return (
    <div className="surface-card group p-4 space-y-3 lift transition-all">
      <div className="flex items-center gap-3">
        <div className="grid place-items-center size-10 rounded-full bg-gold/10 text-gold ring-1 ring-gold/30 shrink-0">
          <Briefcase className="size-4" />
        </div>
        <div className="flex-1 min-w-0">
          {editId === client.id ? (
            <Input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} onBlur={() => saveRename(client.id)}
              onKeyDown={(e) => { if (e.key === "Enter") saveRename(client.id); if (e.key === "Escape") setEditId(null); }} className="h-8" />
          ) : (
            <>
              {/* Name owns its own line — pill moved to the meta row below so long brand
                  names ("AI For Business", "Paper Flips") never truncate. */}
              <div className="font-display text-base leading-tight truncate" title={client.name}>{client.name}</div>
              <div className="mt-1 flex items-center gap-2 flex-wrap">
                {isBillable ? (
                  <span className="text-[9px] uppercase tracking-[0.16em] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 ring-1 ring-emerald-500/30">Billable</span>
                ) : (
                  <span className="text-[9px] uppercase tracking-[0.16em] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground ring-1 ring-border">Tracking only</span>
                )}
                <span className="text-[11px] text-muted-foreground">Added {new Date(client.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="icon" className="size-8" title="Rename" onClick={() => { setEditId(client.id); setEditName(client.name); }}><Pencil className="size-3.5" /></Button>
          <Button variant="ghost" size="icon" className="size-8" title="Archive" onClick={() => toggleArchive(client.id, client.archived)}><Archive className="size-3.5" /></Button>
        </div>
      </div>

      {editing ? (
        <div className="space-y-2 pt-2 border-t border-border/60">
          <div className="flex items-end gap-2">
            <div className="space-y-1 flex-1">
              <Label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Bill rate / hr</Label>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">{cur}</span>
                <Input type="number" step="0.01" min="0" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="—" className="h-8 w-24 tabular-nums" />
              </div>
            </div>
            <Select value={cur} onValueChange={setCur}>
              <SelectTrigger className="h-8 w-20 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["USD","EUR","GBP","CAD","AUD","PHP"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant={dirty ? "default" : "ghost"} disabled={!dirty || saving} onClick={saveRate} className="h-8">{saving ? "…" : "Save"}</Button>
          </div>
          {isBillable && (
            <button type="button" onClick={clearRate} disabled={saving} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline">
              Clear rate — make tracking-only
            </button>
          )}
          {!isBillable && (
            <button type="button" onClick={() => { setEditing(false); setRate(""); }} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">
              Cancel
            </button>
          )}
        </div>
      ) : (
        <div className="pt-2 border-t border-border/60 space-y-2">
          <p className="text-[11px] text-muted-foreground leading-snug">
            Hours still appear in Reporting and Timesheets — this brand just isn't invoiced.
          </p>
          <Button size="sm" variant="outline" className="h-8" onClick={() => setEditing(true)}>Set a bill rate</Button>
        </div>
      )}

      <ProjectsSection clientId={client.id} clientName={client.name} readOnly={false} />
    </div>
  );
}



// ====================== DELETE ARCHIVED BRAND ======================
// Three-case flow driven by a server-side history check (invoices, segments,
// sessions). Only rendered on archived brands — must archive before delete.
//   Case A (no history)            → simple confirm.
//   Case B (hours, no invoices)    → type-to-confirm orphan warning. Hours
//                                    survive (FK SET NULL) but lose their
//                                    brand label in Reporting/Timesheets.
//   Case C (has invoices)          → action is offered but DISABLED with a
//                                    clear explanation. The DB FK is RESTRICT,
//                                    so the delete is physically impossible
//                                    until the invoices are gone — and we
//                                    keep invoiced brands for audit anyway.
function DeleteArchivedBrandButton({ clientId, name, onDeleted }: { clientId: string; name: string; onDeleted: () => void }) {
  const getHistoryFn = useServerFn(getClientHistory);
  const deleteFn = useServerFn(deleteClient);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hist, setHist] = useState<{ invoices: number; segments: number; sessions: number } | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function openDialog() {
    setOpen(true);
    setConfirmText("");
    setHist(null);
    setLoading(true);
    try {
      const h = await getHistoryFn({ data: { clientId } });
      setHist(h);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to check brand history");
      setOpen(false);
    } finally { setLoading(false); }
  }

  async function doDelete() {
    setDeleting(true);
    try {
      await deleteFn({ data: { clientId } });
      toast.success(`Deleted "${name}"`);
      setOpen(false);
      onDeleted();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to delete");
    } finally { setDeleting(false); }
  }

  const caseC = (hist?.invoices ?? 0) > 0;                    // invoiced → blocked
  const caseB = !caseC && ((hist?.segments ?? 0) + (hist?.sessions ?? 0)) > 0; // hours → type-to-confirm
  const caseA = !!hist && !caseC && !caseB;                   // clean → simple confirm
  const canDelete =
    !deleting && !loading && hist !== null && !caseC &&
    (caseA || (caseB && confirmText.trim() === name));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setOpen(false); setConfirmText(""); } }}>
      <Button
        variant="ghost" size="sm"
        className="text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
        onClick={openDialog}
        title="Delete brand"
      >
        <Trash2 className="size-3.5 mr-1.5" />Delete
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete "{name}"?</DialogTitle>
        </DialogHeader>

        {loading || !hist ? (
          <p className="text-sm text-muted-foreground">Checking brand history…</p>
        ) : caseC ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <AlertTriangle className="size-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-medium text-amber-700 dark:text-amber-400">Can't be deleted</div>
                <p className="text-muted-foreground mt-1">
                  Has {hist.invoices} invoice{hist.invoices === 1 ? "" : "s"}. Brands with billing
                  history are kept permanent for audit — you can archive but not delete them.
                </p>
              </div>
            </div>
          </div>
        ) : caseB ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <AlertTriangle className="size-4 text-destructive shrink-0 mt-0.5" />
              <div>
                <div className="font-medium text-destructive">This will orphan tracked hours</div>
                <p className="text-muted-foreground mt-1">
                  <span className="text-foreground font-medium">{name}</span> has{" "}
                  {hist.segments > 0 && <>{hist.segments} tracked segment{hist.segments === 1 ? "" : "s"}</>}
                  {hist.segments > 0 && hist.sessions > 0 && " and "}
                  {hist.sessions > 0 && <>{hist.sessions} session{hist.sessions === 1 ? "" : "s"}</>}
                  . Deleting will keep those hours but remove their brand label —
                  they'll show as "no brand" in Reporting and Timesheets. This can't be undone.
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Type <span className="font-mono text-foreground">{name}</span> to confirm</Label>
              <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={name} autoFocus />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            This brand has no invoices or tracked hours. Deleting it can't be undone.
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={deleting}>
            {caseC ? "Close" : "Cancel"}
          </Button>
          {!caseC && (
            <Button variant="destructive" onClick={doDelete} disabled={!canDelete}>
              {deleting ? "Deleting…" : "Delete brand"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ====================== PROJECTS SECTION ======================
// Collapsible per-brand project list. Admin-only writes (gated by the
// existing `projects admin write` RLS policy + admin route guard), so
// CRUD goes straight through the supabase client — no server function
// needed except for the delete-with-orphan-guard pair.
//
// readOnly=true is used when the parent brand is archived: list is
// shown so admins can audit what existed, but every edit affordance
// (add / rename / archive / restore / delete) is intentionally hidden.
// Restoring the brand re-enables them.
//
// Invalidates BOTH ["projects-admin", clientId] (this card) and
// ["projects-lookup"] (the va-home picker) on every mutation so a
// newly-added project appears in the member's dropdown without a
// manual refresh.
function ProjectsSection({ clientId, clientName, readOnly }: { clientId: string; clientName: string; readOnly: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const projectsQ = useQuery({
    queryKey: ["projects-admin", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id,name,client_id,archived,created_at")
        .eq("client_id", clientId)
        .order("archived")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: open,
    staleTime: 30_000,
  });
  const all = projectsQ.data ?? [];
  const active = all.filter(p => !p.archived);
  const archived = all.filter(p => p.archived);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["projects-admin", clientId] });
    qc.invalidateQueries({ queryKey: ["projects-lookup"] });
  }

  async function addProject(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    // Case-insensitive dedupe within this brand.
    const dup = all.some(p => p.name.trim().toLowerCase() === name.toLowerCase());
    if (dup) { toast.error("A project with that name already exists for this brand."); return; }
    setAdding(true);
    try {
      const { error } = await supabase.from("projects").insert({ client_id: clientId, name });
      if (error) throw error;
      setNewName("");
      toast.success(`Added "${name}"`);
      invalidate();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to add project");
    } finally { setAdding(false); }
  }

  async function saveRename(id: string) {
    const name = editName.trim();
    if (!name) { setEditId(null); return; }
    try {
      const { error } = await supabase.from("projects").update({ name }).eq("id", id);
      if (error) throw error;
      invalidate();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to rename");
    } finally { setEditId(null); }
  }

  async function toggleArchive(id: string, currentlyArchived: boolean) {
    try {
      const { error } = await supabase.from("projects").update({ archived: !currentlyArchived }).eq("id", id);
      if (error) throw error;
      invalidate();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update project");
    }
  }

  const totalLabel = `${active.length}${archived.length ? ` · ${archived.length} archived` : ""}`;

  return (
    <div className="pt-2 border-t border-border/60">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="inline-flex items-center gap-1.5">
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          <Layers className="size-3" />
          Projects ({totalLabel})
        </span>
        {readOnly && <span className="text-[10px] normal-case tracking-normal italic">locked — brand archived</span>}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {!readOnly && (
            <form onSubmit={addProject} className="flex items-center gap-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Add a project…"
                className="h-8 text-sm flex-1"
              />
              <Button type="submit" size="sm" className="h-8" disabled={adding || !newName.trim()}>
                <Plus className="size-3.5 mr-1" />{adding ? "…" : "Add"}
              </Button>
            </form>
          )}

          {projectsQ.isLoading ? (
            <p className="text-[11px] text-muted-foreground">Loading…</p>
          ) : active.length === 0 && archived.length === 0 ? (
            <p className="text-[11px] text-muted-foreground italic">
              {readOnly ? "No projects." : "No projects yet — add one to break down this brand's time."}
            </p>
          ) : (
            <>
              {active.length > 0 && (
                <ul className="divide-y divide-border/60 border border-border/60 rounded-md bg-background/40">
                  {active.map(p => (
                    <li key={p.id} className="px-2.5 py-1.5 flex items-center gap-2 group/proj">
                      {editId === p.id && !readOnly ? (
                        <Input
                          autoFocus
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onBlur={() => saveRename(p.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveRename(p.id);
                            if (e.key === "Escape") setEditId(null);
                          }}
                          className="h-7 text-sm flex-1"
                        />
                      ) : (
                        <span className="text-sm truncate flex-1" title={p.name}>{p.name}</span>
                      )}
                      {!readOnly && editId !== p.id && (
                        <div className="flex items-center gap-0.5 opacity-60 group-hover/proj:opacity-100 transition-opacity">
                          <Button variant="ghost" size="icon" className="size-7" title="Rename"
                            onClick={() => { setEditId(p.id); setEditName(p.name); }}>
                            <Pencil className="size-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="size-7" title="Archive"
                            onClick={() => toggleArchive(p.id, p.archived)}>
                            <Archive className="size-3" />
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {archived.length > 0 && !readOnly && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowArchived(v => !v)}
                    className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                  >
                    <Archive className="size-2.5" />
                    Archived ({archived.length}) {showArchived ? "—" : "+"}
                  </button>
                  {showArchived && (
                    <ul className="mt-1.5 divide-y divide-border/60 border border-border/60 rounded-md bg-card/30">
                      {archived.map(p => (
                        <li key={p.id} className="px-2.5 py-1.5 flex items-center gap-2">
                          <span className="text-sm text-muted-foreground line-through truncate flex-1">{p.name}</span>
                          <Button variant="ghost" size="sm" className="h-7 text-xs"
                            onClick={() => toggleArchive(p.id, p.archived)}>
                            <ArchiveRestore className="size-3 mr-1" />Restore
                          </Button>
                          <DeleteArchivedProjectButton projectId={p.id} name={p.name} onDeleted={invalidate} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {archived.length > 0 && readOnly && (
                <ul className="divide-y divide-border/60 border border-border/60 rounded-md bg-card/30">
                  {archived.map(p => (
                    <li key={p.id} className="px-2.5 py-1.5">
                      <span className="text-sm text-muted-foreground line-through truncate">{p.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Delete an archived project. Two cases (no invoice case — projects never bill):
//   No history (no segments, no sessions) → simple confirm.
//   Has history                           → type-to-confirm orphan warning.
// FKs are ON DELETE SET NULL, so hours survive and just lose the project label.
function DeleteArchivedProjectButton({ projectId, name, onDeleted }: { projectId: string; name: string; onDeleted: () => void }) {
  const getHistoryFn = useServerFn(getProjectHistory);
  const deleteFn = useServerFn(deleteProject);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hist, setHist] = useState<{ segments: number; sessions: number } | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function openDialog() {
    setOpen(true);
    setConfirmText("");
    setHist(null);
    setLoading(true);
    try {
      const h = await getHistoryFn({ data: { projectId } });
      setHist(h);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to check project history");
      setOpen(false);
    } finally { setLoading(false); }
  }

  async function doDelete() {
    setDeleting(true);
    try {
      await deleteFn({ data: { projectId } });
      toast.success(`Deleted "${name}"`);
      setOpen(false);
      onDeleted();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to delete");
    } finally { setDeleting(false); }
  }

  const hasHistory = !!hist && (hist.segments + hist.sessions) > 0;
  const canDelete = !deleting && !loading && hist !== null &&
    (!hasHistory || confirmText.trim() === name);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setOpen(false); setConfirmText(""); } }}>
      <Button
        variant="ghost" size="sm"
        className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
        onClick={openDialog}
        title="Delete project"
      >
        <Trash2 className="size-3 mr-1" />Delete
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete project "{name}"?</DialogTitle>
        </DialogHeader>

        {loading || !hist ? (
          <p className="text-sm text-muted-foreground">Checking project history…</p>
        ) : hasHistory ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <AlertTriangle className="size-4 text-destructive shrink-0 mt-0.5" />
              <div>
                <div className="font-medium text-destructive">This will orphan tracked hours</div>
                <p className="text-muted-foreground mt-1">
                  <span className="text-foreground font-medium">{name}</span> has{" "}
                  {hist.segments > 0 && <>{hist.segments} tracked segment{hist.segments === 1 ? "" : "s"}</>}
                  {hist.segments > 0 && hist.sessions > 0 && " and "}
                  {hist.sessions > 0 && <>{hist.sessions} session{hist.sessions === 1 ? "" : "s"}</>}
                  . Deleting will keep those hours under the brand but remove the project label —
                  they'll show as "no project" in the per-project Reporting breakdown. This can't be undone.
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Type <span className="font-mono text-foreground">{name}</span> to confirm</Label>
              <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={name} autoFocus />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            This project has no tracked hours. Deleting it can't be undone.
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={deleting}>Cancel</Button>
          <Button variant="destructive" onClick={doDelete} disabled={!canDelete}>
            {deleting ? "Deleting…" : "Delete project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

