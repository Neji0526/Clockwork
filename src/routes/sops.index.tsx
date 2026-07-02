import { createFileRoute, Link } from "@tanstack/react-router";
import { RequireAuth } from "@/components/require-auth";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useState, useMemo, useEffect, useRef } from "react";
import { Search, BookOpen, Image as ImageIcon, Play, Sparkles, Layers, CheckCircle2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonGrid } from "@/components/ui/skeletons";
import { SignalsPanel } from "@/components/sops/signals-panel";

const SOPS_SECTIONS = ["library", "signals"] as const;
type SopsSection = (typeof SOPS_SECTIONS)[number];

export const Route = createFileRoute("/sops/")({
  head: () => ({ meta: [{ title: "SOPs — ClockWork" }] }),
  validateSearch: (s: Record<string, unknown>): { section?: SopsSection } => {
    const sec = typeof s.section === "string" ? s.section : undefined;
    return {
      section: (SOPS_SECTIONS as readonly string[]).includes(sec ?? "")
        ? (sec as SopsSection)
        : undefined,
    };
  },
  component: () => <RequireAuth><AppShell><SopsPage /></AppShell></RequireAuth>,
});

function SopsPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const navigate = Route.useNavigate();
  const { section: sectionFromUrl } = Route.useSearch();
  // Default stays Library — that's the normal SOPs experience. Signals is
  // an admin-only second section (the queue of detected workflow patterns).
  const section: SopsSection = isAdmin && sectionFromUrl === "signals" ? "signals" : "library";

  const setSection = (next: SopsSection) => {
    navigate({
      search: { section: next === "library" ? undefined : next },
      replace: true,
    });
  };

  // Count of unconverted signatures — shown as a badge on the Signals pill so
  // the queue stays discoverable even though the inline nudge is gone.
  const signalsCountQ = useQuery({
    queryKey: ["sops-signals-count"],
    enabled: isAdmin,
    queryFn: async () => {
      const { count } = await supabase
        .from("workflow_signatures")
        .select("id", { count: "exact", head: true })
        .is("generated_sop_id", null);
      return count ?? 0;
    },
  });
  const signalsCount = signalsCountQ.data ?? 0;

  return (
    <div className="space-y-8">
      {isAdmin && (
        <div
          role="tablist"
          aria-label="SOPs sections"
          className="inline-flex items-center gap-1 rounded-full bg-muted/60 p-1 ring-1 ring-border"
        >
          {([
            { value: "library", label: "Library" },
            { value: "signals", label: "Signals" },
          ] as const).map(s => {
            const active = section === s.value;
            const showCount = s.value === "signals" && signalsCount > 0;
            return (
              <button
                key={s.value}
                role="tab"
                aria-selected={active}
                onClick={() => setSection(s.value)}
                className={`press inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-full transition-colors ${
                  active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s.label}
                {showCount && (
                  <span className={`tabular-nums ${active ? "opacity-70" : "text-gold"}`}>
                    · {signalsCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {section === "signals" ? <SignalsPanel /> : <SopLibrary />}
    </div>
  );
}

type Step = { index: number; instruction: string; screenshot_path?: string | null };
type Sop = {
  id: string; title: string; description: string | null;
  steps: Step[];
  status: "auto" | "reviewed" | "archived";
  source: string; created_at: string; generated_for_va: string | null;
};

type Filter = "all" | "mine" | "auto" | "reviewed" | "new";

function SopLibrary() {
  const { profile, user } = useAuth();
  const isAdmin = profile?.role === "admin";
  const userId = user?.id ?? null;
  const [q, setQ] = useState("");

  // Mark the SOP library as visited for the onboarding checklist.
  useEffect(() => {
    if (!userId || typeof window === "undefined") return;
    try { window.localStorage.setItem(`clockwork:visited-sops:${userId}`, "1"); } catch {}
  }, [userId]);
  const [filter, setFilter] = useState<Filter>("all");
  const [openSop, setOpenSop] = useState<Sop | null>(null);

  const sopsQ = useQuery({
    queryKey: ["sops-list"],
    queryFn: async () => {
      const { data } = await supabase
        .from("sops")
        .select("id, title, description, steps, status, source, created_at, generated_for_va")
        .neq("status", "archived")
        .order("created_at", { ascending: false });
      return (data ?? []) as unknown as Sop[];
    },
  });

  const all = sopsQ.data ?? [];

  const counts = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return {
      all: all.length,
      mine: userId ? all.filter(s => s.generated_for_va === userId).length : 0,
      auto: all.filter(s => s.status === "auto").length,
      reviewed: all.filter(s => s.status === "reviewed").length,
      new: all.filter(s => new Date(s.created_at).getTime() > cutoff).length,
    };
  }, [all, userId]);

  const filtered = useMemo(() => {
    const term = q.toLowerCase().trim();
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return all.filter(s => {
      if (filter === "mine" && s.generated_for_va !== userId) return false;
      if (filter === "auto" && s.status !== "auto") return false;
      if (filter === "reviewed" && s.status !== "reviewed") return false;
      if (filter === "new" && new Date(s.created_at).getTime() <= cutoff) return false;
      if (!term) return true;
      return s.title.toLowerCase().includes(term) ||
        (s.description ?? "").toLowerCase().includes(term);
    });
  }, [all, q, filter, userId]);

  const totalSteps = useMemo(() => all.reduce((n, s) => n + (s.steps?.length ?? 0), 0), [all]);

  return (
    <div className="space-y-8">
      {/* Library header — light treatment, matches Settings */}
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="space-y-2 max-w-xl">
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground font-medium inline-flex items-center gap-1.5">
            <Sparkles className="size-3 text-gold/80" /> Knowledge
          </div>
          <h1 className="font-display text-4xl md:text-5xl leading-[1.05] tracking-tight">
            SOP <span className="text-gold">library.</span>
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Standard operating procedures, drafted automatically from work your team repeats.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-6 text-left md:justify-self-end md:text-right">
          <HeroStat n={counts.all} label="SOPs" />
          <HeroStat n={totalSteps} label="Steps" />
          <HeroStat n={counts.reviewed} label="Reviewed" accent />
        </div>
      </header>


      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 w-full">
        <div className="relative w-full sm:max-w-md sm:flex-1">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search SOPs…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-1 p-1 rounded-full border border-border bg-card/60 self-start sm:self-auto sm:ml-auto">
          {([
            ["all", "All", counts.all, Layers],
            ...(!isAdmin && userId ? [["mine", "Mine", counts.mine, BookOpen] as const] : []),
            ["new", "New", counts.new, Sparkles],
            ["auto", "Auto", counts.auto, Wand2],
            ["reviewed", "Reviewed", counts.reviewed, CheckCircle2],
          ] as const).map(([k, label, count, Icon]) => (
            <button
              key={k}
              onClick={() => setFilter(k as Filter)}
              className={`press relative inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-full transition-colors ${
                filter === k
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className={`size-3.5 ${filter === k ? "" : "opacity-70"}`} />
              {label}
              <span className="tabular-nums opacity-60">{count}</span>
            </button>
          ))}
        </div>
      </div>




      

      {sopsQ.isLoading ? (
        <SkeletonGrid count={6} variant="card" />
      ) : filtered.length === 0 ? (
        all.length === 0 ? (
          <EmptyState
            icon={<BookOpen />}
            eyebrow="Nothing here yet"
            title="Your playbook writes itself."
            description="Once a member repeats a workflow 10 times, ClockWork drafts a standard operating procedure here — complete with screenshots and step-by-step instructions."
          />
        ) : (
          <EmptyState
            icon={<Search />}
            eyebrow="No matches"
            title="No SOPs match your filters."
            description={<>Try clearing the search or switching to <span className="text-foreground font-medium">All</span>.</>}
          />
        )
      ) : filter === "all" && !q.trim() ? (
        <SopSections sops={filtered} onOpen={setOpenSop} />
      ) : (
        <div className="stagger-children grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map(s => (
            <SopCard key={s.id} sop={s} onOpen={() => setOpenSop(s)} />
          ))}
        </div>
      )}

      <Dialog open={!!openSop} onOpenChange={(v) => !v && setOpenSop(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          {openSop && <SopDetail sop={openSop} isAdmin={isAdmin} onClose={() => setOpenSop(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HeroStat({ n, label, accent }: { n: number; label: string; accent?: boolean }) {
  return (
    <div>
      <div className={`font-display text-3xl md:text-4xl tabular-nums leading-none ${accent ? "text-gold" : "text-foreground"}`}>{n}</div>
      <div className="mt-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
    </div>
  );
}


function SopSections({ sops, onOpen }: { sops: Sop[]; onOpen: (s: Sop) => void }) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const fresh = sops.filter(s => new Date(s.created_at).getTime() > cutoff);
  const reviewed = sops.filter(s => s.status === "reviewed" && new Date(s.created_at).getTime() <= cutoff);
  const drafts = sops.filter(s => s.status === "auto" && new Date(s.created_at).getTime() <= cutoff);

  const groups = [
    { key: "fresh",    eyebrow: "This week", title: "Fresh playbooks",  caption: "New or freshly updated in the last 7 days.", items: fresh },
    { key: "reviewed", eyebrow: "Trusted",   title: "Reviewed",         caption: "Promoted by an admin — safe to onboard from.", items: reviewed },
    { key: "drafts",   eyebrow: "Drafts",    title: "Awaiting review",  caption: "Auto-generated. An admin can refine and promote them.", items: drafts },
  ].filter(g => g.items.length > 0);

  return (
    <div className="space-y-12">
      {groups.map((g, gi) => (
        <section key={g.key} className="space-y-4">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-gold/90 font-medium">{g.eyebrow}</div>
              <h2 className="font-display text-2xl md:text-3xl leading-tight mt-0.5">{g.title}</h2>
              <p className="text-xs text-muted-foreground mt-1 max-w-md">{g.caption}</p>
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">{g.items.length}</span>
          </div>
          <div className="stagger-children grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {g.items.map(s => (
              <SopCard key={s.id} sop={s} onOpen={() => onOpen(s)} />
            ))}
          </div>
          {gi < groups.length - 1 && <div className="divider-fade mt-2" />}
        </section>
      ))}
    </div>
  );
}

function SopCard({ sop, onOpen }: { sop: Sop; onOpen: () => void }) {
  const steps = sop.steps ?? [];
  const withShots = steps.filter(s => s.screenshot_path);
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const isNew = new Date(sop.created_at).getTime() > cutoff;
  const isReviewed = sop.status === "reviewed";
  const [hover, setHover] = useState(false);
  const [shotIdx, setShotIdx] = useState(0);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!hover || withShots.length < 2) return;
    intervalRef.current = window.setInterval(() => {
      setShotIdx(i => (i + 1) % withShots.length);
    }, 900);
    return () => { if (intervalRef.current) window.clearInterval(intervalRef.current); };
  }, [hover, withShots.length]);

  useEffect(() => { if (!hover) setShotIdx(0); }, [hover]);

  const coverPath = withShots[shotIdx]?.screenshot_path ?? withShots[0]?.screenshot_path;

  return (
    <Card
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="group relative cursor-pointer surface-card overflow-hidden p-0 lift transition-all duration-300"
    >
      {/* Cover */}
      <div className="relative aspect-[16/9] w-full bg-gradient-to-br from-muted via-muted/60 to-background overflow-hidden">
        {coverPath ? (
          <CoverScreenshot path={coverPath} />
        ) : (
          <div className="size-full grid place-items-center text-muted-foreground/60">
            <BookOpen className="size-8" />
          </div>
        )}
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/85 via-background/10 to-transparent" />

        {/* Top badges */}
        <div className="absolute top-3 left-3 right-3 flex items-start justify-between gap-2">
          <div className="flex gap-1.5">
            {isNew && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gold text-[10px] font-semibold uppercase tracking-wider text-black shadow-soft">
                <Sparkles className="size-3" />New
              </span>
            )}
            {isReviewed && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-background/90 backdrop-blur text-[10px] font-medium uppercase tracking-wider text-foreground border border-border">
                <CheckCircle2 className="size-3 text-gold" />Reviewed
              </span>
            )}
          </div>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-background/90 backdrop-blur text-[10px] font-medium tabular-nums text-foreground border border-border">
            <Layers className="size-3" />{steps.length}
          </span>
        </div>

        {/* Hover dot indicators */}
        {withShots.length > 1 && (
          <div className={`absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1 transition-opacity duration-200 ${hover ? "opacity-100" : "opacity-0"}`}>
            {withShots.slice(0, 8).map((_, i) => (
              <span key={i} className={`size-1 rounded-full transition-all ${i === shotIdx ? "bg-gold w-4" : "bg-white/60"}`} />
            ))}
          </div>
        )}

        {/* Play overlay */}
        <div className={`absolute inset-0 grid place-items-center transition-opacity duration-300 ${hover ? "opacity-100" : "opacity-0"}`}>
          <Link
            to="/sops/$sopId"
            params={{ sopId: sop.id }}
            onClick={(e) => e.stopPropagation()}
            className="press inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-foreground text-background text-xs font-medium shadow-elevated"
          >
            <Play className="size-3.5 fill-current" />Play walkthrough
          </Link>
        </div>
      </div>

      <CardHeader className="pb-2 pt-4">
        <CardTitle className="font-display text-lg leading-snug line-clamp-2">{sop.title}</CardTitle>
      </CardHeader>
      <CardContent className="pb-4">
        {sop.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">{sop.description}</p>
        )}
        <div className="mt-3 flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          <span>{new Date(sop.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
          <span className="text-foreground/70">{sop.source}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function CoverScreenshot({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    supabase.storage.from("va-screenshots").createSignedUrl(path, 3600).then(({ data }) => {
      if (alive && data) setUrl(data.signedUrl);
    });
    return () => { alive = false; };
  }, [path]);
  if (!url) return <div className="size-full bg-muted animate-pulse" />;
  return <img src={url} alt="" className="size-full object-cover transition-transform duration-700 group-hover:scale-[1.04]" />;
}

function SopDetail({ sop, isAdmin, onClose }: { sop: Sop; isAdmin: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(sop.title);
  const [description, setDescription] = useState(sop.description ?? "");
  const [steps, setSteps] = useState(sop.steps ?? []);

  async function save() {
    const { error } = await supabase
      .from("sops")
      .update({ title, description, steps })
      .eq("id", sop.id);
    if (error) return toast.error(error.message);
    toast.success("Saved");
    qc.invalidateQueries({ queryKey: ["sops-list"] });
    setEditing(false);
  }
  async function promote() {
    const { error } = await supabase.from("sops").update({ status: "reviewed" }).eq("id", sop.id);
    if (error) return toast.error(error.message);
    toast.success("Marked reviewed");
    qc.invalidateQueries({ queryKey: ["sops-list"] }); onClose();
  }
  async function archive() {
    const { error } = await supabase.from("sops").update({ status: "archived" }).eq("id", sop.id);
    if (error) return toast.error(error.message);
    toast.success("Archived");
    qc.invalidateQueries({ queryKey: ["sops-list"] }); onClose();
  }

  return (
    <div>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {editing ? <Input value={title} onChange={e=>setTitle(e.target.value)} /> : sop.title}
          <Badge variant={sop.status === "reviewed" ? "default" : "secondary"}>{sop.status}</Badge>
        </DialogTitle>
      </DialogHeader>
      <div className="mt-4 space-y-4">
        <div>
          <Button asChild size="sm" variant="outline">
            <Link to="/sops/$sopId" params={{ sopId: sop.id }}>
              <Play className="size-3.5 mr-1.5" />Play walkthrough
            </Link>
          </Button>
        </div>
        {editing ? (
          <Textarea value={description} onChange={e=>setDescription(e.target.value)} rows={3} />
        ) : (
          <p className="text-sm text-muted-foreground">{sop.description}</p>
        )}

        <ol className="space-y-4">
          {steps.map((st, i) => (
            <li key={i} className="flex gap-3">
              <div className="size-7 rounded-full bg-primary/10 text-primary grid place-items-center text-sm font-medium shrink-0">{st.index ?? i + 1}</div>
              <div className="flex-1 min-w-0 space-y-2">
                {editing ? (
                  <Input value={st.instruction} onChange={(e) => {
                    const next = steps.slice(); next[i] = { ...next[i], instruction: e.target.value }; setSteps(next);
                  }} />
                ) : (
                  <p className="text-sm">{st.instruction}</p>
                )}
                {st.screenshot_path && <Screenshot path={st.screenshot_path} />}
              </div>
            </li>
          ))}
        </ol>

        {isAdmin && (
          <div className="flex flex-wrap gap-2 pt-2 border-t">
            {editing ? (
              <>
                <Button onClick={save}>Save</Button>
                <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setEditing(true)}>Edit</Button>
                {sop.status === "auto" && <Button onClick={promote}>Mark as reviewed</Button>}
                <Button variant="ghost" className="text-destructive" onClick={archive}>Archive</Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Screenshot({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    supabase.storage.from("va-screenshots").createSignedUrl(path, 3600).then(({ data, error }) => {
      if (!alive) return;
      if (error || !data) setErr(true);
      else setUrl(data.signedUrl);
    });
    return () => { alive = false; };
  }, [path]);
  if (err) return <div className="text-xs text-muted-foreground flex items-center gap-1"><ImageIcon className="size-3"/>screenshot unavailable</div>;
  if (!url) return <div className="text-xs text-muted-foreground">loading screenshot…</div>;
  return <img src={url} alt="step screenshot" className="rounded-md border max-h-72 object-contain" />;
}
