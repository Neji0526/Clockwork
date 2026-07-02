import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { fmtSecHuman } from "@/lib/format";
import { Briefcase, FolderKanban, Coffee } from "lucide-react";
import {
  fetchSlices,
  tzDayStart,
  nextDay,
  todayLocal,
  REPORT_TZ,
  type Slice,
} from "@/lib/reporting";
import { formatInTimeZone } from "date-fns-tz";

export function ReportingPanel() {
  const [from, setFrom] = useState(todayLocal());
  const [to, setTo] = useState(todayLocal());
  const [vaId, setVaId] = useState<string>("__all__");

  const vasQ = useQuery({
    queryKey: ["reporting-vas"],
    queryFn: async () =>
      (await supabase
        .from("profiles")
        .select("user_id,display_name")
        .eq("role", "va")
        .order("display_name")).data ?? [],
    staleTime: 60_000,
  });

  const slicesQ = useQuery({
    queryKey: ["report-slices", from, to, vaId],
    queryFn: () => fetchSlices(from, to, vaId === "__all__" ? null : vaId),
    enabled: !!from && !!to && from <= to,
  });

  const clientsQ = useQuery({
    queryKey: ["clients-lookup"],
    queryFn: async () =>
      (await supabase.from("clients").select("id,name").order("name")).data ?? [],
    staleTime: 60_000,
  });
  const projectsQ = useQuery({
    queryKey: ["projects-lookup"],
    queryFn: async () =>
      (await supabase.from("projects").select("id,name,client_id").order("name")).data ?? [],
    staleTime: 60_000,
  });

  const clientName = useMemo(
    () => new Map((clientsQ.data ?? []).map((c) => [c.id, c.name])),
    [clientsQ.data],
  );
  const projectName = useMemo(
    () => new Map((projectsQ.data ?? []).map((p) => [p.id, p.name])),
    [projectsQ.data],
  );

  const slices = slicesQ.data ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Reporting</CardTitle>
          <p className="text-xs text-muted-foreground">
            Days are bucketed in {REPORT_TZ}. Segments crossing local midnight are pro-rated; per-day totals reconcile exactly to the segment total.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-4 items-end">
            <div className="space-y-1.5">
              <Label htmlFor="rep-from" className="text-xs">From</Label>
              <Input id="rep-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rep-to" className="text-xs">To</Label>
              <Input id="rep-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">Member</Label>
              <Select value={vaId} onValueChange={setVaId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All members</SelectItem>
                  {(vasQ.data ?? []).map((v) => (
                    <SelectItem key={v.user_id} value={v.user_id}>
                      {v.display_name ?? v.user_id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {slicesQ.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {slicesQ.error && <p className="text-sm text-destructive">{(slicesQ.error as Error).message}</p>}

      {slicesQ.data && (
        <>
          <ClientDayCard slices={slices} clientName={clientName} />
          <ProjectDayCard slices={slices} clientName={clientName} projectName={projectName} />
          <BreakLogCard from={from} to={to} vaId={vaId === "__all__" ? null : vaId} slices={slices} />
        </>
      )}
    </div>
  );
}

/* ---------- Client × Day ---------- */
function ClientDayCard({
  slices,
  clientName,
}: {
  slices: Slice[];
  clientName: Map<string, string>;
}) {
  const rows = useMemo(() => {
    const map = new Map<string, { day: string; client_id: string | null; active: number; idle: number }>();
    for (const s of slices) {
      if (s.kind !== "work") continue;
      const ck = s.client_id ?? "__none__";
      const key = `${s.local_day}::${ck}`;
      const r = map.get(key) ?? { day: s.local_day, client_id: s.client_id, active: 0, idle: 0 };
      r.active += s.active_sec;
      r.idle += s.idle_sec;
      map.set(key, r);
    }
    return Array.from(map.values()).sort(
      (a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : b.active - a.active),
    );
  }, [slices]);

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Briefcase className="size-4" /> Time per brand per day</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">No work segments in this range.</p></CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><Briefcase className="size-4" /> Time per brand per day</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="text-left py-2 pr-3 font-medium">Day</th>
                <th className="text-left py-2 pr-3 font-medium">Brand</th>
                <th className="text-right py-2 pr-3 font-medium">Active</th>
                <th className="text-right py-2 font-medium">Idle</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2 pr-3 tabular-nums">{r.day}</td>
                  <td className={`py-2 pr-3 ${r.client_id ? "" : "italic text-muted-foreground"}`}>
                    {r.client_id ? clientName.get(r.client_id) ?? "Unknown brand" : "Untagged"}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmtSecHuman(r.active)}</td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">{fmtSecHuman(r.idle)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- Project × Day with coverage ---------- */
function ProjectDayCard({
  slices,
  clientName,
  projectName,
}: {
  slices: Slice[];
  clientName: Map<string, string>;
  projectName: Map<string, string>;
}) {
  const { rows, coverage } = useMemo(() => {
    const map = new Map<string, { day: string; client_id: string | null; project_id: string; active: number }>();
    const dayTotal = new Map<string, number>();
    const dayTagged = new Map<string, number>();
    for (const s of slices) {
      if (s.kind !== "work") continue;
      dayTotal.set(s.local_day, (dayTotal.get(s.local_day) ?? 0) + s.active_sec);
      if (s.project_id) {
        dayTagged.set(s.local_day, (dayTagged.get(s.local_day) ?? 0) + s.active_sec);
        const key = `${s.local_day}::${s.project_id}`;
        const r = map.get(key) ?? { day: s.local_day, client_id: s.client_id, project_id: s.project_id, active: 0 };
        r.active += s.active_sec;
        map.set(key, r);
      }
    }
    const rows = Array.from(map.values()).sort(
      (a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : b.active - a.active),
    );
    const coverage = Array.from(dayTotal.entries())
      .map(([day, total]) => ({
        day,
        total,
        tagged: dayTagged.get(day) ?? 0,
        pct: total > 0 ? Math.round(((dayTagged.get(day) ?? 0) / total) * 100) : 0,
      }))
      .sort((a, b) => (a.day < b.day ? 1 : -1));
    return { rows, coverage };
  }, [slices]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><FolderKanban className="size-4" /> Time per project per day</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {coverage.length > 0 && (
          <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs flex flex-wrap gap-x-4 gap-y-1">
            <span className="text-muted-foreground uppercase tracking-wide">Project coverage</span>
            {coverage.map((c) => (
              <span key={c.day} className="tabular-nums">
                {c.day}: <strong>{c.pct}%</strong>{" "}
                <span className="text-muted-foreground">({fmtSecHuman(c.tagged)} of {fmtSecHuman(c.total)})</span>
              </span>
            ))}
          </div>
        )}

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No project-tagged work in this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="text-left py-2 pr-3 font-medium">Day</th>
                  <th className="text-left py-2 pr-3 font-medium">Project</th>
                  <th className="text-left py-2 pr-3 font-medium">Brand</th>
                  <th className="text-right py-2 font-medium">Active</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2 pr-3 tabular-nums">{r.day}</td>
                    <td className="py-2 pr-3">{projectName.get(r.project_id) ?? "Unknown project"}</td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {r.client_id ? clientName.get(r.client_id) ?? "—" : "—"}
                    </td>
                    <td className="py-2 text-right tabular-nums">{fmtSecHuman(r.active)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------- Break log ---------- */
type BreakRow = {
  id: string;
  va_id: string;
  session_id: string;
  started_at: string;
  ended_at: string | null;
  active_sec: number;
};

function BreakLogCard({
  from,
  to,
  vaId,
  slices,
}: {
  from: string;
  to: string;
  vaId: string | null;
  slices: Slice[];
}) {
  const breaksQ = useQuery({
    queryKey: ["report-breaks", from, to, vaId],
    queryFn: async () => {
      let q = supabase
        .from("session_segments")
        .select("id, va_id, session_id, started_at, ended_at, active_sec")
        .eq("kind", "break")
        .gte("started_at", tzDayStart(from))
        .lt("started_at", tzDayStart(nextDay(to)))
        .order("started_at", { ascending: false });
      if (vaId) q = q.eq("va_id", vaId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as BreakRow[];
    },
  });

  const vasQ = useQuery({
    queryKey: ["reporting-vas"],
    queryFn: async () =>
      (await supabase
        .from("profiles")
        .select("user_id,display_name")
        .eq("role", "va")
        .order("display_name")).data ?? [],
    staleTime: 60_000,
  });
  const vaName = useMemo(
    () => new Map((vasQ.data ?? []).map((v) => [v.user_id, v.display_name ?? v.user_id.slice(0, 8)])),
    [vasQ.data],
  );

  // Per-day break summary from slices (midnight-crossing breaks attribute correctly).
  const perDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of slices) {
      if (s.kind !== "break") continue;
      // Break "active_sec" is the share of break wall-time pro-rated to this day.
      m.set(s.local_day, (m.get(s.local_day) ?? 0) + s.active_sec);
    }
    return Array.from(m.entries()).sort(([a], [b]) => (a < b ? 1 : -1));
  }, [slices]);

  const rows = breaksQ.data ?? [];

  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><Coffee className="size-4" /> Break log</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {perDay.length > 0 && (
          <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs flex flex-wrap gap-x-4 gap-y-1">
            <span className="text-muted-foreground uppercase tracking-wide">Per-day total (pro-rated)</span>
            {perDay.map(([day, sec]) => (
              <span key={day} className="tabular-nums">{day}: <strong>{fmtSecHuman(sec)}</strong></span>
            ))}
          </div>
        )}
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No breaks in this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="text-left py-2 pr-3 font-medium">Started</th>
                  <th className="text-left py-2 pr-3 font-medium">Ended</th>
                  <th className="text-left py-2 pr-3 font-medium">Member</th>
                  <th className="text-right py-2 font-medium">Duration</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => {
                  const dur = b.ended_at
                    ? Math.max(0, Math.floor((new Date(b.ended_at).getTime() - new Date(b.started_at).getTime()) / 1000))
                    : null;
                  return (
                    <tr key={b.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 tabular-nums">
                        {formatInTimeZone(b.started_at, REPORT_TZ, "yyyy-MM-dd HH:mm")}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {b.ended_at ? formatInTimeZone(b.ended_at, REPORT_TZ, "yyyy-MM-dd HH:mm") : <Badge variant="secondary">open</Badge>}
                      </td>
                      <td className="py-2 pr-3">{vaName.get(b.va_id) ?? b.va_id.slice(0, 8)}</td>
                      <td className="py-2 text-right tabular-nums">{dur === null ? "—" : fmtSecHuman(dur)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
