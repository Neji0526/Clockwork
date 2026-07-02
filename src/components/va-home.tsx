import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Square, Circle, Clock, BookOpen, Chrome, Globe, Briefcase, Camera, MousePointerClick, CheckCircle2, Circle as CircleEmpty, ShieldCheck, Eye, Coffee, Play, TrendingUp } from "lucide-react";
import { fmtClock, fmtDuration, fmtHoursHuman, fmtSecHuman, hostOf } from "@/lib/format";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { MetricTile } from "@/components/ui/metric-tile";
import { CountUp } from "@/components/ui/count-up";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { useServerFn } from "@tanstack/react-start";
import { getWeeklyLeaderboard } from "@/lib/leaderboard.functions";
import { Flame, Trophy } from "lucide-react";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import { fetchSlices, todayLocal } from "@/lib/reporting";
import { SegmentTimeline } from "@/components/segment-timeline";

const DEFAULT_IDLE_NUDGE_SECONDS = 5 * 60;
const DEFAULT_MAX_BREAK_SECONDS = 60 * 60;

// Mirror current break state to localStorage so the browser extension's
// content script (same origin) can read it and dim the badge while on break.
function writeBreakStateForExtension(onBreak: boolean) {
  try {
    localStorage.setItem("clockwork:on_break", onBreak ? "1" : "0");
  } catch { /* ignore quota / privacy mode */ }
}


function relTime(iso?: string | null) {
  if (!iso) return "";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function startOfTodayISO() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString();
}

export function VaHome() {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const userId = user!.id;
  const [clockingOut, setClockingOut] = useState(false);

  // Workspace config — idle nudge threshold + max break warning.
  const configQ = useQuery({
    queryKey: ["app-config-va"],
    queryFn: async () => {
      const { data } = await supabase
        .from("app_config")
        .select("idle_threshold_sec, max_break_sec, session_timeout_minutes")
        .eq("id", 1)
        .maybeSingle();
      return data;
    },
    staleTime: 5 * 60_000,
  });
  const idleThresholdSec = configQ.data?.idle_threshold_sec ?? DEFAULT_IDLE_NUDGE_SECONDS;
  const maxBreakSec = configQ.data?.max_break_sec ?? DEFAULT_MAX_BREAK_SECONDS;
  const sessionTimeoutSec = (((configQ.data as any)?.session_timeout_minutes ?? 10) as number) * 60;

  // Active session
  const activeQ = useQuery({
    queryKey: ["active-session", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_sessions")
        .select("*")
        .eq("va_id", userId)
        .eq("status", "active")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    refetchInterval: 15_000,
  });

  // Today's sessions
  const todayQ = useQuery({
    queryKey: ["today-sessions", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("work_sessions").select("*")
        .eq("va_id", userId).gte("started_at", startOfTodayISO())
        .order("started_at", { ascending: false });
      return data ?? [];
    },
    refetchInterval: 30_000,
  });

  // Today's activity
  const actsQ = useQuery({
    queryKey: ["today-activity", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("activity_events").select("app,url,title,duration_sec,started_at")
        .eq("va_id", userId).gte("started_at", startOfTodayISO())
        .order("started_at", { ascending: false }).limit(200);
      return data ?? [];
    },
    refetchInterval: 20_000,
  });

  // Latest screenshot for the active session
  const latestShotQ = useQuery({
    queryKey: ["latest-shot", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("screenshots").select("storage_path,captured_at")
        .eq("va_id", userId)
        .order("captured_at", { ascending: false })
        .limit(1).maybeSingle();
      if (!data) return null;
      const { data: signed } = await supabase
        .storage.from("va-screenshots")
        .createSignedUrl(data.storage_path, 60);
      return { url: signed?.signedUrl ?? null, captured_at: data.captured_at };
    },
    refetchInterval: 30_000,
  });

  // Clicks captured today
  const clicksTodayQ = useQuery({
    queryKey: ["clicks-today", userId],
    queryFn: async () => {
      const { count } = await supabase
        .from("workflow_steps")
        .select("id", { count: "exact", head: true })
        .eq("va_id", userId)
        .gte("created_at", startOfTodayISO());
      return count ?? 0;
    },
    refetchInterval: 30_000,
  });

  // Today's idle segments
  const idleQ = useQuery({
    queryKey: ["today-idle", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("idle_segments").select("started_at,duration_sec")
        .eq("va_id", userId).gte("started_at", startOfTodayISO())
        .order("started_at", { ascending: false }).limit(50);
      return data ?? [];
    },
  });

  // Clients (for showing client names on sessions)
  const clientsQ = useQuery({
    queryKey: ["clients-lookup"],
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("id,name,archived").order("name");
      return data ?? [];
    },
    staleTime: 60_000,
  });
  const clientMap = useMemo(
    () => new Map((clientsQ.data ?? []).map((c) => [c.id, c.name])),
    [clientsQ.data],
  );

  // Projects (filtered by client in the picker; admin manages the list).
  const projectsQ = useQuery({
    queryKey: ["projects-lookup"],
    queryFn: async () => {
      const { data } = await supabase
        .from("projects")
        .select("id,name,client_id,archived")
        .eq("archived", false)
        .order("name");
      return data ?? [];
    },
    staleTime: 60_000,
  });

  // Auto-SOPs from your work
  const sopsQ = useQuery({
    queryKey: ["my-sops", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("sops").select("id,title,description,status,created_at")
        .eq("generated_for_va", userId)
        .order("created_at", { ascending: false }).limit(10);
      return data ?? [];
    },
  });

  // Breaks today + open break
  const breaksTodayQ = useQuery({
    queryKey: ["breaks-today", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("break_segments")
        .select("id,started_at,ended_at,duration_sec,reason")
        .eq("va_id", userId)
        .gte("started_at", startOfTodayISO())
        .order("started_at", { ascending: false });
      return data ?? [];
    },
    refetchInterval: 20_000,
  });
  const openBreak = useMemo(
    () => (breaksTodayQ.data ?? []).find(b => !b.ended_at) ?? null,
    [breaksTodayQ.data],
  );

  // Last 7 days of sessions — drives the hero-tile sparklines.
  const last7DaysQ = useQuery({
    queryKey: ["last-7-days", userId],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 6);
      since.setHours(0, 0, 0, 0);
      const { data } = await supabase
        .from("work_sessions")
        .select("started_at,active_sec,idle_sec")
        .eq("va_id", userId)
        .gte("started_at", since.toISOString());
      const days: { active: number; idle: number; total: number }[] = Array.from(
        { length: 7 },
        () => ({ active: 0, idle: 0, total: 0 }),
      );
      const start = since.getTime();
      const dayMs = 86_400_000;
      for (const s of data ?? []) {
        const idx = Math.min(6, Math.max(0, Math.floor((new Date(s.started_at).getTime() - start) / dayMs)));
        days[idx].active += s.active_sec ?? 0;
        days[idx].idle += s.idle_sec ?? 0;
        days[idx].total += (s.active_sec ?? 0) + (s.idle_sec ?? 0);
      }
      return days;
    },
    staleTime: 5 * 60_000,
  });

  // Last 30 days — drives the streak chip and "you usually start around…" hint.
  const last30Q = useQuery({
    queryKey: ["last-30-days", userId],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 29);
      since.setHours(0, 0, 0, 0);
      const { data } = await supabase
        .from("work_sessions")
        .select("started_at,active_sec")
        .eq("va_id", userId)
        .gte("started_at", since.toISOString())
        .order("started_at", { ascending: true });
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });

  // Pending web→extension commands. Drives the "syncing extension…" badge
  // so the VA knows the extension hasn't applied their click yet (~30s window).
  const pendingCmdsQ = useQuery({
    queryKey: ["session-commands-pending", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("session_commands")
        .select("id,command,created_at,expires_at")
        .eq("va_id", userId)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false });
      return data ?? [];
    },
    refetchInterval: 5_000,
  });
  const pendingCmd = pendingCmdsQ.data?.[0] ?? null;

  // Realtime: instantly refresh when our own tracking data changes.
  useRealtimeInvalidate(`va-home:${userId}`, [
    { table: "work_sessions", filter: `va_id=eq.${userId}`, invalidate: [
      ["active-session", userId], ["today-sessions", userId], ["last-7-days", userId],
    ]},
    { table: "activity_events", filter: `va_id=eq.${userId}`, invalidate: [["today-activity", userId]] },
    { table: "screenshots", filter: `va_id=eq.${userId}`, invalidate: [["latest-shot", userId]] },
    { table: "workflow_steps", filter: `va_id=eq.${userId}`, invalidate: [["clicks-today", userId]] },
    { table: "break_segments", filter: `va_id=eq.${userId}`, invalidate: [["breaks-today", userId]] },
    { table: "idle_segments", filter: `va_id=eq.${userId}`, invalidate: [["today-idle", userId]] },
    { table: "session_commands", filter: `va_id=eq.${userId}`, invalidate: [["session-commands-pending", userId]] },
  ]);

  const active = activeQ.data;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active && !openBreak) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active, openBreak]);

  const liveSec = active ? Math.max(0, Math.floor((now - new Date(active.started_at).getTime()) / 1000)) : 0;
  const breakLiveSec = openBreak ? Math.max(0, Math.floor((now - new Date(openBreak.started_at).getTime()) / 1000)) : 0;

  const latestActivity = useMemo(() => (actsQ.data ?? [])[0] ?? null, [actsQ.data]);
  const idleForSec = latestActivity ? Math.max(0, Math.floor((now - new Date(latestActivity.started_at).getTime()) / 1000)) : 0;

  // Idle nudge: show when clocked in, no open break, and inactive for >= threshold.
  // `snoozeUntil` defers the nudge (5 or 15 min) after the user dismisses it.
  const [snoozeUntil, setSnoozeUntil] = useState(0);
  const [nudgeOpen, setNudgeOpen] = useState(false);
  // Pre-nudge: subtle inline hint once the VA is quiet for ~half the threshold.
  const preNudgeAt = Math.max(60, Math.floor(idleThresholdSec / 2));
  // Treat the session as stale if no activity within the session-timeout window —
  // e.g. the VA closed the browser or the extension stopped. Suppress idle prompts
  // in that case; the server cron will auto-close the session shortly.
  const sessionStale = !!active && idleForSec > sessionTimeoutSec;
  const showQuietHint = !!active && !openBreak && !sessionStale && idleForSec >= preNudgeAt && idleForSec < idleThresholdSec;
  useEffect(() => {
    if (!active || openBreak || sessionStale) { setNudgeOpen(false); return; }
    const snoozed = Date.now() < snoozeUntil;
    setNudgeOpen(idleForSec >= idleThresholdSec && !snoozed);
  }, [idleForSec, active, openBreak, snoozeUntil, idleThresholdSec, sessionStale]);

  // Auto-pause: once the nudge has been on screen for 60s with no response,
  // start a "stepped away" break so the time isn't billed as active.
  const [nudgeOpenedAt, setNudgeOpenedAt] = useState<number | null>(null);
  useEffect(() => {
    if (nudgeOpen && nudgeOpenedAt === null) setNudgeOpenedAt(Date.now());
    if (!nudgeOpen) setNudgeOpenedAt(null);
  }, [nudgeOpen, nudgeOpenedAt]);
  const autoPauseInSec = nudgeOpenedAt ? Math.max(0, 60 - Math.floor((now - nudgeOpenedAt) / 1000)) : 60;
  useEffect(() => {
    if (!nudgeOpen || !nudgeOpenedAt) return;
    if (autoPauseInSec > 0) return;
    // Trigger once
    setNudgeOpen(false);
    setNudgeOpenedAt(null);
    void startBreak("stepped away");
    toast.message("Auto-paused", {
      description: "We started a 'stepped away' break since there was no response.",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPauseInSec, nudgeOpen, nudgeOpenedAt]);

  // Mirror break state for the extension badge.
  useEffect(() => {
    writeBreakStateForExtension(!!openBreak);
  }, [openBreak]);

  // Max-break warning toast (fires once per open break).
  const [warnedBreakId, setWarnedBreakId] = useState<string | null>(null);
  useEffect(() => {
    if (!openBreak) return;
    if (warnedBreakId === openBreak.id) return;
    if (breakLiveSec >= maxBreakSec) {
      toast.warning(`You've been on break for ${Math.round(breakLiveSec / 60)} minutes`, {
        description: "Tap 'End break' when you're back so your time stays accurate.",
      });
      setWarnedBreakId(openBreak.id);
    }
  }, [openBreak, breakLiveSec, maxBreakSec, warnedBreakId]);

  // Web → extension command channel. The web app is authoritative on the
  // canonical DB rows (break_segments / session_end) so the timesheet stays
  // accurate even if the extension is closed. This hint tells the extension
  // to mirror the change locally (alarms, paused flag, rec) within ~30s.
  async function issueExtensionCommand(
    command: "clock_out" | "break_start" | "break_end",
    sessionId: string | null,
  ) {
    try {
      await (supabase as any).rpc("issue_self_session_command", {
        p_session_id: sessionId,
        p_command: command,
      });
    } catch { /* non-fatal: web write already persisted */ }
  }

  async function startBreak(reason: string) {
    if (!active || openBreak) return;
    const { error } = await supabase.from("break_segments").insert({
      va_id: userId,
      session_id: active.id,
      reason,
    });
    if (error) return toast.error(error.message);
    setNudgeOpen(false);
    toast.success("Break started");
    qc.invalidateQueries({ queryKey: ["breaks-today", userId] });
    issueExtensionCommand("break_start", active.id);
  }
  // Phase 3: segment-aware tag switch. The switch_session_client RPC closes
  // the current work segment and opens a new one with the new client/project
  // (records the time). We also mirror client_id / project_id onto
  // work_sessions so the current-tag badge keeps rendering everywhere it does
  // today without a join.
  async function setSessionTags(clientId: string | null, projectId: string | null) {
    if (!active) return;
    const { error: rpcErr } = await supabase.rpc("switch_session_client", {
      p_session_id: active.id,
      // RPC accepts nullable uuid; generated types don't model that.
      p_client_id: clientId as unknown as string,
      p_project_id: projectId as unknown as string,
    });
    if (rpcErr) return toast.error(rpcErr.message);
    const { error } = await supabase
      .from("work_sessions")
      .update({ client_id: clientId, project_id: projectId } as never)
      .eq("id", active.id);
    if (error) return toast.error(error.message);
    const clientLabel = clientId ? (clientMap.get(clientId) ?? "brand") : null;
    toast.success(clientLabel ? `Tagged with ${clientLabel}` : "Brand cleared");
    qc.invalidateQueries({ queryKey: ["active-session", userId] });
    qc.invalidateQueries({ queryKey: ["today-sessions", userId] });
  }
  async function setSessionClient(value: string) {
    // Changing client clears the project (project belongs to a single client).
    const next = value === "__none__" ? null : value;
    await setSessionTags(next, null);
  }
  async function setSessionProject(value: string) {
    if (!active) return;
    const next = value === "__none__" ? null : value;
    await setSessionTags(active.client_id ?? null, next);
  }

  async function endBreak() {
    if (!openBreak) return;
    const startedAt = new Date(openBreak.started_at).getTime();
    const duration = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    const sid = active?.id ?? null;
    const { error } = await supabase
      .from("break_segments")
      .update({ ended_at: new Date().toISOString(), duration_sec: duration })
      .eq("id", openBreak.id);
    if (error) return toast.error(error.message);
    toast.success("Welcome back");
    qc.invalidateQueries({ queryKey: ["breaks-today", userId] });
    issueExtensionCommand("break_end", sid);
  }
  function imBack(snoozeMin: number = 5) {
    setSnoozeUntil(Date.now() + snoozeMin * 60 * 1000);
    setNudgeOpen(false);
    setNudgeOpenedAt(null);
  }


  // "Active" today = sum of work-segment active_sec for the VA, Eastern day.
  // Same definition the admin Live Overview and Reporting tab use, so the
  // VA sees the same number an admin sees. Excludes idle and break.
  const todaySlicesQ = useQuery({
    queryKey: ["va-home-slices-today", userId],
    queryFn: () => fetchSlices(todayLocal(), todayLocal(), userId),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  // Live sums for the active session — work_sessions.active_sec/idle_sec are
  // only written on close, so for the open session we sum the underlying tables
  // (matches how report_segment_day_slices computes open-segment active).
  const liveActiveQ = useQuery({
    queryKey: ["live-session-active-sec", active?.id],
    enabled: !!active?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("activity_events").select("duration_sec")
        .eq("session_id", active!.id);
      return (data ?? []).reduce((n, r) => n + (r.duration_sec ?? 0), 0);
    },
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  const liveIdleQ = useQuery({
    queryKey: ["live-session-idle-sec", active?.id],
    enabled: !!active?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("idle_segments").select("duration_sec")
        .eq("session_id", active!.id);
      return (data ?? []).reduce((n, r) => n + (r.duration_sec ?? 0), 0);
    },
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  const todayTotals = useMemo(() => {
    const liveActive = active?.id ? (liveActiveQ.data ?? 0) : 0;
    const liveIdle   = active?.id ? (liveIdleQ.data   ?? 0) : 0;
    let closedActive = 0;
    let closedIdle = 0;
    for (const s of todayQ.data ?? []) {
      if (s.id === active?.id) continue;
      closedActive += s.active_sec ?? 0;
      closedIdle   += s.idle_sec   ?? 0;
    }
    const activeSec = liveActive + closedActive;
    const idleSec   = liveIdle   + closedIdle;
    return { activeSec, idleSec, totalSec: activeSec + idleSec };
  }, [liveActiveQ.data, liveIdleQ.data, todayQ.data, active?.id]);



  const byApp = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of actsQ.data ?? []) {
      const key = a.app || hostOf(a.url) || "Other";
      map.set(key, (map.get(key) ?? 0) + (a.duration_sec ?? 0));
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [actsQ.data]);

  const totalApp = byApp.reduce((a, [, v]) => a + v, 0) || 1;

  async function clockOut() {
    if (!active) return;
    setClockingOut(true);
    const sid = active.id;
    try {
      const { error } = await supabase.functions.invoke("track-ingest", {
        body: { kind: "session_end", session_id: sid },
      });
      if (error) throw error;
      toast.success("Clocked out.");
      // Tell the extension to drop its local recording state too.
      issueExtensionCommand("clock_out", sid);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["active-session", userId] }),
        qc.invalidateQueries({ queryKey: ["today-sessions", userId] }),
        qc.invalidateQueries({ queryKey: ["today-activity", userId] }),
        qc.invalidateQueries({ queryKey: ["today-idle", userId] }),
      ]);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not clock out.");
    } finally {
      setClockingOut(false);
    }
  }

  // --- Streak: consecutive days with any active time, ending today (or yesterday if today hasn't started). ---
  const streakDays = useMemo(() => {
    const rows = last30Q.data ?? [];
    const daysWithWork = new Set<string>();
    for (const r of rows) {
      if ((r.active_sec ?? 0) > 0) daysWithWork.add(r.started_at.slice(0, 10));
    }
    if (active) daysWithWork.add(new Date().toISOString().slice(0, 10));
    if (!daysWithWork.size) return 0;
    let streak = 0;
    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    const todayKey = cursor.toISOString().slice(0, 10);
    if (!daysWithWork.has(todayKey)) cursor.setDate(cursor.getDate() - 1);
    for (let i = 0; i < 30; i++) {
      const k = cursor.toISOString().slice(0, 10);
      if (daysWithWork.has(k)) { streak++; cursor.setDate(cursor.getDate() - 1); }
      else break;
    }
    return streak;
  }, [last30Q.data, active]);

  // --- Typical start: median minutes-of-day across first-session-per-day, last 30d. ---
  const typicalStartMin = useMemo(() => {
    const rows = last30Q.data ?? [];
    if (rows.length < 3) return null;
    const firstByDay = new Map<string, number>();
    for (const r of rows) {
      const d = new Date(r.started_at);
      const key = r.started_at.slice(0, 10);
      const mins = d.getHours() * 60 + d.getMinutes();
      if (!firstByDay.has(key) || mins < (firstByDay.get(key) as number)) firstByDay.set(key, mins);
    }
    const vals = Array.from(firstByDay.values()).sort((a, b) => a - b);
    if (vals.length < 3) return null;
    return vals[Math.floor(vals.length / 2)];
  }, [last30Q.data]);

  const draftSopCount = useMemo(
    () => (sopsQ.data ?? []).filter((s: any) => s.status === "draft").length,
    [sopsQ.data],
  );

  // --- One calm "next session" hint, priority-ordered, dismissible per day. ---
  const hintDismissKey = `clockwork:hint-dismissed:${userId}:${new Date().toISOString().slice(0, 10)}`;
  const [hintDismissed, setHintDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(hintDismissKey) === "1";
  });
  function dismissHint() {
    try { window.localStorage.setItem(hintDismissKey, "1"); } catch {}
    setHintDismissed(true);
  }

  const hint = useMemo((): { icon: "break" | "tag" | "clockout" | "sop" | "start"; text: string; to?: string } | null => {
    if (hintDismissed) return null;
    const hourNow = new Date().getHours();
    if (active && !openBreak) {
      if (liveSec >= 90 * 60) {
        return { icon: "break", text: "You've been heads-down for 90+ min — a short break keeps the timer honest." };
      }
      if (!active.client_id && (clientsQ.data ?? []).some((c: any) => !c.archived)) {
        return { icon: "tag", text: "Tag today's session with a brand so your hours roll up." };
      }
      if (hourNow >= 18) {
        return { icon: "clockout", text: "Wrapping up? Clock out to close today's totals." };
      }
      return null;
    }
    if (draftSopCount > 0) {
      return {
        icon: "sop",
        text: `${draftSopCount} new playbook${draftSopCount > 1 ? "s" : ""} from your recent work — a couple minutes to review.`,
        to: "/sops",
      };
    }
    if (typicalStartMin !== null) {
      const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
      if (Math.abs(nowMin - typicalStartMin) <= 60) {
        const hh = Math.floor(typicalStartMin / 60);
        const mm = typicalStartMin % 60;
        const label = new Date(2000, 0, 1, hh, mm).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        return { icon: "start", text: `You usually start around ${label} — open the extension to clock in.` };
      }
    }
    return null;
  }, [hintDismissed, active, openBreak, liveSec, clientsQ.data, draftSopCount, typicalStartMin]);

  return (
    <div className="space-y-6">
      <OnboardingChecklist userId={userId} />
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.2em] text-gold/90 font-medium mb-1.5 flex items-center gap-2">
            <span>Today</span>
            {streakDays >= 2 && (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-[10px] tracking-normal text-gold normal-case"
                title={`Worked ${streakDays} day${streakDays > 1 ? "s" : ""} in a row`}
              >
                <Flame className="size-3" />
                {streakDays}-day streak
              </span>
            )}
          </div>
          <h1 className="font-display text-4xl md:text-5xl leading-[1.05] text-gradient-premium">Hi {profile?.display_name?.split(" ")[0] ?? "there"}</h1>
          {hint ? (
            <div className="mt-2 flex items-start gap-2 max-w-lg">
              <span className="mt-[3px] grid place-items-center size-5 rounded-full bg-gold/15 ring-1 ring-gold/30 text-gold shrink-0">
                {hint.icon === "break" ? <Coffee className="size-3" /> :
                 hint.icon === "tag" ? <Briefcase className="size-3" /> :
                 hint.icon === "clockout" ? <Square className="size-3" /> :
                 hint.icon === "sop" ? <BookOpen className="size-3" /> :
                 <Clock className="size-3" />}
              </span>
              <p className="text-sm text-foreground/85 leading-snug">
                {hint.to ? (
                  <Link to={hint.to} className="hover:text-gold transition-colors">{hint.text}</Link>
                ) : hint.text}
                {" "}
                <button
                  onClick={dismissHint}
                  className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline align-middle ml-1"
                  aria-label="Dismiss hint"
                >dismiss</button>
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm mt-2 max-w-lg">Here's your day so far. You always see exactly what your admin sees.</p>
          )}
        </div>
        {active ? (
          <div className="flex items-center gap-3 flex-wrap">
            {openBreak ? (
              <div className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400">
                <Coffee className="size-4" /> On break
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-sm text-success">
                <span className="relative flex size-2.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-75 animate-ping" />
                  <span className="relative inline-flex rounded-full size-2.5 bg-success" />
                </span>
                Clocked in
              </div>
            )}
            {pendingCmd && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-muted-foreground/30 bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground"
                title="Waiting for the extension to apply your action (usually within 30 seconds)"
              >
                <span className="size-1.5 rounded-full bg-muted-foreground/70 animate-pulse" />
                Syncing extension…
              </span>
            )}
            {showQuietHint && (
              <button
                onClick={() => setNudgeOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-[11px] text-warning hover:bg-warning/15 transition-colors"
                title="Click to log a break or confirm you're back"
              >
                <span className="size-1.5 rounded-full bg-warning animate-pulse" />
                Quiet for {Math.floor(idleForSec / 60)} min
              </button>
            )}
            {openBreak ? (
              <Button variant="default" size="sm" onClick={endBreak}>
                <Play className="size-4 mr-1.5" />End break ({fmtClock(breakLiveSec)})
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => startBreak("manual")}>
                <Coffee className="size-4 mr-1.5" />Start break
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={clockOut} disabled={clockingOut}>
              <Square className="size-4 mr-1.5" />{clockingOut ? "Clocking out…" : "Clock out"}
            </Button>
          </div>
        ) : null}
      </div>

      {active ? (
        <>
          {openBreak && (
            <Card className="border-amber-500/40 bg-amber-500/5">
              <CardContent className="py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Coffee className="size-5 text-amber-600 dark:text-amber-400" />
                  <div>
                    <div className="font-medium text-sm">On break · {fmtClock(breakLiveSec)}</div>
                    <div className="text-xs text-muted-foreground">
                      Started {new Date(openBreak.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      {openBreak.reason && openBreak.reason !== "manual" ? ` · ${openBreak.reason}` : ""}
                    </div>
                  </div>
                </div>
                <Button size="sm" onClick={endBreak}><Play className="size-4 mr-1.5" />End break</Button>
              </CardContent>
            </Card>
          )}
          {/* Live status */}
          <Card className="border-success/30 bg-success/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Current session</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">

              <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
                <div>
                  <div className="font-display text-6xl md:text-7xl tabular-nums leading-none tracking-tight">
                    {fmtClock(liveSec).split("").map((ch, i) =>
                      ch === ":" ? (
                        <span key={i} className="text-gold/70 mx-0.5">:</span>
                      ) : (
                        <span key={i}>{ch}</span>
                      ),
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Started at {new Date(active.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                  <div className="mt-3">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1 flex items-center gap-1">
                      <Briefcase className="size-3" /> Working on
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        value={active.client_id ?? "__none__"}
                        onValueChange={setSessionClient}
                      >
                        <SelectTrigger className="h-8 w-[200px] text-sm">
                          <SelectValue placeholder="Tag a brand…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">No brand</SelectItem>
                          {(clientsQ.data ?? []).filter((c: any) => !c.archived).map((c: any) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={(active as any).project_id ?? "__none__"}
                        onValueChange={setSessionProject}
                        disabled={!active.client_id}
                      >
                        <SelectTrigger className="h-8 w-[200px] text-sm">
                          <SelectValue placeholder={active.client_id ? "Pick a project…" : "Pick a client first"} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">No project</SelectItem>
                          {(projectsQ.data ?? [])
                            .filter((p: any) => p.client_id === active.client_id)
                            .map((p: any) => (
                              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                </div>
                {latestActivity && (
                  <div className="min-w-0 flex-1">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-1">Currently</div>
                    <div className="flex items-center gap-2 text-sm">
                      <Globe className="size-4 shrink-0 text-muted-foreground" />
                      <span className="font-medium truncate">{latestActivity.app || hostOf(latestActivity.url) || "Activity"}</span>
                    </div>
                    {latestActivity.title && (
                      <div className="text-xs text-muted-foreground truncate mt-0.5">{latestActivity.title}</div>
                    )}
                    <div className="text-xs text-muted-foreground mt-1">Updated {relTime(latestActivity.started_at)}</div>
                  </div>
                )}
              </div>

              <SegmentTimeline sessionId={active.id} clientMap={clientMap} />

              {/* What's being tracked right now */}
              <div className="grid gap-3 sm:grid-cols-[160px_1fr] pt-3 border-t border-success/20">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-1.5 flex items-center gap-1.5">
                    <Camera className="size-3" /> Last screenshot
                  </div>
                  {latestShotQ.data?.url ? (
                    <a href={latestShotQ.data.url} target="_blank" rel="noreferrer" className="block group">
                      <img
                        src={latestShotQ.data.url}
                        alt="Latest captured screenshot"
                        className="w-full aspect-video object-cover rounded-md border border-border group-hover:opacity-90"
                      />
                      <div className="text-[11px] text-muted-foreground mt-1">Captured {relTime(latestShotQ.data.captured_at)}</div>
                    </a>
                  ) : (
                    <div className="w-full aspect-video rounded-md border border-dashed border-border grid place-items-center text-[11px] text-muted-foreground">
                      None yet
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">What's being tracked right now</div>
                  <ul className="text-sm space-y-1.5">
                    <li className="flex items-center gap-2"><Globe className="size-3.5 text-muted-foreground" /> Active app / website you're using</li>
                    <li className="flex items-center gap-2"><MousePointerClick className="size-3.5 text-muted-foreground" /> Click trail · <span className="tabular-nums">{clicksTodayQ.data ?? 0}</span> captured today</li>
                    <li className="flex items-center gap-2"><Camera className="size-3.5 text-muted-foreground" /> Periodic screenshots of your work screen</li>
                    <li className="flex items-center gap-2"><Clock className="size-3.5 text-muted-foreground" /> Idle time when you step away</li>
                  </ul>
                  <p className="text-xs text-muted-foreground pt-1">
                    Nothing else is captured. The extension keeps the session live — use Clock out here only as a safety fallback.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <section className="auth-stage relative overflow-hidden rounded-2xl p-6 md:p-10 text-white">
          <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
          <div className="relative z-10 max-w-3xl mx-auto text-center space-y-6">
            <div className="mx-auto size-14 rounded-full bg-white/[0.06] ring-1 ring-white/15 grid place-items-center backdrop-blur-sm">
              <Chrome className="size-7 text-gold" />
            </div>
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-[0.22em] text-gold/90 font-medium">Off the clock</div>
              <h2 className="font-display text-3xl md:text-4xl xl:text-5xl leading-[1.04] tracking-tight">
                Ready when <span className="text-gold">you are.</span>
              </h2>
              <p className="text-white/65 text-sm max-w-md mx-auto">
                Run through this quick checklist, then open the ClockWork extension and press Clock In.
              </p>
            </div>

            <ol className="max-w-md mx-auto space-y-3 text-sm text-left">
              <li className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <CircleEmpty className="size-5 text-white/50 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-medium text-white">Install the ClockWork extension</div>
                  <Link to="/install" className="text-xs text-gold hover:underline">Install or update →</Link>
                </div>
              </li>
              <li className="flex items-start gap-3 rounded-lg border border-success/30 bg-success/5 p-3">
                <CheckCircle2 className="size-5 text-success shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-medium text-white">Signed in as {profile?.display_name ?? "you"}</div>
                  <div className="text-xs text-white/60">The extension uses this account.</div>
                </div>
              </li>
              <li className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <ShieldCheck className="size-5 text-white/50 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-medium text-white">Allow screen capture when prompted</div>
                  <div className="text-xs text-white/60">Pick the screen you'll be working on. You can stop sharing any time from the browser bar.</div>
                </div>
              </li>
              <li className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <CircleEmpty className="size-5 text-white/50 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-medium text-white">Open the extension popup and click Clock In</div>
                  <div className="text-xs text-white/60">This page will update as soon as your session starts.</div>
                </div>
              </li>
            </ol>

            <div className="flex flex-wrap justify-center gap-2 pt-1">
              <Button asChild size="sm" className="press">
                <Link to="/install"><Chrome className="size-4 mr-1.5" />Install extension</Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="bg-white/5 border-white/15 text-white hover:bg-white/10 hover:text-white">
                <Link to="/consent"><Eye className="size-4 mr-1.5" />What gets tracked?</Link>
              </Button>
            </div>
          </div>
        </section>



      )}

      {/* Today totals — editorial hero row with sparklines */}
      <div className="stagger-children grid gap-4 grid-cols-1 md:grid-cols-3">
        <MetricTile
          label="Today total"
          accent
          icon={<Clock className="size-3" />}
          value={<CountUp value={todayTotals.totalSec / 3600} format={fmtHoursHuman} />}
          caption="Across all sessions"
          trend={(last7DaysQ.data ?? []).map(d => d.total / 3600)}
        />
        <MetricTile
          label="Active"
          icon={<TrendingUp className="size-3" />}
          value={<CountUp value={todayTotals.activeSec / 3600} format={fmtHoursHuman} />}
          caption="Hands-on time today"
          trend={(last7DaysQ.data ?? []).map(d => d.active / 3600)}
        />
        <MetricTile
          label="Idle"
          icon={<Coffee className="size-3" />}
          value={<CountUp value={todayTotals.idleSec / 3600} format={fmtHoursHuman} />}
          caption={`${idleQ.data?.length ?? 0} idle stretch${(idleQ.data?.length ?? 0) === 1 ? "" : "es"}`}
          trend={(last7DaysQ.data ?? []).map(d => d.idle / 3600)}
        />
      </div>

      {/* By app */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Clock className="size-4" />Time by app today</CardTitle></CardHeader>
        <CardContent>
          {byApp.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity recorded yet today.</p>
          ) : (
            <div className="space-y-2.5">
              {byApp.map(([app, sec], i) => {
                const pct = totalApp > 0 ? Math.max(2, (sec / totalApp) * 100) : 0;
                return (
                  <div key={app} className="group">
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="truncate font-medium">{app}</span>
                      <span className="text-muted-foreground tabular-nums text-xs">{fmtDuration(sec)}</span>
                    </div>
                    <div className="mt-1.5 h-[3px] rounded-full bg-muted/60 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-[width] duration-700 ease-out ${i === 0 ? "bg-[var(--color-gold)]" : "bg-primary/85 group-hover:bg-primary"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Today's sessions</CardTitle></CardHeader>
          <CardContent>
            {todayQ.data?.length ? (
              <div className="divide-y divide-border">
                {todayQ.data.map(s => (
                  <div key={s.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <Circle className={`size-2.5 shrink-0 ${s.status === "active" ? "fill-success text-success" : "fill-muted-foreground/40 text-muted-foreground/40"}`} />
                      <span className="text-base font-medium tabular-nums">
                        {new Date(s.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        <span className="text-muted-foreground font-normal"> → </span>
                        {s.ended_at
                          ? new Date(s.ended_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                          : <span className="text-success">live</span>}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                      {fmtDuration(Math.max(0, Math.floor(
                        ((s.ended_at ? new Date(s.ended_at).getTime() : now) - new Date(s.started_at).getTime()) / 1000
                      )))}
                    </span>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">No sessions yet.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><BookOpen className="size-4" />SOPs from your work</CardTitle></CardHeader>
          <CardContent>
            {sopsQ.data?.length ? (
              <div className="space-y-3">
                {sopsQ.data.map(s => (
                  <div key={s.id} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{s.title}</div>
                      <div className="text-xs text-muted-foreground line-clamp-2">{s.description}</div>
                    </div>
                    <Badge variant={s.status === "reviewed" ? "default" : "secondary"}>{s.status}</Badge>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">After you repeat a workflow ~10 times, ClockWork will draft an SOP for it here.</p>}
          </CardContent>
        </Card>
      </div>

      <LeaderboardCard userId={userId} />


      {/* Today's breaks */}
      {(breaksTodayQ.data?.length ?? 0) > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Coffee className="size-4" />Today's breaks</CardTitle></CardHeader>
          <CardContent>
            <div className="divide-y divide-border">
              {breaksTodayQ.data!.map(b => (
                <div key={b.id} className="py-2 flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span>{new Date(b.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    <span className="text-muted-foreground">→ {b.ended_at ? new Date(b.ended_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : <Badge variant="secondary" className="text-xs">ongoing</Badge>}</span>
                    {b.reason && b.reason !== "manual" && <Badge variant="outline" className="text-xs">{b.reason}</Badge>}
                  </div>
                  <span className="text-muted-foreground tabular-nums">
                    {b.ended_at ? fmtDuration(b.duration_sec) : fmtDuration(breakLiveSec)}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Breaks logged here help your admin tell intentional pauses from accidental idle time.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Idle nudge */}
      <Dialog open={nudgeOpen} onOpenChange={(v) => { if (!v) imBack(5); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Still there?</DialogTitle>
            <DialogDescription>
              No keyboard or mouse for about {Math.floor(idleForSec / 60)} min {idleForSec % 60}s.
              Pick what's happening so your time stays accurate — we'll auto-pause in{" "}
              <span className="tabular-nums font-medium text-foreground">{autoPauseInSec}s</span> if you don't.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-1">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-medium mb-2">
              I'm on a…
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Button variant="outline" size="sm" onClick={() => startBreak("lunch")}>Lunch</Button>
              <Button variant="outline" size="sm" onClick={() => startBreak("short break")}>Short break</Button>
              <Button variant="outline" size="sm" onClick={() => startBreak("meeting")}>Meeting</Button>
              <Button variant="outline" size="sm" onClick={() => startBreak("phone call")}>Phone call</Button>
              <Button variant="outline" size="sm" onClick={() => startBreak("stepped away")}>Stepped away</Button>
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2 sm:justify-between">
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => imBack(5)}>Snooze 5 min</Button>
              <Button variant="ghost" size="sm" onClick={() => imBack(15)}>Snooze 15 min</Button>
            </div>
            <Button onClick={() => imBack(5)}>I'm back</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LeaderboardCard({ userId }: { userId: string }) {
  const fetchBoard = useServerFn(getWeeklyLeaderboard);
  const q = useQuery({
    queryKey: ["va-leaderboard", userId],
    queryFn: () => fetchBoard(),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
  const board = q.data;

  // Streak-at-risk nudge: when the user has an active streak (>=2 days) but
  // hasn't clocked any active time today yet, surface a once-per-day toast.
  useEffect(() => {
    if (!board?.me) return;
    const { streak, hasToday } = board.me;
    if (!streak || streak < 2 || hasToday) return;
    const today = new Date().toISOString().slice(0, 10);
    const key = `streak-nudge:${userId}:${today}`;
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(key)) return;
    window.localStorage.setItem(key, "1");
    toast(`Keep your ${streak}-day streak alive`, {
      description: "Start a session today so it doesn't reset tomorrow.",
      icon: "🔥",
      duration: 7000,
    });
  }, [board?.me, userId]);

  if (!board || board.teamSize <= 1) return null;
  const max = Math.max(1, ...(board.top.map((r) => r.weekSec)));
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2"><Trophy className="size-4 text-gold" />This week on the team</CardTitle>
        {board.me && (
          <div className="flex items-center gap-3 text-xs">
            <span className="text-muted-foreground">Your rank</span>
            <span className="font-display tabular-nums text-lg leading-none">#{board.me.rank}<span className="text-muted-foreground text-xs">/{board.teamSize}</span></span>
            {board.me.streak > 0 && (
              <Badge variant="outline" className="gap-1"><Flame className="size-3 text-amber-500" />{board.me.streak}-day streak</Badge>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {board.lastWinner && (
          <div className="mb-3 -mt-1 flex items-center gap-2 rounded-md border border-gold/30 bg-gold/5 px-2.5 py-1.5 text-xs">
            <Trophy className="size-3.5 text-gold shrink-0" />
            <span className="text-muted-foreground">Last week's champion:</span>
            <span className={`font-medium truncate ${board.lastWinner.isMe ? "text-gold" : "text-foreground"}`}>
              {board.lastWinner.isMe ? "You 🎉" : board.lastWinner.name}
            </span>
            <span className="ml-auto tabular-nums text-muted-foreground">
              {fmtSecHuman(board.lastWinner.weekSec)}
            </span>
          </div>
        )}
        {board.top.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tracked hours on the team yet this week.</p>
        ) : (
          <ol className="space-y-2.5">
            {board.top.map((r) => {
              const pct = Math.max(2, (r.weekSec / max) * 100);
              return (
                <li key={r.userId} className="group">
                  <div className="flex items-baseline justify-between text-sm gap-3">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="inline-grid place-items-center size-5 rounded-full bg-muted text-[10px] font-medium tabular-nums shrink-0">{r.rank}</span>
                      <span className={`truncate ${r.isMe ? "font-medium text-gold" : ""}`}>{r.name}{r.isMe ? " (you)" : ""}</span>
                      {r.streak >= 3 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-500"><Flame className="size-3" />{r.streak}</span>
                      )}
                    </span>
                    <span className="text-muted-foreground tabular-nums text-xs">{fmtSecHuman(r.weekSec)}</span>
                  </div>
                  <div className="mt-1.5 h-[3px] rounded-full bg-muted/60 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-[width] duration-700 ease-out ${r.isMe ? "bg-[var(--color-gold)]" : "bg-primary/70"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {board.me && board.me.rank > board.top.length && (
          <div className="mt-3 pt-3 border-t border-border flex items-baseline justify-between text-sm">
            <span className="flex items-center gap-2">
              <span className="inline-grid place-items-center size-5 rounded-full bg-gold text-black text-[10px] font-medium tabular-nums">{board.me.rank}</span>
              <span className="font-medium">You</span>
            </span>
            <span className="text-muted-foreground tabular-nums text-xs">{fmtSecHuman(board.me.weekSec)}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}


