import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScreenshotLightbox } from "@/components/screenshot-lightbox";
import { fmtDuration, hostOf } from "@/lib/format";
import { PlatformChip } from "@/components/platform-chip";
import { ListOrdered, MousePointerClick, Globe, Download, ArrowUpDown, Image as ImageIcon, AppWindow } from "lucide-react";

const ROW_CAP = 1000;

type Activity = { app: string | null; title: string | null; url: string | null; started_at: string; duration_sec: number | null; session_id: string | null; platform: string | null; source: string | null };
type Step = { id: string; label: string | null; url: string | null; screenshot_path: string | null; created_at: string; session_id: string | null; step_index: number; platform: string | null; source: string | null };
type Session = { id: string; started_at: string; ended_at: string | null };

type FeedItem =
  | { kind: "visit"; ts: number; host: string; title: string; durationSec: number; url: string | null; app: string | null; sessionId: string | null; platform: string; source: string; key: string }
  | { kind: "click"; ts: number; host: string; label: string; url: string | null; screenshotPath: string | null; sessionId: string | null; platform: string; source: string; key: string };

type SourceFilter = "all" | "extension" | "desktop";

function toLocalDateInput(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function dayBoundsISO(yyyyMmDd: string) {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const start = new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
  const end = new Date(y, (m ?? 1) - 1, d ?? 1, 23, 59, 59, 999);
  return { startISO: start.toISOString(), endISO: end.toISOString(), startMs: start.getTime(), endMs: end.getTime() };
}

export function VaActivityLog({ vaId }: { vaId: string }) {
  const today = toLocalDateInput(new Date());
  const minDate = toLocalDateInput(new Date(Date.now() - 30 * 86_400_000));
  const [day, setDay] = useState(today);
  const [order, setOrder] = useState<"desc" | "asc">("desc");
  const [zoomPath, setZoomPath] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  const { startISO, endISO, startMs, endMs: _endMs } = useMemo(() => dayBoundsISO(day), [day]);

  const q = useQuery({
    queryKey: ["va-activity-log", vaId, day],
    queryFn: async () => {
      const [acts, steps, sess] = await Promise.all([
        supabase.from("activity_events")
          .select("app, title, url, started_at, duration_sec, session_id, platform, source")
          .eq("va_id", vaId)
          .gte("started_at", startISO).lte("started_at", endISO)
          .order("started_at", { ascending: false })
          .limit(ROW_CAP),
        supabase.from("workflow_steps")
          .select("id, label, url, screenshot_path, created_at, session_id, step_index, platform, source")
          .eq("va_id", vaId)
          .gte("created_at", startISO).lte("created_at", endISO)
          .order("created_at", { ascending: false })
          .limit(ROW_CAP),
        supabase.from("work_sessions")
          .select("id, started_at, ended_at")
          .eq("va_id", vaId)
          .gte("started_at", new Date(startMs - 86_400_000).toISOString())
          .lte("started_at", endISO),
      ]);
      return {
        activity: (acts.data ?? []) as Activity[],
        steps: (steps.data ?? []) as Step[],
        sessions: (sess.data ?? []) as Session[],
      };
    },
  });

  const { items, truncated } = useMemo(() => {
    const list: FeedItem[] = [];
    for (const a of q.data?.activity ?? []) {
      const src = a.source ?? "extension";
      if (sourceFilter !== "all" && src !== sourceFilter) continue;
      const host = hostOf(a.url) || a.app || "Unknown";
      list.push({
        kind: "visit",
        ts: new Date(a.started_at).getTime(),
        host,
        title: a.title || a.url || a.app || "—",
        durationSec: a.duration_sec ?? 0,
        url: a.url,
        app: a.app,
        sessionId: a.session_id,
        platform: a.platform ?? "chrome",
        source: src,
        key: `v:${a.started_at}:${a.url ?? a.app ?? ""}`,
      });
    }
    for (const s of q.data?.steps ?? []) {
      const src = s.source ?? "extension";
      if (sourceFilter !== "all" && src !== sourceFilter) continue;
      list.push({
        kind: "click",
        ts: new Date(s.created_at).getTime(),
        host: hostOf(s.url) || "—",
        label: s.label || "(unlabeled click)",
        url: s.url,
        screenshotPath: s.screenshot_path,
        sessionId: s.session_id,
        platform: s.platform ?? "chrome",
        source: src,
        key: `c:${s.id}`,
      });
    }
    list.sort((a, b) => b.ts - a.ts);
    const collapsed: FeedItem[] = [];
    for (const it of list) {
      const last = collapsed[collapsed.length - 1];
      if (
        last && last.kind === "visit" && it.kind === "visit" &&
        last.url && it.url && last.url === it.url
      ) {
        last.durationSec += it.durationSec;
        last.ts = Math.min(last.ts, it.ts);
        continue;
      }
      collapsed.push({ ...it });
    }
    if (order === "asc") collapsed.sort((a, b) => a.ts - b.ts);
    const totalRaw = (q.data?.activity.length ?? 0) + (q.data?.steps.length ?? 0);
    return { items: collapsed, truncated: totalRaw >= ROW_CAP * 2 || (q.data?.activity.length ?? 0) >= ROW_CAP || (q.data?.steps.length ?? 0) >= ROW_CAP };
  }, [q.data, order, sourceFilter]);

  const sessionsById = useMemo(() => {
    const m = new Map<string, Session>();
    for (const s of q.data?.sessions ?? []) m.set(s.id, s);
    return m;
  }, [q.data]);

  function exportCsv() {
    const header = ["time", "type", "source", "platform", "host_or_app", "title_or_label", "url", "duration_sec"];
    const lines = [header.join(",")];
    const escape = (v: unknown) => {
      const s = v == null ? "" : String(v);
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    for (const it of items) {
      const time = new Date(it.ts).toISOString();
      if (it.kind === "visit") {
        lines.push([escape(time), "visit", escape(it.source), escape(it.platform), escape(it.host), escape(it.title), escape(it.url ?? ""), escape(it.durationSec)].join(","));
      } else {
        lines.push([escape(time), "click", escape(it.source), escape(it.platform), escape(it.host), escape(it.label), escape(it.url ?? ""), escape("")].join(","));
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `activity-${vaId.slice(0, 8)}-${day}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  const groups = useMemo(() => {
    const out: { sessionId: string | null; items: FeedItem[] }[] = [];
    for (const it of items) {
      const last = out[out.length - 1];
      if (last && last.sessionId === it.sessionId) last.items.push(it);
      else out.push({ sessionId: it.sessionId, items: [it] });
    }
    return out;
  }, [items]);

  const prettyDate = useMemo(() => {
    const [y, m, d] = day.split("-").map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  }, [day]);

  const FilterBtn = ({ v, children }: { v: SourceFilter; children: React.ReactNode }) => (
    <Button
      size="sm"
      variant={sourceFilter === v ? "default" : "outline"}
      onClick={() => setSourceFilter(v)}
      className="h-8"
    >
      {children}
    </Button>
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><ListOrdered className="size-4" />Activity log</CardTitle>
        <p className="text-xs text-muted-foreground">Every site visited and action taken, in order.</p>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <Input
            type="date"
            value={day}
            min={minDate}
            max={today}
            onChange={(e) => setDay(e.target.value || today)}
            className="h-8 w-[160px]"
          />
          <div className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/30 p-0.5">
            <FilterBtn v="all">All</FilterBtn>
            <FilterBtn v="extension">Browser</FilterBtn>
            <FilterBtn v="desktop">Desktop</FilterBtn>
          </div>
          <Button size="sm" variant="outline" onClick={() => setOrder(o => o === "desc" ? "asc" : "desc")} className="h-8">
            <ArrowUpDown className="size-3.5 mr-1.5" />
            {order === "desc" ? "Newest first" : "Oldest first"}
          </Button>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={items.length === 0} className="h-8">
            <Download className="size-3.5 mr-1.5" />Export CSV
          </Button>
          <span className="text-[11px] text-muted-foreground ml-auto tabular-nums">
            {q.isLoading ? "Loading…" : `${items.length} row${items.length === 1 ? "" : "s"}`}
            {truncated && <span className="text-warning ml-1">· truncated at {ROW_CAP}</span>}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-10 rounded bg-muted/40 animate-pulse" />)}</div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No recorded activity for {prettyDate}.</p>
        ) : (
          <div className="space-y-5 max-h-[640px] overflow-y-auto pr-1">
            {groups.map((g, gi) => {
              const sess = g.sessionId ? sessionsById.get(g.sessionId) : null;
              const start = sess ? new Date(sess.started_at) : null;
              const end = sess?.ended_at ? new Date(sess.ended_at) : null;
              return (
                <div key={`${g.sessionId ?? "none"}:${gi}`} className="space-y-1.5">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground border-b border-border pb-1">
                    <span>Session</span>
                    {start ? (
                      <span className="tabular-nums">
                        {start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                        {" → "}
                        {end ? end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : <span className="text-success">live</span>}
                      </span>
                    ) : (
                      <span>Unlinked</span>
                    )}
                  </div>
                  <ol className="space-y-1">
                    {g.items.map(it => (
                      <FeedRow key={it.key} item={it} onOpenShot={(p) => setZoomPath(p)} />
                    ))}
                  </ol>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
      {zoomPath && <ScreenshotLightbox path={zoomPath} onClose={() => setZoomPath(null)} />}
    </Card>
  );
}

function FeedRow({ item, onOpenShot }: { item: FeedItem; onOpenShot: (p: string) => void }) {
  const time = new Date(item.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  if (item.kind === "visit") {
    const isNativeApp = !item.url; // desktop agent activity rows don't carry a URL
    const Icon = isNativeApp ? AppWindow : Globe;
    return (
      <li className="grid grid-cols-[68px_20px_1fr_auto] items-start gap-2 text-sm py-1 px-1 rounded hover:bg-muted/40">
        <span className="text-[11px] tabular-nums text-muted-foreground pt-0.5">{time}</span>
        <Icon className="size-4 text-muted-foreground mt-0.5" />
        <div className="min-w-0">
          <div className="font-medium truncate flex items-center gap-2">
            <span className="truncate">{isNativeApp ? (item.app || item.host) : item.host}</span>
            <PlatformChip row={{ source: item.source, platform: item.platform }} size="xs" />
          </div>
          <div className="text-xs text-muted-foreground truncate">{item.title}</div>
        </div>
        <span className="text-[11px] tabular-nums text-muted-foreground pt-0.5">{fmtDuration(item.durationSec)}</span>
      </li>
    );
  }
  const clickable = !!item.screenshotPath;
  return (
    <li
      className={`grid grid-cols-[68px_20px_1fr_auto] items-start gap-2 text-sm py-1 px-1 rounded ${clickable ? "hover:bg-muted/60 cursor-zoom-in" : "hover:bg-muted/40"}`}
      onClick={() => { if (item.screenshotPath) onOpenShot(item.screenshotPath); }}
      role={clickable ? "button" : undefined}
    >
      <span className="text-[11px] tabular-nums text-muted-foreground pt-0.5">{time}</span>
      <MousePointerClick className="size-4 text-gold mt-0.5" />
      <div className="min-w-0">
        <div className="truncate">
          <span className="text-muted-foreground">clicked</span>{" "}
          <span className="font-medium">"{item.label}"</span>
          {item.host !== "—" && <span className="text-muted-foreground"> on <span className="text-foreground/80">{item.host}</span></span>}
        </div>
        <div className="mt-0.5"><PlatformChip row={{ source: item.source, platform: item.platform }} size="xs" /></div>
      </div>
      {clickable && <Badge variant="outline" className="text-[10px] gap-1"><ImageIcon className="size-3" />shot</Badge>}
    </li>
  );
}
