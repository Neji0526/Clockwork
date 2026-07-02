import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Activity, Plus, Trash2 } from "lucide-react";
import { fmtDuration } from "@/lib/format";
import { useProductivityRules } from "@/hooks/use-productivity";
import { classify, keyOf, ratingColor, type Rating } from "@/lib/productivity";

/**
 * Productivity rules CRUD + quick-classify of recently-observed hosts.
 * Lifted from the old Team → Productivity tab; lives as a section of
 * /admin/settings. Saves are per-row immediate writes (no dirty-bar
 * registration — every edit is a separate request).
 */
export function ProductivityRulesPanel() {
  const qc = useQueryClient();
  const rulesQ = useProductivityRules();
  const [newPattern, setNewPattern] = useState("");
  const [newRating, setNewRating] = useState<Rating>("productive");

  // Top observed hosts/apps across the last 14 days, regardless of VA.
  const obsQ = useQuery({
    queryKey: ["productivity-observed-14d"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 14 * 86400_000).toISOString();
      const { data } = await supabase
        .from("activity_events")
        .select("app, url, duration_sec")
        .gte("started_at", since)
        .limit(5000);
      const m = new Map<string, number>();
      for (const e of data ?? []) {
        const k = keyOf(e);
        if (!k) continue;
        m.set(k, (m.get(k) ?? 0) + (e.duration_sec ?? 0));
      }
      return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
    },
  });

  async function addRule(pattern: string, rating: Rating) {
    const p = pattern.trim();
    if (!p) return;
    const { data: u } = await supabase.auth.getUser();
    const { error } = await (supabase as any).from("productivity_rules").insert({
      pattern: p, rating, created_by: u.user?.id ?? null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`Rule added · ${p} → ${rating}`);
    setNewPattern("");
    qc.invalidateQueries({ queryKey: ["productivity-rules"] });
    qc.invalidateQueries({ queryKey: ["productivity-observed-14d"] });
    qc.invalidateQueries({ queryKey: ["team-productivity-today"] });
  }

  async function updateRule(id: string, rating: Rating) {
    const { error } = await (supabase as any).from("productivity_rules").update({ rating }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["productivity-rules"] });
    qc.invalidateQueries({ queryKey: ["team-productivity-today"] });
  }

  async function deleteRule(id: string) {
    const { error } = await (supabase as any).from("productivity_rules").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Rule removed");
    qc.invalidateQueries({ queryKey: ["productivity-rules"] });
    qc.invalidateQueries({ queryKey: ["team-productivity-today"] });
  }

  const rules = rulesQ.data ?? [];
  const observed = obsQ.data ?? [];
  const unclassified = useMemo(
    () => observed.filter(([k]) => classify(k, rules) === "neutral"
      && !rules.some(r => r.pattern.toLowerCase() === k)).slice(0, 12),
    [observed, rules],
  );

  return (
    <div className="space-y-6">
      <header className="surface-card relative overflow-hidden rounded-2xl p-6 md:p-8">
        <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
        <div className="relative z-10">
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground font-medium mb-2 inline-flex items-center gap-1.5">
            <Activity className="size-3 text-gold" /> Productivity rules
          </div>
          <h2 className="font-display text-3xl md:text-4xl leading-tight text-foreground">Classify the <span className="text-gold">tools.</span></h2>
          <p className="mt-2 text-muted-foreground text-sm max-w-md">
            Tag the hosts and apps your team uses as productive, unproductive, or neutral. Anything unmatched defaults to neutral.
          </p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Rules list */}
        <div className="surface-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg">Rules</h3>
            <span className="text-xs text-muted-foreground tabular-nums">{rules.length} total</span>
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); addRule(newPattern, newRating); }}
            className="flex flex-col sm:flex-row gap-2"
          >
            <Input
              placeholder="e.g. github.com or *.slack.com"
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              className="flex-1"
            />
            <Select value={newRating} onValueChange={(v) => setNewRating(v as Rating)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="productive">Productive</SelectItem>
                <SelectItem value="unproductive">Unproductive</SelectItem>
                <SelectItem value="neutral">Neutral</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" disabled={!newPattern.trim()}><Plus className="size-4 mr-1.5" />Add</Button>
          </form>
          <div className="divide-y divide-border border border-border rounded-lg">
            {rules.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No rules yet.</div>
            ) : rules.map((r) => {
              const c = ratingColor(r.rating);
              return (
                <div key={r.id} className="px-3 py-2 flex items-center gap-2">
                  <span className={`size-1.5 rounded-full ${c.dot}`} />
                  <code className="text-xs flex-1 truncate">{r.pattern}</code>
                  <Select value={r.rating} onValueChange={(v) => updateRule(r.id!, v as Rating)}>
                    <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="productive">Productive</SelectItem>
                      <SelectItem value="unproductive">Unproductive</SelectItem>
                      <SelectItem value="neutral">Neutral</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="icon" className="size-8" onClick={() => deleteRule(r.id!)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Quick classify */}
        <div className="surface-card p-5 space-y-4">
          <div>
            <h3 className="font-display text-lg">Quick classify</h3>
            <p className="text-xs text-muted-foreground">Top observed hosts (last 14 days) that don't match any rule.</p>
          </div>
          {obsQ.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : unclassified.length === 0 ? (
            <div className="text-sm text-muted-foreground">Nothing left to classify — every observed host already has a rule.</div>
          ) : (
            <div className="divide-y divide-border border border-border rounded-lg">
              {unclassified.map(([k, sec]) => (
                <div key={k} className="px-3 py-2 flex items-center gap-2">
                  <code className="text-xs flex-1 truncate">{k}</code>
                  <span className="text-[11px] text-muted-foreground tabular-nums">{fmtDuration(sec)}</span>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" className="h-7 text-xs text-emerald-600" onClick={() => addRule(k, "productive")}>Productive</Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs text-rose-600" onClick={() => addRule(k, "unproductive")}>Unproductive</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => addRule(k, "neutral")}>Neutral</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
