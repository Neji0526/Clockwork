import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { MetricTile } from "@/components/ui/metric-tile";
import { CountUp } from "@/components/ui/count-up";
import { Check, DollarSign, Download, Timer } from "lucide-react";
import { fmtDuration, fmtHoursHuman } from "@/lib/format";
import {
  addDays, fmtRange, mondayOf, presetRange, secsToHours, ymd,
  type PayrollPreset,
} from "@/lib/financials";

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

export function PayrollPanel() {
  const [preset, setPreset] = useState<PayrollPreset>("last-week");
  const today = useMemo(() => new Date(), []);
  const initial = useMemo(() => presetRange("last-week", today), [today]);
  const [customStart, setCustomStart] = useState(ymd(initial.start));
  const [customEnd, setCustomEnd] = useState(ymd(addDays(initial.end, -1)));

  const range = useMemo(() => {
    if (preset !== "custom") return presetRange(preset, today);
    const s = new Date(customStart + "T00:00:00");
    const e = new Date(customEnd + "T00:00:00");
    return { start: s, end: addDays(e, 1) };
  }, [preset, customStart, customEnd, today]);

  const q = useQuery({
    queryKey: ["payroll", ymd(range.start), ymd(range.end)],
    queryFn: async () => {
      // PHASE 6: segment basis, same RPC as Timesheets and Invoicing.
      // Pay is computed from work-segment active_sec — breaks/idle excluded once.
      const { data: rawSlices, error: sliceErr } = await supabase.rpc(
        "report_segment_day_slices",
        { p_from: ymd(range.start), p_to: ymd(addDays(range.end, -1)) },
      );
      if (sliceErr) throw sliceErr;
      const slices = (rawSlices ?? []) as Array<{
        va_id: string; session_id: string; kind: "work" | "break";
        active_sec: number; idle_sec: number;
      }>;
      const workSlices = slices.filter(s => s.kind === "work");

      const vaIds = Array.from(new Set(workSlices.map(s => s.va_id)));
      const sessionIds = Array.from(new Set(workSlices.map(s => s.session_id)));
      const profiles = vaIds.length
        ? (await supabase.from("profiles")
            .select("user_id, display_name, pay_rate_cents, pay_currency")
            .in("user_id", vaIds)).data ?? []
        : [];
      const breaks = sessionIds.length
        ? (await supabase.from("break_segments")
            .select("va_id, session_id, started_at, ended_at, duration_sec")
            .in("session_id", sessionIds)).data ?? []
        : [];

      const approvals = vaIds.length
        ? (await supabase.from("timesheet_approvals")
            .select("va_id, week_start")
            .in("va_id", vaIds)
            .gte("week_start", ymd(range.start))
            .lt("week_start", ymd(range.end))).data ?? []
        : [];
      const approvedWeeksByVa = new Map<string, Set<string>>();
      for (const a of approvals) {
        const set = approvedWeeksByVa.get(a.va_id) ?? new Set<string>();
        set.add(a.week_start); approvedWeeksByVa.set(a.va_id, set);
      }
      const expectedWeeks: string[] = [];
      let cur = mondayOf(range.start);
      while (cur < range.end) {
        if (cur >= range.start) expectedWeeks.push(ymd(cur));
        cur = addDays(cur, 7);
      }

      const breakSecByVa = new Map<string, number>();
      for (const b of breaks) {
        const sec = b.duration_sec ?? (b.ended_at
          ? Math.max(0, Math.floor((new Date(b.ended_at).getTime() - new Date(b.started_at).getTime()) / 1000))
          : 0);
        breakSecByVa.set(b.va_id, (breakSecByVa.get(b.va_id) ?? 0) + sec);
      }
      const activeByVa = new Map<string, number>();
      const idleByVa = new Map<string, number>();
      for (const sl of workSlices) {
        activeByVa.set(sl.va_id, (activeByVa.get(sl.va_id) ?? 0) + sl.active_sec);
        idleByVa.set(sl.va_id, (idleByVa.get(sl.va_id) ?? 0) + sl.idle_sec);
      }

      const profMap = new Map(profiles.map(p => [p.user_id, p]));
      const rows = vaIds.map(va_id => {
        const p = profMap.get(va_id);
        const active = activeByVa.get(va_id) ?? 0;
        const idle = idleByVa.get(va_id) ?? 0;
        const breakSec = breakSecByVa.get(va_id) ?? 0;
        const billable = active;
        const rate = p?.pay_rate_cents ?? 0;
        const currency = p?.pay_currency ?? "USD";
        const amountCents = Math.round((billable / 3600) * rate);
        const approvedSet = approvedWeeksByVa.get(va_id) ?? new Set<string>();
        return {
          va_id,
          name: p?.display_name ?? "Unknown",
          active, idle, breakSec, billable,
          rateCents: rate, currency, amountCents,
          approvedWeeks: approvedSet.size,
          expectedWeeks: expectedWeeks.length,
        };
      }).sort((a, b) => b.billable - a.billable);

      return { rows, expectedWeeks };
    },
  });

  function exportCsv() {
    const rows: (string | number)[][] = [[
      "period_start", "period_end", "va_name", "active_hours", "break_hours",
      "billable_hours", "pay_rate_per_hour", "currency", "amount", "approval_status",
    ]];
    const periodStart = ymd(range.start);
    const periodEnd = ymd(addDays(range.end, -1));
    for (const r of q.data?.rows ?? []) {
      const approval = r.expectedWeeks === 0
        ? "n/a"
        : r.approvedWeeks >= r.expectedWeeks
          ? "fully approved"
          : r.approvedWeeks > 0 ? `partial (${r.approvedWeeks}/${r.expectedWeeks})` : "unapproved";
      rows.push([
        periodStart, periodEnd, r.name,
        secsToHours(r.active), secsToHours(r.breakSec), secsToHours(r.billable),
        (r.rateCents / 100).toFixed(2), r.currency,
        (r.amountCents / 100).toFixed(2), approval,
      ]);
    }
    if (rows.length === 1) rows.push([periodStart, periodEnd, "—", "0", "0", "0", "0", "USD", "0", "n/a"]);
    downloadCsv(`clockwork-payroll-${periodStart}_to_${periodEnd}.csv`, rows);
  }

  const rows = q.data?.rows ?? [];
  const totalBillable = rows.reduce((a, r) => a + r.billable, 0);
  const byCcy = new Map<string, number>();
  for (const r of rows) byCcy.set(r.currency, (byCcy.get(r.currency) ?? 0) + r.amountCents);
  const missingRate = rows.filter(r => r.rateCents === 0).length;

  const rangeLabel = fmtRange(range.start, range.end);

  return (
    <div className="space-y-6">
      <header className="surface-card relative overflow-hidden rounded-xl px-4 py-2.5">
        <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="inline-flex items-center gap-2 min-w-0">
            <DollarSign className="size-3.5 text-gold/90 shrink-0" />
            <span className="text-[10px] uppercase tracking-[0.22em] text-gold/90 font-medium">Payroll</span>
            <span className="text-xs text-muted-foreground tabular-nums truncate hidden md:inline">· {rangeLabel}</span>
          </div>
          <div className="inline-flex items-center gap-1.5">
            <Label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Period</Label>
            <Select value={preset} onValueChange={(v) => setPreset(v as PayrollPreset)}>
              <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="this-week">This week</SelectItem>
                <SelectItem value="last-week">Last week</SelectItem>
                <SelectItem value="last-2-weeks">Last 2 weeks</SelectItem>
                <SelectItem value="this-month">This month</SelectItem>
                <SelectItem value="last-month">Last month</SelectItem>
                <SelectItem value="custom">Custom…</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {preset === "custom" && (
            <div className="inline-flex items-center gap-1.5">
              <Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="w-36 h-8 text-xs" />
              <span className="text-muted-foreground text-xs">to</span>
              <Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="w-36 h-8 text-xs" />
            </div>
          )}
          <Button
            size="sm"
            onClick={exportCsv}
            disabled={!q.data || rows.length === 0}
            className="press h-8 ml-auto"
          >
            <Download className="size-3.5 mr-1.5" />Export payroll CSV
          </Button>
        </div>
      </header>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 stagger-children">
        <MetricTile
          label="Billable hours"
          accent
          icon={<Timer className="size-3" />}
          value={<CountUp value={totalBillable / 3600} format={fmtHoursHuman} />}
          caption={`${rows.length} ${rows.length === 1 ? "Member" : "Members"}`}
        />
        {Array.from(byCcy.entries()).slice(0, 2).map(([ccy, cents]) => (
          <MetricTile
            key={ccy}
            label={`Total owed (${ccy})`}
            icon={<DollarSign className="size-3" />}
            value={(cents / 100).toLocaleString(undefined, { style: "currency", currency: ccy, maximumFractionDigits: 0 })}
            caption="Billable × pay rate"
          />
        ))}
        <MetricTile
          label="Rate set"
          icon={<Check className="size-3" />}
          value={<CountUp value={rows.length - missingRate} />}
          caption={missingRate > 0 ? `${missingRate} member${missingRate === 1 ? "" : "s"} need a rate` : "All members configured"}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><DollarSign className="size-4" />Payroll by member</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">No sessions in this period.</p>
          ) : (
            <>
              <div className="sm:hidden divide-y divide-border -mt-2">
                {rows.map((r) => {
                  const fullyApproved = r.expectedWeeks > 0 && r.approvedWeeks >= r.expectedWeeks;
                  const partiallyApproved = r.approvedWeeks > 0 && !fullyApproved;
                  return (
                    <div key={r.va_id} className="py-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <Link to="/admin/$vaId" params={{ vaId: r.va_id }} className="font-medium hover:underline truncate">{r.name}</Link>
                        <div className="text-right">
                          <div className="font-display text-xl leading-none tabular-nums">
                            {r.rateCents > 0
                              ? (r.amountCents / 100).toLocaleString(undefined, { style: "currency", currency: r.currency, maximumFractionDigits: 0 })
                              : "—"}
                          </div>
                          <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground mt-1">Amount</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Active</div>
                          <div className="tabular-nums mt-0.5">{fmtDuration(r.active)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Breaks</div>
                          <div className="tabular-nums mt-0.5 text-muted-foreground">{fmtDuration(r.breakSec)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Billable</div>
                          <div className="tabular-nums mt-0.5 font-medium">{fmtDuration(r.billable)}</div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">
                          {r.rateCents > 0
                            ? `${(r.rateCents / 100).toLocaleString(undefined, { style: "currency", currency: r.currency })}/hr`
                            : <span className="text-amber-600 dark:text-amber-500">Rate not set</span>}
                        </span>
                        {r.expectedWeeks === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : fullyApproved ? (
                          <Badge variant="secondary" className="bg-success/15 text-success border-success/30">Approved</Badge>
                        ) : partiallyApproved ? (
                          <Badge variant="outline" className="text-amber-600 border-amber-300 dark:border-amber-700">
                            {r.approvedWeeks}/{r.expectedWeeks} weeks
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">Pending</Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <table className="w-full text-sm hidden sm:table">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b">
                    <th className="py-2 pr-3">Member</th>
                    <th className="py-2 px-3 text-right">Active</th>
                    <th className="py-2 px-3 text-right">Breaks</th>
                    <th className="py-2 px-3 text-right">Billable</th>
                    <th className="py-2 px-3 text-right">Rate / hr</th>
                    <th className="py-2 px-3 text-right">Amount</th>
                    <th className="py-2 pl-3">Approval</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const fullyApproved = r.expectedWeeks > 0 && r.approvedWeeks >= r.expectedWeeks;
                    const partiallyApproved = r.approvedWeeks > 0 && !fullyApproved;
                    return (
                      <tr key={r.va_id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="py-2.5 pr-3">
                          <Link to="/admin/$vaId" params={{ vaId: r.va_id }} className="font-medium hover:underline">{r.name}</Link>
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums">{fmtDuration(r.active)}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-muted-foreground">{fmtDuration(r.breakSec)}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-medium">{fmtDuration(r.billable)}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums">
                          {r.rateCents > 0
                            ? (r.rateCents / 100).toLocaleString(undefined, { style: "currency", currency: r.currency })
                            : <span className="text-amber-600 dark:text-amber-500 text-xs">not set</span>}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-semibold">
                          {r.rateCents > 0
                            ? (r.amountCents / 100).toLocaleString(undefined, { style: "currency", currency: r.currency })
                            : "—"}
                        </td>
                        <td className="py-2.5 pl-3">
                          {r.expectedWeeks === 0 ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : fullyApproved ? (
                            <Badge variant="secondary" className="bg-success/15 text-success border-success/30">Approved</Badge>
                          ) : partiallyApproved ? (
                            <Badge variant="outline" className="text-amber-600 border-amber-300 dark:border-amber-700">
                              {r.approvedWeeks}/{r.expectedWeeks} weeks
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">Pending</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Billable hours = work-segment active time (Eastern-bucketed, breaks and idle excluded). Approval status reflects week-by-week sign-off in Timesheets — fully approved weeks are ready to pay.
      </p>
    </div>
  );
}
