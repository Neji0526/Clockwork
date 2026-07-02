// TimesheetsPanel — lifted out of src/routes/admin.tsx when Timesheets
// was promoted into the Financials route alongside Payroll and Invoices.
// Hours-in → wages-out → invoices-out: this is the entry point of that flow.
//
// Includes the panel itself plus the file-local helpers it owns
// (downloadCsv, fmtWeekRange, escapeHtml, SessionsList, AdjustSessionDialog).
// Shared date/number helpers live in @/lib/financials.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { adjustSession } from "@/lib/admin.functions";
import { addDays, mondayOf, secsToHours, ymd } from "@/lib/financials";
import { fmtDuration, fmtHoursHuman, fmtSecHuman, hostOf } from "@/lib/format";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { RatioBar, ShareRow } from "@/components/ui/ratio-bar";
import { MetricTile } from "@/components/ui/metric-tile";
import { CountUp } from "@/components/ui/count-up";
import {
  Timer, Coffee, Briefcase, Printer, Download, Check, AlertTriangle,
  Lock as LockIcon, DollarSign, Pencil,
} from "lucide-react";

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const esc = (v: any) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const content = rows.map(r => r.map(esc).join(",")).join("\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

function fmtWeekRange(monday: Date) {
  const sun = addDays(monday, 6);
  const sameMonth = monday.getMonth() === sun.getMonth();
  const m = (x: Date) => x.toLocaleDateString(undefined, { month: "short" });
  if (sameMonth) return `${m(monday)} ${monday.getDate()}–${sun.getDate()}, ${monday.getFullYear()}`;
  return `${m(monday)} ${monday.getDate()} – ${m(sun)} ${sun.getDate()}, ${sun.getFullYear()}`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function TimesheetsPanel() {
  const [mode, setMode] = useState<"day" | "week">("week");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [clientFilter, setClientFilter] = useState<string>("all");

  const dateObj = useMemo(() => new Date(date + "T00:00:00"), [date]);
  const weekStart = useMemo(() => mondayOf(dateObj), [dateObj]);
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]); // exclusive

  const rangeStart = mode === "week" ? weekStart : dateObj;
  const rangeEnd = mode === "week" ? weekEnd : addDays(dateObj, 1);

  const clientsQ = useQuery({
    queryKey: ["clients-lookup"],
    queryFn: async () => (await supabase.from("clients").select("id,name,archived").order("name")).data ?? [],
    staleTime: 60_000,
  });
  const clientMap = useMemo(
    () => new Map((clientsQ.data ?? []).map(c => [c.id, c.name])),
    [clientsQ.data],
  );

  const q = useQuery({
    queryKey: ["admin-timesheet", mode, ymd(rangeStart), ymd(rangeEnd), clientFilter],
    queryFn: async () => {
      // PHASE 6: segment basis. report_segment_day_slices is Eastern-bucketed,
      // pro-rated across midnight, and excludes breaks/idle by construction
      // (work-kind slices only). No more `active − breakSec` double-subtraction.
      const { data: rawSlices, error: sliceErr } = await supabase.rpc(
        "report_segment_day_slices",
        { p_from: ymd(rangeStart), p_to: ymd(addDays(rangeEnd, -1)) },
      );
      if (sliceErr) throw sliceErr;
      const allSlices = (rawSlices ?? []) as Array<{
        segment_id: string; session_id: string; va_id: string;
        kind: "work" | "break"; client_id: string | null; project_id: string | null;
        local_day: string; slice_start: string; slice_end: string;
        active_sec: number; idle_sec: number;
      }>;

      // Client filter applies at the SEGMENT level (segment.client_id), which is
      // the authoritative attribution. work_sessions.client_id is legacy.
      const workSlices = allSlices.filter(s => {
        if (s.kind !== "work") return false;
        if (clientFilter === "all") return true;
        if (clientFilter === "none") return s.client_id == null;
        return s.client_id === clientFilter;
      });

      const vaIds = Array.from(new Set(workSlices.map(s => s.va_id)));
      const sessionIds = Array.from(new Set(workSlices.map(s => s.session_id)));

      // Sessions list, top-apps, and break-time display still come from the
      // base tables — they're per-session UI, not the billable aggregate.
      const sessions = sessionIds.length
        ? (await supabase
            .from("work_sessions")
            .select("id, va_id, client_id, started_at, ended_at, status, active_sec, idle_sec")
            .in("id", sessionIds)).data ?? []
        : [];
      const profiles = vaIds.length
        ? (await supabase.from("profiles")
            .select("user_id, display_name, pay_rate_cents, pay_currency")
            .in("user_id", vaIds)).data ?? []
        : [];
      const acts = sessionIds.length
        ? (await supabase.from("activity_events")
            .select("session_id, va_id, app, url, duration_sec")
            .in("session_id", sessionIds)).data ?? []
        : [];
      const breaks = sessionIds.length
        ? (await supabase.from("break_segments")
            .select("va_id, session_id, started_at, ended_at, duration_sec")
            .in("session_id", sessionIds)).data ?? []
        : [];

      const profMap = new Map(profiles.map(p => [p.user_id, p]));
      const breakSecByVa = new Map<string, number>();
      const breakSecBySession = new Map<string, number>();
      for (const b of breaks) {
        const sec = b.duration_sec ?? (b.ended_at
          ? Math.max(0, Math.floor((new Date(b.ended_at).getTime() - new Date(b.started_at).getTime()) / 1000))
          : 0);
        breakSecByVa.set(b.va_id, (breakSecByVa.get(b.va_id) ?? 0) + sec);
        if (b.session_id) breakSecBySession.set(b.session_id, (breakSecBySession.get(b.session_id) ?? 0) + sec);
      }
      const appsByVa = new Map<string, Map<string, number>>();
      for (const a of acts) {
        const m = appsByVa.get(a.va_id) ?? new Map<string, number>();
        const key = a.app || hostOf(a.url) || "Other";
        m.set(key, (m.get(key) ?? 0) + (a.duration_sec ?? 0));
        appsByVa.set(a.va_id, m);
      }

      const sessionsByVa = new Map<string, typeof sessions>();
      for (const s of sessions) {
        const arr = sessionsByVa.get(s.va_id) ?? [];
        arr.push(s); sessionsByVa.set(s.va_id, arr);
      }

      // Aggregate from work slices only.
      const perVa = vaIds.map(va_id => {
        let active = 0, idle = 0;
        const perClient = new Map<string | null, { active: number; idle: number }>();
        const perDay = new Map<string, { active: number; idle: number }>();
        for (const sl of workSlices) {
          if (sl.va_id !== va_id) continue;
          active += sl.active_sec;
          idle += sl.idle_sec;
          const k = sl.client_id ?? null;
          const cur = perClient.get(k) ?? { active: 0, idle: 0 };
          cur.active += sl.active_sec; cur.idle += sl.idle_sec;
          perClient.set(k, cur);
          const dCur = perDay.get(sl.local_day) ?? { active: 0, idle: 0 };
          dCur.active += sl.active_sec; dCur.idle += sl.idle_sec;
          perDay.set(sl.local_day, dCur);
        }
        const prof = profMap.get(va_id);
        const breakSec = breakSecByVa.get(va_id) ?? 0;
        // Segment basis: active already excludes breaks and idle, so billable === active.
        const billable = active;
        const costCents = Math.round((billable / 3600) * (prof?.pay_rate_cents ?? 0));
        return {
          va_id,
          name: prof?.display_name ?? "Unknown",
          active, idle, breakSec, billable,
          costCents,
          payCurrency: prof?.pay_currency ?? "USD",
          payRateCents: prof?.pay_rate_cents ?? 0,
          sessions: sessionsByVa.get(va_id) ?? [],
          perClient: Array.from(perClient.entries()),
          perDay: Array.from(perDay.entries()).sort((a, b) => a[0].localeCompare(b[0])),
          apps: Array.from((appsByVa.get(va_id) ?? new Map()).entries()).sort((a, b) => b[1] - a[1]).slice(0, 5),
        };
      });

      const perClient = new Map<string | null, { active: number; idle: number }>();
      for (const sl of workSlices) {
        const k = sl.client_id ?? null;
        const cur = perClient.get(k) ?? { active: 0, idle: 0 };
        cur.active += sl.active_sec; cur.idle += sl.idle_sec;
        perClient.set(k, cur);
      }

      let approvals = new Map<string, { id: string; approved_at: string; approved_by: string; notes: string | null }>();
      if (mode === "week" && vaIds.length) {
        const { data: apr } = await supabase
          .from("timesheet_approvals")
          .select("id, va_id, approved_at, approved_by, notes")
          .eq("week_start", ymd(weekStart))
          .in("va_id", vaIds);
        approvals = new Map((apr ?? []).map(a => [a.va_id, a]));
      }

      return { perVa, perClient: Array.from(perClient.entries()), profMap, approvals, breakSecBySession };
    },
  });

  const qc = useQueryClient();
  const { profile } = useAuth();

  async function approveWeek(vaId: string, totals: { active: number; idle: number }) {
    if (!profile) return;
    const { error } = await supabase.from("timesheet_approvals").insert({
      va_id: vaId,
      week_start: ymd(weekStart),
      total_active_sec: totals.active,
      total_idle_sec: totals.idle,
      approved_by: profile.user_id,
    });
    if (error) return toast.error(error.message);
    toast.success("Week approved");
    qc.invalidateQueries({ queryKey: ["admin-timesheet"] });
  }
  async function unapproveWeek(approvalId: string) {
    const { error } = await supabase.from("timesheet_approvals").delete().eq("id", approvalId);
    if (error) return toast.error(error.message);
    toast.success("Approval removed");
    qc.invalidateQueries({ queryKey: ["admin-timesheet"] });
  }

  function exportCsv() {
    if (mode === "day") {
      const rows: (string | number)[][] = [["date", "member_name", "client_name", "active_hours", "idle_hours", "total_hours"]];
      for (const va of q.data?.perVa ?? []) {
        for (const [clientId, v] of va.perClient) {
          const clientName = clientId ? (clientMap.get(clientId) ?? "Unknown client") : "(no client)";
          rows.push([date, va.name, clientName, secsToHours(v.active), secsToHours(v.idle), secsToHours(v.active + v.idle)]);
        }
      }
      if (rows.length === 1) rows.push([date, "—", "—", "0.00", "0.00", "0.00"]);
      downloadCsv(`clockwork-timesheet-${date}.csv`, rows);
    } else {
      const days = Array.from({ length: 7 }, (_, i) => ymd(addDays(weekStart, i)));
      const rows: (string | number)[][] = [["week_start", "member_name", ...days, "week_active_hours", "week_idle_hours", "week_total_hours"]];
      for (const va of q.data?.perVa ?? []) {
        const dMap = new Map(va.perDay);
        const cells = days.map(d => secsToHours((dMap.get(d)?.active ?? 0) + (dMap.get(d)?.idle ?? 0)));
        rows.push([ymd(weekStart), va.name, ...cells, secsToHours(va.active), secsToHours(va.idle), secsToHours(va.active + va.idle)]);
      }
      downloadCsv(`clockwork-week-${ymd(weekStart)}.csv`, rows);
    }
  }

  function printWeekReport() {
    const w = window.open("", "_blank", "width=900,height=1000");
    if (!w) return toast.error("Pop-up blocked");
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const dayHeaders = days.map(d => d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" }));

    const vaSections = (q.data?.perVa ?? []).map(va => {
      const dMap = new Map(va.perDay);
      const approval = q.data?.approvals.get(va.va_id);
      const dayCells = days.map(d => {
        const v = dMap.get(ymd(d));
        return v ? fmtDuration(v.active + v.idle) : "—";
      });
      const clients = va.perClient.map(([cid, v]) => {
        const label = cid ? (clientMap.get(cid) ?? "Unknown") : "(no client)";
        return `<tr><td>${escapeHtml(label)}</td><td class="r">${fmtDuration(v.active)}</td><td class="r">${fmtDuration(v.idle)}</td><td class="r">${fmtDuration(v.active + v.idle)}</td></tr>`;
      }).join("");
      return `
        <section class="va">
          <header>
            <h2>${escapeHtml(va.name)}</h2>
            ${approval ? `<span class="approved">Approved ${new Date(approval.approved_at).toLocaleDateString()}</span>` : ""}
          </header>
          <table class="days">
            <thead><tr>${dayHeaders.map(h => `<th>${h}</th>`).join("")}<th>Week total</th></tr></thead>
            <tbody><tr>${dayCells.map(c => `<td class="r">${c}</td>`).join("")}<td class="r tot">${fmtDuration(va.active + va.idle)}</td></tr></tbody>
          </table>
          <table class="clients">
            <thead><tr><th>Brand</th><th class="r">Active</th><th class="r">Idle</th><th class="r">Total</th></tr></thead>
            <tbody>${clients || `<tr><td colspan="4" class="muted">No brand breakdown.</td></tr>`}</tbody>
          </table>
        </section>
      `;
    }).join("");

    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>ClockWork — Week of ${fmtWeekRange(weekStart)}</title>
      <style>
        body{font:14px/1.5 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;color:#111;margin:32px;}
        h1{margin:0 0 4px;font-size:20px;} .sub{color:#666;margin-bottom:24px;}
        .va{page-break-inside:avoid;margin-bottom:28px;border:1px solid #e5e7eb;border-radius:8px;padding:16px;}
        .va header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;}
        .va h2{margin:0;font-size:16px;}
        .approved{font-size:12px;padding:2px 8px;border-radius:999px;background:#dcfce7;color:#166534;}
        table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px;}
        th,td{padding:6px 8px;border-bottom:1px solid #f1f5f9;text-align:left;}
        th{font-weight:600;color:#374151;background:#f9fafb;}
        td.r,th.r{text-align:right;font-variant-numeric:tabular-nums;}
        td.tot{font-weight:600;}
        .muted{color:#9ca3af;}
        @media print { body{margin:16mm;} .noprint{display:none;} }
        .bar{margin-top:8px;}
      </style></head><body>
      <h1>ClockWork weekly report</h1>
      <div class="sub">${fmtWeekRange(weekStart)}</div>
      ${vaSections || `<p class="muted">No sessions in this week.</p>`}
      <p class="noprint" style="margin-top:24px;color:#666;font-size:12px;">Tip: use your browser's "Save as PDF" in the print dialog.</p>
      <script>window.onload = () => setTimeout(() => window.print(), 200);</script>
      </body></html>`);
    w.document.close();
  }

  const rangeLabel = mode === "week" ? fmtWeekRange(weekStart) : dateObj.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  return (
    <div className="space-y-6">
      {/* Compact header + inline toolbar */}
      <header className="surface-card relative overflow-hidden rounded-xl px-4 py-2.5">
        <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="inline-flex items-center gap-2 min-w-0">
            <Timer className="size-3.5 text-gold/90 shrink-0" />
            <span className="text-[10px] uppercase tracking-[0.22em] text-gold/90 font-medium">Timesheets</span>
            <span className="text-xs text-muted-foreground tabular-nums truncate hidden md:inline">· {rangeLabel}</span>
          </div>
          <div className="inline-flex items-center gap-0.5 p-0.5 rounded-full border border-border bg-card/60">
            <button
              className={`press px-3 py-0.5 text-xs font-medium rounded-full transition-colors ${mode === "day" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => setMode("day")}
            >Day</button>
            <button
              className={`press px-3 py-0.5 text-xs font-medium rounded-full transition-colors ${mode === "week" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => setMode("week")}
            >Week</button>
          </div>
          {mode === "day" ? (
            <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40 h-8 text-xs" />
          ) : (
            <div className="inline-flex items-center gap-1">
              <Button variant="ghost" size="sm" className="size-7 p-0" onClick={() => setDate(ymd(addDays(weekStart, -7)))} aria-label="Previous week">‹</Button>
              <span className="text-xs font-medium tabular-nums px-1.5">{fmtWeekRange(weekStart)}</span>
              <Button variant="ghost" size="sm" className="size-7 p-0" onClick={() => setDate(ymd(addDays(weekStart, 7)))} aria-label="Next week">›</Button>
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setDate(new Date().toISOString().slice(0, 10))}>This week</Button>
            </div>
          )}
          <div className="inline-flex items-center gap-1.5">
            <Briefcase className="size-3.5 text-muted-foreground" />
            <Select value={clientFilter} onValueChange={setClientFilter}>
              <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All brands</SelectItem>
                <SelectItem value="none">(no brand)</SelectItem>
                {(clientsQ.data ?? []).filter(c => !c.archived).map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto inline-flex items-center gap-2">
            {mode === "week" && (
              <Button variant="outline" size="sm" onClick={printWeekReport} disabled={!q.data} className="h-8">
                <Printer className="size-3.5 mr-1.5" />Print / PDF
              </Button>
            )}
            <Button size="sm" onClick={exportCsv} disabled={!q.data} className="press h-8">
              <Download className="size-3.5 mr-1.5" />Export CSV
            </Button>
          </div>
        </div>
      </header>


      {q.data && q.data.perVa.length > 0 && (() => {
        const tActive = q.data.perVa.reduce((a, r) => a + r.active, 0);
        const tIdle = q.data.perVa.reduce((a, r) => a + r.idle, 0);
        const tBillable = q.data.perVa.reduce((a, r) => a + r.billable, 0);
        const tCost = q.data.perVa.reduce((a, r) => a + r.costCents, 0);
        const currency = q.data.perVa.find(r => r.payRateCents > 0)?.payCurrency ?? "USD";
        const showCost = tCost > 0;
        return (
          <div className="stagger-children grid gap-4 grid-cols-2 lg:grid-cols-4">
            <MetricTile
              label={mode === "week" ? "Week active" : "Day active"}
              accent
              icon={<Timer className="size-3" />}
              value={<CountUp value={tActive / 3600} format={fmtHoursHuman} />}
              caption={`${q.data.perVa.length} ${q.data.perVa.length === 1 ? "Member" : "Members"}`}
            />
            <MetricTile
              label="Idle"
              icon={<Coffee className="size-3" />}
              value={<CountUp value={tIdle / 3600} format={fmtHoursHuman} />}
              caption={tActive + tIdle > 0 ? `${Math.round((tIdle / (tActive + tIdle)) * 100)}% of total` : "—"}
            />
            <MetricTile
              label="Billable"
              icon={<Check className="size-3" />}
              value={<CountUp value={tBillable / 3600} format={fmtHoursHuman} />}
              caption="Work-segment time, breaks excluded"
            />
            <MetricTile
              label={showCost ? "Labor cost" : "Brands"}
              icon={<DollarSign className="size-3" />}
              value={
                showCost
                  ? (tCost / 100).toLocaleString(undefined, { style: "currency", currency, maximumFractionDigits: 0 })
                  : <CountUp value={q.data.perClient.length} />
              }
              caption={showCost ? "Across approved rates" : "Distinct brands in range"}
            />
          </div>
        );
      })()}

      {q.data && q.data.perClient.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Briefcase className="size-4" />Time by brand</CardTitle></CardHeader>
          <CardContent>
            {(() => {
              const rows = q.data.perClient
                .map(([clientId, v]) => ({
                  id: clientId ?? "none",
                  name: clientId ? (clientMap.get(clientId) ?? "Unknown brand") : "(no brand)",
                  active: v.active,
                  idle: v.idle,
                  total: v.active + v.idle,
                }))
                .sort((a, b) => b.total - a.total);
              const max = rows[0]?.total ?? 0;
              return (
                <div className="divide-y divide-border">
                  {rows.map((r, i) => (
                    <ShareRow
                      key={r.id}
                      label={r.name}
                      value={r.total}
                      max={max}
                      accent={i === 0}
                      valueLabel={`${fmtDuration(r.active)} active · ${fmtDuration(r.total)}`}
                    />
                  ))}
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {q.data?.perVa.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No sessions for this filter.</CardContent></Card>
      ) : (
        <div className="stagger-children grid gap-4 md:grid-cols-2">
          {(q.data?.perVa ?? []).map(row => {
            const total = row.active + row.idle;
            const idleRatio = total > 0 ? row.idle / total : 0;
            const totalApp = row.apps.reduce((a, [, v]) => a + v, 0) || 1;
            const approval = q.data?.approvals.get(row.va_id);
            return (
              <Card key={row.va_id} className={approval ? "border-success/40" : ""}>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    {row.name}
                    {approval && <Badge variant="outline" className="gap-1 text-xs"><LockIcon className="size-3" />Approved</Badge>}
                  </CardTitle>
                  {idleRatio > 0.3 && (
                    <Badge variant="outline" className="text-warning border-warning/50 gap-1">
                      <AlertTriangle className="size-3" />High idle
                    </Badge>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Total</div>
                      <div className="font-display text-2xl leading-none tabular-nums mt-1">{fmtDuration(total)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Active</div>
                      <div className="font-display text-2xl leading-none tabular-nums mt-1">{fmtDuration(row.active)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Idle</div>
                      <div className="font-display text-2xl leading-none tabular-nums mt-1">{fmtDuration(row.idle)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Billable</div>
                      <div className="font-display text-2xl leading-none tabular-nums mt-1">{fmtDuration(row.billable)}</div>
                    </div>
                  </div>

                  {total > 0 && (
                    <RatioBar
                      segments={[
                        { value: Math.max(0, row.active - row.breakSec), color: "var(--color-primary)", label: "Active" },
                        { value: row.breakSec, color: "color-mix(in oklab, var(--color-gold) 70%, transparent)", label: "Breaks" },
                        { value: row.idle, color: "color-mix(in oklab, var(--color-warning) 70%, transparent)", label: "Idle" },
                      ]}
                    />
                  )}

                  {(row.breakSec > 0 || row.payRateCents > 0) && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {row.breakSec > 0 && (
                        <span className="inline-flex items-center gap-1"><Coffee className="size-3" />Breaks <span className="text-foreground font-medium tabular-nums">{fmtDuration(row.breakSec)}</span></span>
                      )}
                      {row.payRateCents > 0 && (
                        <span className="inline-flex items-center gap-1"><DollarSign className="size-3" />Cost <span className="text-foreground font-medium tabular-nums">{(row.costCents / 100).toLocaleString(undefined, { style: "currency", currency: row.payCurrency })}</span></span>
                      )}
                    </div>
                  )}

                  {mode === "week" && (() => {
                    const dMap = new Map(row.perDay);
                    const cells = Array.from({ length: 7 }, (_, i) => {
                      const d = addDays(weekStart, i);
                      const v = dMap.get(ymd(d));
                      return { d, total: v ? v.active + v.idle : 0 };
                    });
                    const maxCell = Math.max(1, ...cells.map(c => c.total));
                    return (
                      <div className="pt-1">
                        <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground mb-1.5">Week</div>
                        <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                          {cells.map(({ d, total: dt }, i) => {
                            const h = dt > 0 ? Math.max(8, (dt / maxCell) * 36) : 2;
                            const isLeader = dt === maxCell && dt > 0;
                            return (
                              <div key={i} className="min-w-0 text-center flex flex-col items-center gap-1">
                                <div className="h-9 w-full flex items-end justify-center">
                                  <div
                                    className={`w-full rounded-sm transition-all duration-700 ${isLeader ? "bg-[var(--color-gold)]" : dt > 0 ? "bg-primary/80" : "bg-muted"}`}
                                    style={{ height: `${h}px` }}
                                    title={dt ? fmtSecHuman(dt) : undefined}
                                  />
                                </div>
                                <div className="text-[10px] text-muted-foreground">{d.toLocaleDateString(undefined, { weekday: "short" })[0]}</div>
                                <div className="hidden sm:block text-[10px] tabular-nums font-medium truncate w-full">{dt ? fmtSecHuman(dt) : "—"}</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {row.perClient.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {row.perClient.map(([clientId, v]) => (
                        <Badge key={clientId ?? "none"} variant="outline" className="gap-1 font-normal">
                          <Briefcase className="size-3" />
                          {clientId ? (clientMap.get(clientId) ?? "Unknown") : "(no client)"}
                          <span className="text-muted-foreground tabular-nums">· {fmtDuration(v.active + v.idle)}</span>
                        </Badge>
                      ))}
                    </div>
                  )}
                  {row.apps.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No per-app data (extension not connected yet).</p>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Top apps</div>
                      {row.apps.map(([app, sec], i) => {
                        const pct = totalApp > 0 ? Math.max(2, (sec / totalApp) * 100) : 0;
                        return (
                          <div key={app} className="group">
                            <div className="flex justify-between text-xs">
                              <span className="truncate">{app}</span>
                              <span className="text-muted-foreground tabular-nums">{fmtDuration(sec)}</span>
                            </div>
                            <div className="mt-1 h-[3px] rounded-full bg-muted/60 overflow-hidden">
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

                  {mode === "week" && (
                    <div className="pt-2 border-t flex items-center justify-between gap-2">
                      {approval ? (
                        <>
                          <span className="text-xs text-muted-foreground">
                            Locked {new Date(approval.approved_at).toLocaleDateString()}
                          </span>
                          <Button variant="ghost" size="sm" onClick={() => unapproveWeek(approval.id)}>
                            Unapprove
                          </Button>
                        </>
                      ) : (
                        <>
                          <span className="text-xs text-muted-foreground">Week not yet approved</span>
                          <Button size="sm" onClick={() => approveWeek(row.va_id, { active: row.active, idle: row.idle })}>
                            <Check className="size-4 mr-1" />Approve week
                          </Button>
                        </>
                      )}
                    </div>
                  )}

                  <SessionsList
                    sessions={row.sessions}
                    breakBySession={q.data?.breakSecBySession ?? new Map()}
                    disabled={!!approval}
                    onChanged={() => qc.invalidateQueries({ queryKey: ["admin-timesheet"] })}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

type SessionRow = {
  id: string; va_id: string; client_id: string | null; started_at: string;
  ended_at: string | null; status: "active" | "ended" | "abandoned"; active_sec: number; idle_sec: number;
};

function SessionsList({
  sessions, breakBySession, disabled, onChanged,
}: {
  sessions: SessionRow[];
  breakBySession: Map<string, number>;
  disabled: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<SessionRow | null>(null);
  if (!sessions.length) return null;
  const sorted = sessions.slice().sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 8);
  return (
    <details className="pt-2 border-t">
      <summary className="text-xs text-muted-foreground cursor-pointer select-none hover:text-foreground">
        Sessions ({sessions.length})
      </summary>
      <div className="mt-2 space-y-1.5">
        {sorted.map(s => {
          const brk = breakBySession.get(s.id) ?? 0;
          return (
            <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
              <div className="min-w-0 flex-1">
                <span className="tabular-nums">{new Date(s.started_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span>
                {s.status === "active" && <Badge variant="outline" className="ml-1.5 text-[10px]">live</Badge>}
                <span className="text-muted-foreground"> · {fmtDuration(s.active_sec)} active, {fmtDuration(s.idle_sec)} idle{brk > 0 ? `, ${fmtDuration(brk)} break` : ""}</span>
              </div>
              <Button variant="ghost" size="sm" className="h-7" disabled={disabled} onClick={() => setEditing(s)}>
                <Pencil className="size-3" />
              </Button>
            </div>
          );
        })}
      </div>
      {editing && (
        <AdjustSessionDialog
          session={editing}
          open={!!editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged(); }}
        />
      )}
    </details>
  );
}

function AdjustSessionDialog({
  session, open, onClose, onSaved,
}: { session: SessionRow; open: boolean; onClose: () => void; onSaved: () => void }) {
  const adjust = useServerFn(adjustSession);
  const [activeMin, setActiveMin] = useState(Math.round(session.active_sec / 60));
  const [idleMin, setIdleMin] = useState(Math.round(session.idle_sec / 60));
  const [endedAt, setEndedAt] = useState(session.ended_at ? session.ended_at.slice(0, 16) : "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await adjust({ data: {
        session_id: session.id,
        active_sec: Math.max(0, activeMin) * 60,
        idle_sec: Math.max(0, idleMin) * 60,
        ended_at: endedAt ? new Date(endedAt).toISOString() : (session.ended_at ?? null),
        note: note || undefined,
      } });
      toast.success("Session adjusted");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust session</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground text-xs">Use this when a member forgot to clock out or idle was misclassified. Changes are logged.</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Active (min)</Label><Input type="number" min={0} value={activeMin} onChange={e => setActiveMin(Number(e.target.value))} /></div>
            <div className="space-y-1.5"><Label>Idle (min)</Label><Input type="number" min={0} value={idleMin} onChange={e => setIdleMin(Number(e.target.value))} /></div>
          </div>
          <div className="space-y-1.5">
            <Label>Ended at {session.status === "active" && <span className="text-xs text-muted-foreground">(setting this clocks them out)</span>}</Label>
            <Input type="datetime-local" value={endedAt} onChange={e => setEndedAt(e.target.value)} />
          </div>
          <div className="space-y-1.5"><Label>Note (audit log)</Label><Input value={note} onChange={e => setNote(e.target.value)} placeholder="Member forgot to clock out" /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
