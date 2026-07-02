import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { createSopFromSignature } from "@/lib/sops.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, BookOpen } from "lucide-react";
import { toast } from "sonner";

function relTime(iso: string) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/**
 * Admin signal queue: repeated click sequences captured from the team,
 * ready to be promoted into draft SOPs. Lifted from the old Team → Signatures
 * tab; lives as the second section of /sops alongside the Library.
 */
export function SignalsPanel() {
  const qc = useQueryClient();
  const createSop = useServerFn(createSopFromSignature);
  const [busyId, setBusyId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["admin-signatures"],
    queryFn: async () => {
      const { data: sigs, error } = await supabase
        .from("workflow_signatures")
        .select("id, va_id, signature, occurrence_count, last_seen_at, generated_sop_id")
        .order("occurrence_count", { ascending: false })
        .order("last_seen_at", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      const vaIds = Array.from(new Set((sigs ?? []).map(s => s.va_id)));
      const names = new Map<string, string>();
      if (vaIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", vaIds);
        for (const p of profs ?? []) names.set(p.user_id, p.display_name ?? "Member");
      }
      return (sigs ?? []).map(s => ({ ...s, va_name: names.get(s.va_id) ?? "Member" }));
    },
  });

  async function handleCreate(id: string) {
    setBusyId(id);
    try {
      const res = await createSop({ data: { signatureId: id } });
      toast.success(res.existed ? "SOP already exists" : "Draft SOP created");
      qc.invalidateQueries({ queryKey: ["admin-signatures"] });
      qc.invalidateQueries({ queryKey: ["sops-list"] });
      qc.invalidateQueries({ queryKey: ["sops-signals-count"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create SOP");
    } finally {
      setBusyId(null);
    }
  }

  function parseSig(sig: string) {
    const [path, labelsStr] = sig.split("::");
    const labels = (labelsStr ?? "").split("|").filter(Boolean);
    return { path, labels };
  }

  const totalOccurrences = (q.data ?? []).reduce((sum, s) => sum + (s.occurrence_count ?? 0), 0);
  const sopReadyCount = (q.data ?? []).filter(s => !s.generated_sop_id).length;

  const Hero = (
    <header className="surface-card relative overflow-hidden rounded-2xl p-6 md:p-8">
      <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
      <div className="relative z-10 flex items-end justify-between gap-6 flex-wrap">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground font-medium mb-2 inline-flex items-center gap-1.5">
            <Sparkles className="size-3 text-gold" /> Signatures
          </div>
          <h2 className="font-display text-3xl md:text-4xl xl:text-5xl leading-[1.04] tracking-tight text-foreground">
            Patterns becoming <span className="text-gold">playbooks.</span>
          </h2>
          <p className="mt-2 text-muted-foreground text-sm max-w-md">
            Repeated click sequences captured from your team. Turn any of them into a draft SOP in one click.
          </p>
        </div>
        {q.data && q.data.length > 0 && (
          <div className="flex items-center gap-5 shrink-0">
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Patterns</div>
              <div className="font-display text-2xl text-foreground tabular-nums">{q.data.length}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Occurrences</div>
              <div className="font-display text-2xl text-gold tabular-nums">{totalOccurrences}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Ready</div>
              <div className="font-display text-2xl text-foreground tabular-nums">{sopReadyCount}</div>
            </div>
          </div>
        )}
      </div>
    </header>
  );

  if (q.isLoading) {
    return (
      <div className="space-y-6">
        {Hero}
        <p className="text-sm text-muted-foreground">Loading signatures…</p>
      </div>
    );
  }
  if (!q.data?.length) {
    return (
      <div className="space-y-6">
        {Hero}
        <div className="surface-card py-14 text-center">
          <Sparkles className="size-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No repeated workflows captured yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Patterns appear here as your team repeats the same flows.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {Hero}
      <div className="grid gap-3">
        {q.data.map(s => {
          const { path, labels } = parseSig(s.signature);
          return (
            <div key={s.id} className="surface-card p-4 transition-colors hover:border-gold/30">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary">{s.va_name}</Badge>
                    <Badge className="bg-gold/15 text-gold border-gold/30 hover:bg-gold/20">{s.occurrence_count}× seen</Badge>
                    <span className="text-xs text-muted-foreground">last {relTime(s.last_seen_at)}</span>
                    {s.generated_sop_id && (
                      <Badge variant="outline" className="text-primary border-primary/30">
                        <BookOpen className="size-3 mr-1" /> SOP exists
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate font-mono">{path || "—"}</p>
                  <p className="text-sm line-clamp-2">{labels.slice(0, 8).join(" → ") || "no labels"}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {s.generated_sop_id ? (
                    <Button asChild variant="outline" size="sm">
                      <Link to="/sops">View SOP</Link>
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => handleCreate(s.id)}
                      disabled={busyId === s.id}
                      className="press"
                    >
                      <Sparkles className="size-4 mr-1" />
                      {busyId === s.id ? "Drafting…" : "Create draft SOP"}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
