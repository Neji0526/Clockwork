import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { listTeam } from "@/lib/admin.functions";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Search, ScrollText, ShieldCheck } from "lucide-react";

const AUDIT_ACTIONS = [
  "all",
  "session_adjusted",
  "sop_created_from_signature",
  "password_reset_requested",
  "password_reset_failed",
  "password_reset_rate_limited",
  "admin_invite_sent",
  "admin_invite_rate_limited",
] as const;

function actionTone(action: string): "default" | "secondary" | "destructive" | "outline" {
  if (action.includes("rate_limited") || action.includes("failed")) return "destructive";
  if (action.startsWith("password_reset")) return "secondary";
  if (action.startsWith("sop_")) return "outline";
  return "default";
}

/**
 * Filterable, searchable, realtime-subscribed view over admin_actions, with
 * CSV export and a Critical counter. Lifted from the old Team → Audit tab;
 * lives as a section of /admin/settings. Read-only — registers no save state.
 */
export function AuditLogPanel() {
  const [action, setAction] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [days, setDays] = useState<number>(7);
  const listTeamFn = useServerFn(listTeam);

  const team = useQuery({
    queryKey: ["admin-team"],
    queryFn: async () => await listTeamFn(),
  });

  const sinceISO = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString();
  }, [days]);

  const auditQ = useQuery({
    queryKey: ["admin-audit", action, sinceISO],
    queryFn: async () => {
      let query = supabase
        .from("admin_actions")
        .select("id, actor_id, action, target_user_id, target_email, metadata, ip_address, created_at")
        .gte("created_at", sinceISO)
        .order("created_at", { ascending: false })
        .limit(500);
      if (action !== "all") query = query.eq("action", action);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 30_000,
  });

  // Realtime: any new admin_actions row invalidates this view so the log
  // updates live while an admin is watching. Subscription tears down with
  // the panel (useEffect cleanup inside the hook).
  useRealtimeInvalidate("admin-audit", [
    { table: "admin_actions", event: "INSERT", invalidate: [["admin-audit"]] },
  ]);

  const nameById = useMemo(() => {
    const m = new Map<string, { name: string; email: string | null }>();
    for (const t of team.data ?? []) m.set(t.user_id, { name: t.display_name ?? "Unknown", email: t.email });
    return m;
  }, [team.data]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const base = auditQ.data ?? [];
    if (!needle) return base;
    return base.filter((r) => {
      const actor = r.actor_id ? nameById.get(r.actor_id) : null;
      const hay = [
        r.action,
        r.target_email ?? "",
        r.ip_address ?? "",
        actor?.name ?? "",
        actor?.email ?? "",
        JSON.stringify(r.metadata ?? {}),
      ].join(" ").toLowerCase();
      return hay.includes(needle);
    });
  }, [auditQ.data, search, nameById]);

  function exportCsv() {
    const header = ["created_at", "action", "actor", "actor_email", "target_email", "ip_address", "metadata"];
    const lines = [header.join(",")];
    for (const r of rows) {
      const actor = r.actor_id ? nameById.get(r.actor_id) : null;
      const cols = [
        r.created_at,
        r.action,
        actor?.name ?? "",
        actor?.email ?? "",
        r.target_email ?? "",
        r.ip_address ?? "",
        JSON.stringify(r.metadata ?? {}),
      ].map(v => `"${String(v).replace(/"/g, '""')}"`);
      lines.push(cols.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `audit-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const criticalCount = rows.filter(r => r.action.includes("rate_limited") || r.action.includes("failed")).length;
  const rangeLabel = days === 1 ? "Last 24 hours" : `Last ${days} days`;

  return (
    <div className="space-y-6">
      {/* Compact header + inline toolbar */}
      <header className="surface-card relative overflow-hidden rounded-xl px-4 py-2.5">
        <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="inline-flex items-center gap-2 min-w-0">
            <ShieldCheck className="size-3.5 text-gold/90 shrink-0" />
            <span className="text-[10px] uppercase tracking-[0.22em] text-gold/90 font-medium">Audit log</span>
            <span className="text-xs text-muted-foreground tabular-nums truncate hidden md:inline">· {rangeLabel}</span>
          </div>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger className="w-48 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {AUDIT_ACTIONS.map(a => (
                <SelectItem key={a} value={a}>{a === "all" ? "All actions" : a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Last 24h</SelectItem>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative flex-1 min-w-44">
            <Search className="size-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input placeholder="email, IP, actor, metadata…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 pl-8 text-xs" />
          </div>
          <div className="inline-flex items-center gap-4 ml-auto">
            <div className="text-right leading-tight">
              <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Events</div>
              <div className="font-display text-sm tabular-nums">{rows.length}</div>
            </div>
            <div className="text-right leading-tight">
              <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Critical</div>
              <div className={`font-display text-sm tabular-nums ${criticalCount > 0 ? "text-destructive" : "text-muted-foreground"}`}>{criticalCount}</div>
            </div>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length} className="h-8">
              <Download className="size-3.5 mr-1.5" />Export CSV
            </Button>
          </div>
        </div>
      </header>

      {/* Results */}
      <div className="surface-card p-0 overflow-hidden">
        {auditQ.isLoading ? (
          <p className="text-sm text-muted-foreground p-6">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="py-14 text-center">
            <ScrollText className="size-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No events match these filters.</p>
            <p className="text-xs text-muted-foreground mt-1">Try widening the range or clearing the search.</p>
          </div>
        ) : (
          <>
            {/* Mobile: card list */}
            <div className="sm:hidden divide-y divide-border">
              {rows.map(r => {
                const actor = r.actor_id ? nameById.get(r.actor_id) : null;
                return (
                  <div key={r.id} className="p-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant={actionTone(r.action)} className="font-normal">{r.action}</Badge>
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {new Date(r.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                      </span>
                    </div>
                    <div className="text-xs leading-tight">
                      {actor ? (
                        <>
                          <span className="text-muted-foreground">by </span>
                          <span>{actor.name}</span>
                          {actor.email && <span className="text-muted-foreground"> · {actor.email}</span>}
                        </>
                      ) : (
                        <span className="text-muted-foreground">system</span>
                      )}
                    </div>
                    {(r.target_email || r.target_user_id) && (
                      <div className="text-xs text-muted-foreground">
                        → {r.target_email ?? (r.target_user_id ? nameById.get(r.target_user_id)?.name ?? r.target_user_id.slice(0, 8) : "")}
                      </div>
                    )}
                    {r.ip_address && <div className="text-[11px] text-muted-foreground tabular-nums">IP {r.ip_address}</div>}
                    {r.metadata && Object.keys(r.metadata).length > 0 && (
                      <code className="block text-[11px] text-muted-foreground break-all">
                        {JSON.stringify(r.metadata)}
                      </code>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Desktop: table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2.5 font-medium">When</th>
                    <th className="text-left px-3 py-2.5 font-medium">Action</th>
                    <th className="text-left px-3 py-2.5 font-medium">Actor</th>
                    <th className="text-left px-3 py-2.5 font-medium">Target</th>
                    <th className="text-left px-3 py-2.5 font-medium">IP</th>
                    <th className="text-left px-3 py-2.5 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map(r => {
                    const actor = r.actor_id ? nameById.get(r.actor_id) : null;
                    return (
                      <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                          {new Date(r.created_at).toLocaleString()}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant={actionTone(r.action)} className="font-normal">{r.action}</Badge>
                        </td>
                        <td className="px-3 py-2">
                          {actor ? (
                            <div className="leading-tight">
                              <div>{actor.name}</div>
                              {actor.email && <div className="text-xs text-muted-foreground">{actor.email}</div>}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">system</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {r.target_email ?? (r.target_user_id ? nameById.get(r.target_user_id)?.name ?? r.target_user_id.slice(0, 8) : "—")}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">{r.ip_address ?? "—"}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground max-w-md">
                          <code className="block truncate" title={JSON.stringify(r.metadata)}>
                            {r.metadata && Object.keys(r.metadata).length ? JSON.stringify(r.metadata) : "—"}
                          </code>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Showing {rows.length} of up to 500 events.</p>
    </div>
  );
}
