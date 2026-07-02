import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { RequireAuth } from "@/components/require-auth";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  ArrowLeft, ArrowRight, BookOpen, Image as ImageIcon, Link as LinkIcon,
  Check, Play, Pause, Maximize2, Minimize2, Keyboard, ZoomIn, X, CheckCircle2,
  MessageSquare, Trash2, HelpCircle, Pin, Sparkles, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { z } from "zod";
import { suggestSopAutomation } from "@/lib/sops.functions";

type ClickRect = { x: number; y: number; w: number; h: number };
type Viewport = { w: number; h: number };
type Step = {
  index?: number;
  instruction: string;
  screenshot_path?: string | null;
  rect?: ClickRect | null;
  viewport?: Viewport | null;
  dpr?: number | null;
};
type Sop = {
  id: string; title: string; description: string | null;
  steps: Step[]; status: "auto" | "reviewed" | "archived";
  source: string; created_at: string;
};

const searchSchema = z.object({
  step: z.coerce.number().int().min(1).optional(),
});

export const Route = createFileRoute("/sops/$sopId")({
  head: () => ({ meta: [{ title: "SOP walkthrough — ClockWork" }] }),
  validateSearch: searchSchema,
  component: () => (
    <RequireAuth><AppShell><SopPlayback /></AppShell></RequireAuth>
  ),
});

const AUTO_ADVANCE_MS = 7000;

function SopPlayback() {
  const { sopId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [autoOpen, setAutoOpen] = useState(false);
  const suggestFn = useServerFn(suggestSopAutomation);
  const suggestM = useMutation({
    mutationFn: (sopId: string) => suggestFn({ data: { sopId } }),
    onError: (e: Error) => toast.error(e.message),
  });

  // Step index is URL-driven (?step=N is 1-based). Default 0.
  const i = Math.max(0, (search.step ?? 1) - 1);
  const setI = useCallback(
    (next: number | ((v: number) => number)) => {
      const resolved = typeof next === "function" ? next(i) : next;
      navigate({
        to: "/sops/$sopId",
        params: { sopId },
        search: { step: resolved + 1 },
        replace: true,
      });
    },
    [i, navigate, sopId],
  );

  const [auto, setAuto] = useState(false);
  const [cinema, setCinema] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [autoTick, setAutoTick] = useState(0); // 0..100 progress

  const sopQ = useQuery({
    queryKey: ["sop", sopId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sops")
        .select("id, title, description, steps, status, source, created_at")
        .eq("id", sopId)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as Sop | null;
    },
  });

  // Has the current user already completed this SOP?
  const completionQ = useQuery({
    queryKey: ["sop-completion", sopId, user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sop_completions")
        .select("id, completed_at")
        .eq("sop_id", sopId)
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });

  const sop = sopQ.data;
  const steps = sop?.steps ?? [];
  const total = steps.length;
  const current = steps[i];

  const next = useCallback(
    () => setI((v) => Math.min(v + 1, Math.max(total - 1, 0))),
    [setI, total],
  );
  const prev = useCallback(() => setI((v) => Math.max(v - 1, 0)), [setI]);

  // Reset auto progress whenever step changes
  useEffect(() => { setAutoTick(0); }, [i]);

  // Auto-advance
  useEffect(() => {
    if (!auto || total === 0) return;
    if (i >= total - 1) { setAuto(false); return; }
    const start = Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min(100, (elapsed / AUTO_ADVANCE_MS) * 100);
      setAutoTick(pct);
      if (elapsed >= AUTO_ADVANCE_MS) {
        clearInterval(id);
        next();
      }
    }, 50);
    return () => clearInterval(id);
  }, [auto, i, total, next]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (zoom) {
        if (e.key === "Escape") { e.preventDefault(); setZoom(false); }
        return;
      }
      if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
      else if (e.key === " " || e.code === "Space") { e.preventDefault(); setAuto(a => !a); }
      else if (e.key.toLowerCase() === "f") { e.preventDefault(); setCinema(c => !c); }
      else if (e.key.toLowerCase() === "z") { e.preventDefault(); setZoom(true); }
      else if (e.key === "Escape" && cinema) { setCinema(false); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, cinema, zoom]);

  if (sopQ.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading walkthrough…</div>;
  }
  if (!sop) {
    return (
      <Card><CardContent className="py-12 text-center space-y-3">
        <BookOpen className="size-8 text-muted-foreground mx-auto" />
        <p className="text-sm text-muted-foreground">This SOP couldn't be found.</p>
        <Button variant="outline" onClick={() => navigate({ to: "/sops" })}>Back to library</Button>
      </CardContent></Card>
    );
  }

  const pct = total > 0 ? Math.round(((i + 1) / total) * 100) : 0;
  const done = total > 0 && i >= total - 1;
  const followed = !!completionQ.data;

  function copyLink(includeStep: boolean) {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.search = "";
    if (includeStep) url.searchParams.set("step", String(i + 1));
    navigator.clipboard.writeText(url.toString()).then(
      () => toast.success(includeStep ? `Step ${i + 1} link copied` : "Link copied"),
      () => toast.error("Copy failed"),
    );
  }

  async function markFollowed() {
    if (!user?.id) return;
    const { error } = await supabase
      .from("sop_completions")
      .upsert(
        { sop_id: sopId, user_id: user.id, completed_at: new Date().toISOString() },
        { onConflict: "sop_id,user_id" },
      );
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Marked as followed");
    qc.invalidateQueries({ queryKey: ["sop-completion", sopId, user.id] });
    qc.invalidateQueries({ queryKey: ["sops-list"] });
  }

  // Cinema mode: full-bleed dark theater
  if (cinema) {
    return (
      <>
        <div className="fixed inset-0 z-[80] bg-[oklch(0.12_0.018_240)] text-white flex flex-col">
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.22em] text-white/50">ClockWork · SOP</div>
              <div className="font-display text-lg truncate">{sop.title}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/60 tabular-nums">{i + 1} / {total}</span>
              <Button variant="ghost" size="sm" onClick={() => setAuto(a => !a)} className="text-white hover:bg-white/10">
                {auto ? <Pause className="size-4" /> : <Play className="size-4" />}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => copyLink(true)} className="text-white hover:bg-white/10" title="Copy link to this step">
                <LinkIcon className="size-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setCinema(false)} className="text-white hover:bg-white/10">
                <Minimize2 className="size-4" />
              </Button>
            </div>
          </div>

          <div className="flex-1 grid place-items-center p-6 overflow-hidden">
            <div className="w-full max-w-6xl space-y-5">
              {current?.screenshot_path ? (
                <button
                  type="button"
                  onClick={() => setZoom(true)}
                  className="block w-full group cursor-zoom-in"
                  title="Click to zoom (Z)"
                >
                  <CinemaScreenshot path={current.screenshot_path} stepKey={i} rect={current.rect ?? null} viewport={current.viewport ?? null} />
                </button>
              ) : (
                <div className="aspect-video w-full rounded-xl bg-white/5 grid place-items-center text-white/40 text-sm">
                  <span className="inline-flex items-center gap-2"><ImageIcon className="size-4" />No screenshot for this step</span>
                </div>
              )}
              <div key={i} className="flex items-start gap-3 animate-[fadeUp_0.4s_ease-out_both]">
                <div className="size-9 rounded-full ring-1 ring-[var(--color-gold)]/60 bg-[var(--color-gold)]/15 text-[var(--color-gold)] grid place-items-center text-sm font-medium shrink-0 font-display">
                  {current?.index ?? i + 1}
                </div>
                <p className="font-display text-2xl md:text-3xl leading-snug text-white/95 max-w-4xl">
                  {current?.instruction}
                </p>
              </div>
            </div>
          </div>

          <div className="px-5 pb-4 space-y-3">
            <div className="flex gap-1">
              {steps.map((_, idx) => {
                const isCurrent = idx === i;
                const past = idx < i;
                const fillW = isCurrent ? (auto ? autoTick : 100) : past ? 100 : 0;
                return (
                  <button
                    key={idx}
                    onClick={() => setI(idx)}
                    aria-label={`Step ${idx + 1}`}
                    className="flex-1 h-[3px] rounded-full bg-white/15 overflow-hidden relative group"
                  >
                    <span
                      style={{ width: `${fillW}%` }}
                      className={`absolute inset-y-0 left-0 transition-[width] ${isCurrent && auto ? "duration-100" : "duration-300"} bg-[var(--color-gold)] group-hover:bg-white`}
                    />
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={prev} disabled={i === 0} className="text-white hover:bg-white/10 disabled:opacity-30">
                <ArrowLeft className="size-4 mr-1.5" />Previous
              </Button>
              <div className="hidden sm:flex items-center gap-3 text-[11px] text-white/50">
                <Keyboard className="size-3.5" />
                <span>← →</span><span>·</span><span>Space</span><span>·</span><span>Z zoom</span><span>·</span><span>F/Esc exit</span>
              </div>
              {done ? (
                <div className="flex items-center gap-2">
                  {!followed && (
                    <Button size="sm" variant="outline" onClick={markFollowed} className="border-white/20 text-white hover:bg-white/10">
                      <CheckCircle2 className="size-4 mr-1.5" />Mark as followed
                    </Button>
                  )}
                  <Button size="sm" onClick={() => { setCinema(false); navigate({ to: "/sops" }); }} className="bg-[var(--color-gold)] text-black hover:bg-[var(--color-gold)]/90">
                    <Check className="size-4 mr-1.5" />Finish
                  </Button>
                </div>
              ) : (
                <Button size="sm" onClick={next} className="bg-white text-black hover:bg-white/90">
                  Next<ArrowRight className="size-4 ml-1.5" />
                </Button>
              )}
            </div>
          </div>
          <style>{`
            @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
          `}</style>
        </div>
        {zoom && current?.screenshot_path && (
          <Lightbox path={current.screenshot_path} stepKey={i} rect={current.rect ?? null} viewport={current.viewport ?? null} onClose={() => setZoom(false)} />
        )}
      </>
    );
  }

  return (
    <>
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <Link to="/sops" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> SOP library
        </Link>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => setAuto(a => !a)}>
            {auto ? <Pause className="size-4 mr-1.5" /> : <Play className="size-4 mr-1.5" />}
            {auto ? "Pause" : "Auto-play"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCinema(true)}>
            <Maximize2 className="size-4 mr-1.5" />Cinema
          </Button>
          <Button variant="ghost" size="sm" onClick={() => copyLink(true)} title="Copy link to this step">
            <LinkIcon className="size-4 mr-1.5" />Share step
          </Button>
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setAutoOpen(true);
                if (!suggestM.data && !suggestM.isPending) suggestM.mutate(sopId);
              }}
              title="Ask AI how to automate this SOP (admin only)"
              className="border-gold/50 text-gold hover:bg-gold/10 hover:text-gold"
            >
              <Sparkles className="size-4 mr-1.5" />Suggest automation
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-[0.22em] text-gold/90 font-medium">Walkthrough</div>
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-display text-3xl md:text-5xl leading-[1.02]">{sop.title}</h1>
          <div className="flex items-center gap-2 shrink-0">
            {followed && (
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-3 mr-1" />Followed
              </Badge>
            )}
            <Badge variant={sop.status === "reviewed" ? "default" : "secondary"}>{sop.status}</Badge>
          </div>
        </div>
        {sop.description && <p className="text-sm text-muted-foreground max-w-2xl">{sop.description}</p>}
      </div>

      {total === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
          This SOP has no steps yet.
        </CardContent></Card>
      ) : (
        <>
          {/* Progress hairline */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              <span>Step {i + 1} of {total}</span>
              <span className="tabular-nums">{pct}%</span>
            </div>
            <div className="h-[2px] bg-muted/60 rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--color-gold)] transition-[width] duration-500 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {/* Stage */}
          <div className="relative rounded-2xl border border-border bg-card shadow-elevated overflow-hidden">
            {current?.screenshot_path ? (
              <button
                type="button"
                onClick={() => setZoom(true)}
                className="block w-full text-left cursor-zoom-in group"
                title="Click to zoom (Z)"
              >
                <StageScreenshot path={current.screenshot_path} stepKey={i} rect={current.rect ?? null} viewport={current.viewport ?? null} />
                <span className="absolute top-3 right-3 z-10 inline-flex items-center gap-1 rounded-md bg-black/55 text-white text-[11px] px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <ZoomIn className="size-3.5" /> Zoom
                </span>
              </button>
            ) : (
              <div className="aspect-video w-full bg-muted grid place-items-center text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-2"><ImageIcon className="size-4" />No screenshot for this step</span>
              </div>
            )}
            <div key={`txt-${i}`} className="p-6 border-t border-border flex items-start gap-3 animate-[fadeUp_0.35s_ease-out_both]">
              <div className="size-9 rounded-full ring-1 ring-gold/40 bg-gold/10 text-foreground grid place-items-center text-sm font-medium shrink-0 font-display">
                {current?.index ?? i + 1}
              </div>
              <p className="font-display text-xl md:text-2xl leading-snug flex-1">{current?.instruction}</p>
            </div>
          </div>

          {/* Auto-advance progress (when playing) */}
          {auto && (
            <div className="h-[2px] -mt-3 bg-muted/40 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary/70"
                style={{ width: `${autoTick}%`, transition: "width 100ms linear" }}
              />
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <Button variant="outline" onClick={prev} disabled={i === 0}>
              <ArrowLeft className="size-4 mr-1.5" />Previous
            </Button>
            <div className="hidden sm:flex items-center gap-2 text-[11px] text-muted-foreground">
              <Keyboard className="size-3.5" />← → · Space · Z zoom · F cinema
            </div>
            {done ? (
              <div className="flex items-center gap-2">
                {!followed ? (
                  <Button onClick={markFollowed}>
                    <CheckCircle2 className="size-4 mr-1.5" />Mark as followed
                  </Button>
                ) : (
                  <Button onClick={() => navigate({ to: "/sops" })}>
                    <Check className="size-4 mr-1.5" />Finish
                  </Button>
                )}
              </div>
            ) : (
              <Button onClick={next}>
                Next<ArrowRight className="size-4 ml-1.5" />
              </Button>
            )}
          </div>

          {/* Film strip */}
          <div className="pt-1">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Steps</div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {steps.map((s, idx) => (
                <button
                  key={idx}
                  onClick={() => setI(idx)}
                  aria-label={`Go to step ${idx + 1}`}
                  className={`group relative shrink-0 w-20 h-12 rounded-md border overflow-hidden transition-all duration-200 ${
                    idx === i
                      ? "border-gold ring-2 ring-gold/30 scale-[1.04]"
                      : idx < i
                        ? "border-primary/40 opacity-70 hover:opacity-100"
                        : "border-border opacity-60 hover:opacity-100"
                  }`}
                  title={`${idx + 1}. ${s.instruction.slice(0, 80)}`}
                >
                  {s.screenshot_path ? (
                    <ThumbScreenshot path={s.screenshot_path} />
                  ) : (
                    <div className="size-full bg-muted grid place-items-center text-[10px] text-muted-foreground">{idx + 1}</div>
                  )}
                  <span className="absolute bottom-0.5 right-1 text-[9px] font-medium tabular-nums text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                    {idx + 1}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <SopComments sopId={sopId} stepIndex={i + 1} onJumpToStep={(n) => setI(n - 1)} />
        </>
      )}
      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
    {zoom && current?.screenshot_path && (
      <Lightbox path={current.screenshot_path} stepKey={i} rect={current.rect ?? null} viewport={current.viewport ?? null} onClose={() => setZoom(false)} />
    )}
    {isAdmin && (
      <AutomationDialog
        open={autoOpen}
        onOpenChange={setAutoOpen}
        sopTitle={sop.title}
        loading={suggestM.isPending}
        plan={suggestM.data?.plan ?? null}
        model={suggestM.data?.model ?? null}
        error={suggestM.error ? (suggestM.error as Error).message : null}
        onRegenerate={() => suggestM.mutate(sopId)}
      />
    )}
    </>
  );
}

function AutomationDialog({
  open, onOpenChange, sopTitle, loading, plan, model, error, onRegenerate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sopTitle: string;
  loading: boolean;
  plan: string | null;
  model: string | null;
  error: string | null;
  onRegenerate: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-gold" />
            Automation plan
          </DialogTitle>
          <p className="text-xs text-muted-foreground truncate">
            For: <span className="font-medium text-foreground">{sopTitle}</span>
            {model && <span className="ml-2 text-muted-foreground/70">· {model}</span>}
          </p>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto rounded-md border border-border bg-muted/30 p-4 text-sm">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
              <Loader2 className="size-4 animate-spin" />
              Designing the best way to automate this — using the smartest model available…
            </div>
          ) : error ? (
            <div className="text-destructive text-sm">{error}</div>
          ) : plan ? (
            <pre className="whitespace-pre-wrap font-sans leading-relaxed text-[13.5px]">{plan}</pre>
          ) : (
            <div className="text-muted-foreground">No plan yet.</div>
          )}
        </div>
        <DialogFooter className="gap-2">
          {plan && !loading && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(plan);
                toast.success("Plan copied");
              }}
            >
              Copy
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onRegenerate} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : "Regenerate"}
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useSignedUrl(path: string) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    setUrl(null); setErr(false);
    supabase.storage.from("va-screenshots").createSignedUrl(path, 3600).then(({ data, error }) => {
      if (!alive) return;
      if (error || !data) setErr(true);
      else setUrl(data.signedUrl);
    });
    return () => { alive = false; };
  }, [path]);
  return { url, err };
}

/**
 * Renders a pulsing gold marker at the click location, accounting for
 * object-contain letterboxing inside the container. No-op when rect/viewport
 * are missing (e.g. SOPs generated before click coords were captured).
 */
function ClickMarker({
  containerRef, rect, viewport, scale = 1,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  rect?: ClickRect | null;
  viewport?: Viewport | null;
  scale?: number;
}) {
  const [box, setBox] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !rect || !viewport || !viewport.w || !viewport.h) { setBox(null); return; }
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const cAR = r.width / r.height;
      const iAR = viewport.w / viewport.h;
      let w: number, h: number;
      if (iAR > cAR) { w = r.width; h = r.width / iAR; }
      else { h = r.height; w = r.height * iAR; }
      const offX = (r.width - w) / 2;
      const offY = (r.height - h) / 2;
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      setBox({
        left: offX + (cx / viewport.w) * w,
        top: offY + (cy / viewport.h) * h,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [containerRef, rect, viewport]);
  if (!box) return null;
  const size = 36 * scale;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-10"
      style={{ left: box.left, top: box.top, transform: "translate(-50%, -50%)" }}
    >
      <span
        className="absolute rounded-full bg-[var(--color-gold)]/30 animate-[clickPulse_1.6s_ease-out_infinite]"
        style={{ width: size * 2.2, height: size * 2.2, left: -(size * 1.1), top: -(size * 1.1) }}
      />
      <span
        className="absolute rounded-full ring-2 ring-[var(--color-gold)] bg-[var(--color-gold)]/20 shadow-[0_0_20px_rgba(212,168,74,0.65)]"
        style={{ width: size, height: size, left: -size / 2, top: -size / 2 }}
      />
      <span
        className="absolute rounded-full bg-[var(--color-gold)]"
        style={{ width: size * 0.28, height: size * 0.28, left: -(size * 0.14), top: -(size * 0.14) }}
      />
      <style>{`@keyframes clickPulse { 0% { transform: scale(0.5); opacity: 0.85; } 80% { transform: scale(1.6); opacity: 0; } 100% { opacity: 0; } }`}</style>
    </div>
  );
}

function StageScreenshot({ path, stepKey, rect, viewport }: { path: string; stepKey: number; rect?: ClickRect | null; viewport?: Viewport | null }) {
  const { url, err } = useSignedUrl(path);
  const ref = useRef<HTMLDivElement>(null);
  if (err) {
    return <div className="aspect-video w-full bg-muted grid place-items-center text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5"><ImageIcon className="size-4" />Screenshot unavailable</span>
    </div>;
  }
  return (
    <div ref={ref} className="relative aspect-video w-full bg-[oklch(0.18_0.018_240)] overflow-hidden">
      {!url ? (
        <div className="absolute inset-0 bg-gradient-to-br from-muted to-muted/50 animate-pulse" />
      ) : (
        <img
          key={stepKey}
          src={url}
          alt="step screenshot"
          className="size-full object-contain animate-[fadeUp_0.4s_ease-out_both]"
        />
      )}
      {url && <ClickMarker containerRef={ref} rect={rect} viewport={viewport} />}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.35)_100%)]" />
    </div>
  );
}

function CinemaScreenshot({ path, stepKey, rect, viewport }: { path: string; stepKey: number; rect?: ClickRect | null; viewport?: Viewport | null }) {
  const { url, err } = useSignedUrl(path);
  const ref = useRef<HTMLDivElement>(null);
  if (err) {
    return <div className="aspect-video w-full rounded-xl bg-white/5 grid place-items-center text-sm text-white/40">
      <span className="inline-flex items-center gap-1.5"><ImageIcon className="size-4" />Screenshot unavailable</span>
    </div>;
  }
  return (
    <div
      ref={ref}
      className="relative aspect-video w-full rounded-xl overflow-hidden ring-1 ring-white/10 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] bg-black"
    >
      {!url ? (
        <div className="absolute inset-0 bg-white/5 animate-pulse" />
      ) : (
        <img
          key={stepKey}
          src={url}
          alt="step screenshot"
          className="size-full object-contain animate-[fadeUp_0.45s_ease-out_both]"
        />
      )}
      {url && <ClickMarker containerRef={ref} rect={rect} viewport={viewport} scale={1.25} />}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_50%,rgba(0,0,0,0.55)_100%)]" />
    </div>
  );
}

function ThumbScreenshot({ path }: { path: string }) {
  const { url } = useSignedUrl(path);
  if (!url) return <div className="size-full bg-muted animate-pulse" />;
  return <img src={url} alt="" className="size-full object-cover" />;
}

function Lightbox({ path, stepKey, rect, viewport, onClose }: { path: string; stepKey: number; rect?: ClickRect | null; viewport?: Viewport | null; onClose: () => void }) {
  const { url, err } = useSignedUrl(path);
  const imgRef = useRef<HTMLImageElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Screenshot preview"
      className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm grid place-items-center p-4 animate-[fadeIn_0.18s_ease-out_both] cursor-zoom-out"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Close preview"
        className="absolute top-4 right-4 size-10 rounded-full bg-white/10 hover:bg-white/20 text-white grid place-items-center transition-colors"
      >
        <X className="size-5" />
      </button>
      {err ? (
        <div className="text-sm text-white/60">Screenshot unavailable</div>
      ) : !url ? (
        <div className="text-sm text-white/60 animate-pulse">Loading…</div>
      ) : (
        <div ref={wrapRef} className="relative" onClick={(e) => e.stopPropagation()}>
          <img
            ref={imgRef}
            key={stepKey}
            src={url}
            alt="step screenshot zoomed"
            className="block max-h-[92vh] max-w-[96vw] object-contain rounded-lg shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9)] cursor-default"
          />
          <ClickMarker containerRef={wrapRef} rect={rect} viewport={viewport} scale={1.6} />
        </div>
      )}
      <style>{`@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>
    </div>
  );
}

type Comment = {
  id: string; sop_id: string; step_index: number | null;
  author_id: string; body: string; created_at: string;
  is_question: boolean;
};

function SopComments({ sopId, stepIndex, onJumpToStep }: { sopId: string; stepIndex: number; onJumpToStep: (n: number) => void }) {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const isAdmin = profile?.role === "admin";
  const [body, setBody] = useState("");
  const [tagStep, setTagStep] = useState(true);
  const [isQuestion, setIsQuestion] = useState(false);
  const [posting, setPosting] = useState(false);
  const [resolving, setResolving] = useState(false);

  const q = useQuery({
    queryKey: ["sop-comments", sopId],
    queryFn: async (): Promise<{ comments: Comment[]; authors: Record<string, string> }> => {
      const { data: comments } = await supabase
        .from("sop_comments")
        .select("id, sop_id, step_index, author_id, body, created_at, is_question")
        .eq("sop_id", sopId)
        .order("created_at", { ascending: false })
        .limit(100);
      const list = (comments ?? []) as Comment[];
      const ids = Array.from(new Set(list.map((c) => c.author_id)));
      let authors: Record<string, string> = {};
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", ids);
        authors = Object.fromEntries((profs ?? []).map((p) => [p.user_id, p.display_name ?? "Someone"]));
      }
      return { comments: list, authors };
    },
  });

  const reviewQ = useQuery({
    queryKey: ["sop-needs-review", sopId],
    queryFn: async () => {
      const { data } = await supabase.from("sops").select("needs_review").eq("id", sopId).maybeSingle();
      return Boolean(data?.needs_review);
    },
  });

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed || !user) return;
    setPosting(true);
    const { error } = await supabase.from("sop_comments").insert({
      sop_id: sopId,
      step_index: tagStep ? stepIndex : null,
      author_id: user.id,
      body: trimmed.slice(0, 2000),
      is_question: isQuestion,
    });
    setPosting(false);
    if (error) return toast.error(error.message);
    setBody("");
    setIsQuestion(false);
    toast.success(isQuestion ? "Question posted — admins notified" : "Posted");
    qc.invalidateQueries({ queryKey: ["sop-comments", sopId] });
    qc.invalidateQueries({ queryKey: ["sop-needs-review", sopId] });
    qc.invalidateQueries({ queryKey: ["sops-needs-review"] });
  }

  async function markResolved() {
    setResolving(true);
    const { error } = await supabase.from("sops").update({ needs_review: false }).eq("id", sopId);
    setResolving(false);
    if (error) return toast.error(error.message);
    toast.success("Marked as resolved");
    qc.invalidateQueries({ queryKey: ["sop-needs-review", sopId] });
    qc.invalidateQueries({ queryKey: ["sops-needs-review"] });
  }

  async function remove(id: string) {
    const { error } = await supabase.from("sop_comments").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["sop-comments", sopId] });
  }

  const all = q.data?.comments ?? [];
  const authors = q.data?.authors ?? {};
  const [filter, setFilter] = useState<"all" | "step">("all");
  const visible = filter === "step" ? all.filter((c) => c.step_index === stepIndex) : all;
  const stepCount = all.filter((c) => c.step_index === stepIndex).length;

  return (
    <div className="pt-6 border-t border-border space-y-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-[0.22em] text-gold/90 font-medium flex items-center gap-1.5">
            <MessageSquare className="size-3" /> Discussion
          </div>
          <h2 className="font-display text-2xl md:text-3xl leading-tight">Questions &amp; notes</h2>
          <p className="text-xs text-muted-foreground">
            {all.length === 0
              ? "Ask anything that's unclear — admins get notified for questions."
              : `${all.length} total${stepCount > 0 ? ` · ${stepCount} on this step` : ""}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {reviewQ.data && (
            <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-gold/40 text-gold">
              <HelpCircle className="size-3 mr-1" /> Needs review
            </Badge>
          )}
          {isAdmin && reviewQ.data && (
            <Button size="sm" variant="outline" onClick={markResolved} disabled={resolving}>
              {resolving ? "…" : "Mark resolved"}
            </Button>
          )}
        </div>
      </div>

      {/* Composer card */}
      <div className="rounded-xl border border-border bg-card/40 p-3.5 space-y-3">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={isQuestion ? `What's confusing about step ${stepIndex}?` : "Leave a note for the team…"}
          maxLength={2000}
          rows={2}
          className="resize-none border-0 bg-transparent focus-visible:ring-0 px-1 shadow-none"
        />
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <TogglePill
              active={tagStep}
              onClick={() => setTagStep((v) => !v)}
              icon={<Pin className="size-3" />}
              label={`Step ${stepIndex}`}
            />
            <TogglePill
              active={isQuestion}
              onClick={() => setIsQuestion((v) => !v)}
              icon={<HelpCircle className="size-3" />}
              label="Question"
              tone="gold"
            />
          </div>
          <Button size="sm" onClick={submit} disabled={posting || !body.trim()}>
            {posting ? "Posting…" : isQuestion ? "Post question" : "Post note"}
          </Button>
        </div>
      </div>

      {/* Filter */}
      {all.length > 0 && stepCount > 0 && (
        <div className="flex items-center gap-1.5 text-[11px]">
          <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>
            All ({all.length})
          </FilterPill>
          <FilterPill active={filter === "step"} onClick={() => setFilter("step")}>
            On step {stepIndex} ({stepCount})
          </FilterPill>
        </div>
      )}

      <div className="space-y-2.5">
        {q.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : visible.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-xs text-muted-foreground">
            {all.length === 0
              ? "No questions yet. Be the first to ask."
              : `No comments on step ${stepIndex} yet.`}
          </div>
        ) : (
          visible.map((c) => {
            const mine = c.author_id === user?.id;
            const canDelete = mine || isAdmin;
            const onCurrentStep = c.step_index === stepIndex;
            return (
              <div
                key={c.id}
                className={`rounded-lg border bg-card/50 p-3.5 text-sm transition-colors ${
                  onCurrentStep ? "border-gold/40 ring-1 ring-gold/10" : "border-border"
                } ${c.is_question ? "bg-gold/[0.03]" : ""}`}
              >
                <div className="flex items-baseline justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-1.5 text-xs flex-wrap">
                    <span className="font-medium text-foreground">{authors[c.author_id] ?? "Someone"}</span>
                    {c.is_question && (
                      <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-gold/40 text-gold">
                        <HelpCircle className="size-2.5 mr-0.5" /> question
                      </Badge>
                    )}
                    {mine && <Badge variant="outline" className="text-[10px] h-4 px-1.5">you</Badge>}
                    {c.step_index != null && !onCurrentStep && (
                      <button
                        type="button"
                        onClick={() => onJumpToStep(c.step_index!)}
                        className="text-gold hover:underline inline-flex items-center gap-0.5"
                      >
                        <Pin className="size-2.5" /> step {c.step_index}
                      </button>
                    )}
                    {onCurrentStep && (
                      <span className="text-[10px] text-muted-foreground inline-flex items-center gap-0.5">
                        <Pin className="size-2.5" /> this step
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground shrink-0">
                    <span>{new Date(c.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                    {canDelete && (
                      <button onClick={() => remove(c.id)} aria-label="Delete" className="hover:text-destructive transition-colors">
                        <Trash2 className="size-3" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{c.body}</p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function TogglePill({
  active, onClick, icon, label, tone,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; tone?: "gold" }) {
  const onGold = active && tone === "gold";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
        onGold
          ? "border-gold/50 bg-gold/15 text-gold"
          : active
            ? "border-foreground/30 bg-foreground/10 text-foreground"
            : "border-border bg-transparent text-muted-foreground hover:text-foreground hover:border-foreground/30"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function FilterPill({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 transition-colors ${
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
      }`}
    >
      {children}
    </button>
  );
}

