import { createFileRoute, Link } from "@tanstack/react-router";
import { RequireAuth } from "@/components/require-auth";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import {
  Download, Monitor, Apple, Terminal, ShieldCheck, Copy, Check, Pin, FolderOpen,
  ArrowRight, CircleDashed, Clock, Puzzle, Sparkles, BookOpen, LayoutDashboard, RefreshCw,
} from "lucide-react";

import { DESKTOP_VERSION, DESKTOP_DOWNLOADS } from "@/lib/desktop-version";

export const Route = createFileRoute("/install")({
  head: () => ({
    meta: [
      { title: "Install the ClockWork tracker" },
      { name: "description", content: "Three calm steps to set up the ClockWork desktop app and start tracking your work." },
      { property: "og:title", content: "Install the ClockWork tracker" },
      { property: "og:description", content: "Three calm steps to set up the ClockWork desktop app and start tracking your work." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <RequireAuth><AppShell><Install /></AppShell></RequireAuth>
  ),
});

function Install() {
  const { user } = useAuth();

  // Poll for the first sign of life — any activity from this VA in last 24h
  const verifyQ = useQuery({
    queryKey: ["install-verify", user?.id],
    enabled: !!user?.id,
    refetchInterval: 8_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 86_400_000).toISOString();
      const [sess, act] = await Promise.all([
        supabase.from("work_sessions").select("id, started_at").eq("va_id", user!.id).gte("started_at", since).order("started_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("activity_events").select("started_at").eq("va_id", user!.id).gte("started_at", since).order("started_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      const lastSeen = sess.data?.started_at ?? act.data?.started_at ?? null;
      return { connected: !!lastSeen, lastSeen };
    },
  });

  // Realtime — flip to "connected" the instant the first event lands.
  useRealtimeInvalidate(
    `install-verify:${user?.id ?? "anon"}`,
    user?.id
      ? [
          { table: "work_sessions", filter: `va_id=eq.${user.id}`, event: "INSERT", invalidate: [["install-verify", user.id]] },
          { table: "activity_events", filter: `va_id=eq.${user.id}`, event: "INSERT", invalidate: [["install-verify", user.id]] },
        ]
      : [],
    !!user?.id,
  );

  const connected = !!verifyQ.data?.connected;
  const [forceReinstall, setForceReinstall] = useState(false);

  if (connected && !forceReinstall) {
    return <ConnectedHero lastSeen={verifyQ.data?.lastSeen ?? null} onReinstall={() => setForceReinstall(true)} />;
  }

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Install header — light treatment, matches Settings */}
      <header className="grid md:grid-cols-[1.3fr_1fr] gap-8 items-center">
        <div className="space-y-2 max-w-xl">
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground font-medium inline-flex items-center gap-1.5">
            <Sparkles className="size-3 text-gold/80" /> Getting set up
          </div>
          <h1 className="font-display text-4xl md:text-5xl leading-[1.05] tracking-tight">
            Install the <span className="text-gold">tracker.</span>
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Three calm steps. About a minute. We'll let you know the moment the extension says hello.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Download className="size-3 text-gold/80" /> Download</span>
            <span className="opacity-40">·</span>
            <span className="inline-flex items-center gap-1.5"><Monitor className="size-3 text-gold/80" /> Install</span>
            <span className="opacity-40">·</span>
            <span className="inline-flex items-center gap-1.5"><Clock className="size-3 text-gold/80" /> Clock in</span>
          </div>
        </div>

        {/* Floating mock extension card — light variant */}
        <div aria-hidden className="relative hidden md:block">
          <div className="ml-auto w-72 rotate-[3deg] surface-card p-5 shadow-elegant">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">ClockWork · popup</div>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-success/15 text-success border border-success/40 text-[9px] font-bold tracking-wider">REC</span>
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="font-display text-3xl text-foreground tabular-nums">00:00:42</span>
              <span className="text-[11px] text-muted-foreground">just started</span>
            </div>
            <div className="mt-4 h-1 rounded-full bg-muted overflow-hidden">
              <div className="h-full w-1/12 bg-gold animate-pulse" />
            </div>
            <div className="mt-3 text-[11px] text-muted-foreground">Waiting for first ping…</div>
          </div>
        </div>
      </header>


      {/* Connection status banner */}
      <div
        className={`surface-card relative overflow-hidden px-5 py-4 flex items-center gap-4 transition-all ${
          connected ? "ring-1 ring-success/40" : ""
        }`}
      >
        <span
          aria-hidden
          className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent ${
            connected ? "via-success/60" : "via-gold/40"
          } to-transparent`}
        />
        <div className="relative">
          {connected ? (
            <span className="grid place-items-center size-10 rounded-full bg-success/15 ring-1 ring-success/40 text-success">
              <Check className="size-5" />
            </span>
          ) : (
            <span className="grid place-items-center size-10 rounded-full bg-muted ring-1 ring-border">
              <CircleDashed className="size-5 animate-[spin_3s_linear_infinite] text-muted-foreground" />
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display text-lg leading-tight">
            {connected ? "Tracker connected" : "Waiting for the tracker…"}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {connected
              ? <>Last activity {relTime(verifyQ.data?.lastSeen)}. You're all set.</>
              : "We're listening for the first ping from your extension. Follow the three steps below."}
          </div>
        </div>
        {connected && (
          <Button asChild size="sm" variant="outline">
            <Link to="/">Open My day <ArrowRight className="size-3.5 ml-1.5" /></Link>
          </Button>
        )}
      </div>

      {/* Steps */}
      <div className="grid gap-5">
        <Step
          n={1}
          icon={<Download className="size-5" />}
          title="Download ClockWork"
          subtitle="Pick your operating system. It installs like any normal desktop app — no Chrome needed."
          done={connected}
        >
          <div className="grid sm:grid-cols-3 gap-3 max-w-2xl">
            <Button asChild size="lg" className="press justify-start">
              <a href={DESKTOP_DOWNLOADS.windows} download>
                <Monitor className="size-4 mr-2" /> Windows (.exe)
              </a>
            </Button>
            <Button asChild size="lg" variant="outline" className="press justify-start">
              <a href={DESKTOP_DOWNLOADS.mac} download>
                <Apple className="size-4 mr-2" /> macOS (.dmg)
              </a>
            </Button>
            <Button asChild size="lg" variant="outline" className="press justify-start">
              <a href={DESKTOP_DOWNLOADS.linux} download>
                <Terminal className="size-4 mr-2" /> Linux (.AppImage)
              </a>
            </Button>
          </div>
          <div className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground font-mono">
            <span className="px-1.5 py-0.5 rounded bg-muted border border-border">v{DESKTOP_VERSION}</span>
            <span>latest release · Windows, macOS &amp; Linux</span>
          </div>
        </Step>

        <Step
          n={2}
          icon={<Monitor className="size-5" />}
          title="Install the app"
          subtitle="Run the installer for your platform — the same as any other desktop program."
          done={connected}
        >
          <ol className="text-sm leading-relaxed space-y-2.5 list-none max-w-xl">
            <SubStep icon={<Monitor className="size-3.5" />}>
              <span className="font-medium text-foreground">Windows:</span> open{" "}
              <code className="px-1.5 py-0.5 rounded bg-muted text-[11px] font-mono">ClockWork-Setup.exe</code>{" "}
              and follow the installer. Launch it from the Start menu.
            </SubStep>
            <SubStep icon={<Apple className="size-3.5" />}>
              <span className="font-medium text-foreground">macOS:</span> open the{" "}
              <code className="px-1.5 py-0.5 rounded bg-muted text-[11px] font-mono">.dmg</code>{" "}
              and drag ClockWork into Applications. On first launch, allow{" "}
              <span className="font-medium text-foreground">Screen Recording</span> in System Settings so screenshots work.
            </SubStep>
            <SubStep icon={<Terminal className="size-3.5" />}>
              <span className="font-medium text-foreground">Linux:</span> mark the{" "}
              <code className="px-1.5 py-0.5 rounded bg-muted text-[11px] font-mono">.AppImage</code>{" "}
              executable and run it (or install the <code className="px-1.5 py-0.5 rounded bg-muted text-[11px] font-mono">.deb</code>).
            </SubStep>
          </ol>
        </Step>

        <Step
          n={3}
          icon={<Clock className="size-5" />}
          title="Sign in and clock in"
          subtitle="Same email and password you used here. Pick a brand, press Clock In."
          done={connected}
        >
          <ul className="text-sm leading-relaxed space-y-2.5 max-w-lg">
            <SubStep>
              Open ClockWork — it lives in your system tray (Windows/Linux) or menu bar (macOS). Click its icon.
            </SubStep>
            <SubStep>
              Sign in with{" "}
              <code className="px-1.5 py-0.5 rounded bg-muted text-[11px] font-mono">{user?.email ?? "your email"}</code>
              .
            </SubStep>
            <SubStep>
              Pick your brand, press{" "}
              <span className="font-medium text-foreground">Clock In</span>. A green{" "}
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-success/15 text-success border border-success/40 text-[10px] font-bold tracking-wider">REC</span>{" "}
              state means it's tracking.
            </SubStep>
          </ul>
        </Step>
      </div>

      {/* Privacy reassurance */}
      <div className="surface-card relative overflow-hidden px-5 py-5 flex gap-4 items-start">
        <span aria-hidden className="absolute left-0 inset-y-5 w-[2px] rounded-r-full bg-gold" />
        <ShieldCheck className="size-5 text-gold shrink-0 mt-0.5" />
        <div className="text-sm">
          <div className="font-display text-lg leading-tight">You're in control</div>
          <p className="text-muted-foreground mt-1 leading-relaxed">
            You see exactly what your team admin sees — your own dashboard, every screenshot,
            every session. Clocking out or taking a break stops tracking immediately.
          </p>
          <Link
            to="/settings"
            className="inline-flex items-center gap-1 mt-3 text-xs text-gold hover:underline"
          >
            Review privacy in Settings <ArrowRight className="size-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}

function ConnectedHero({ lastSeen, onReinstall }: { lastSeen: string | null; onReinstall: () => void }) {
  return (
    <div className="max-w-3xl mx-auto py-6 md:py-12 animate-[fadeUp_500ms_ease-out_both]">
      <div className="relative surface-card overflow-hidden p-8 md:p-12 text-center">
        {/* Decorative glow */}
        <span aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,color-mix(in_oklab,var(--color-gold)_18%,transparent),transparent_60%)]" />
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent" />

        {/* Confetti sparkles */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {[
            { left: "12%", top: "18%", delay: "0ms",   size: 6 },
            { left: "85%", top: "22%", delay: "120ms", size: 4 },
            { left: "22%", top: "70%", delay: "260ms", size: 5 },
            { left: "78%", top: "75%", delay: "180ms", size: 7 },
            { left: "50%", top: "8%",  delay: "320ms", size: 4 },
            { left: "8%",  top: "48%", delay: "400ms", size: 3 },
            { left: "92%", top: "52%", delay: "210ms", size: 5 },
          ].map((s, i) => (
            <span
              key={i}
              className="absolute rounded-full bg-gold/70 animate-[sparkleIn_900ms_ease-out_both]"
              style={{
                left: s.left, top: s.top, width: s.size, height: s.size,
                animationDelay: s.delay,
              }}
            />
          ))}
        </div>

        <div className="relative">
          <div className="mx-auto grid place-items-center size-20 rounded-full bg-success/15 ring-1 ring-success/40 text-success animate-[popIn_500ms_cubic-bezier(0.34,1.56,0.64,1)_both]">
            <Check className="size-9" />
          </div>
          <div className="mt-6 text-[11px] uppercase tracking-[0.24em] text-gold/90 font-medium flex items-center justify-center gap-1.5">
            <Sparkles className="size-3" /> You're all set
          </div>
          <h1 className="font-display text-4xl md:text-6xl leading-[1.02] mt-3">
            The tracker is <span className="text-gold">live.</span>
          </h1>
          <p className="text-muted-foreground text-sm md:text-base mt-4 max-w-md mx-auto leading-relaxed">
            Your first session landed {relTime(lastSeen)}. From here, ClockWork hums in the background — your hours, screenshots, and SOPs flow in automatically.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="press">
              <Link to="/">
                <LayoutDashboard className="size-4 mr-2" /> Open My day <ArrowRight className="size-4 ml-2" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/sops">
                <BookOpen className="size-4 mr-2" /> Browse SOPs
              </Link>
            </Button>
            <Button size="lg" variant="ghost" onClick={onReinstall}>
              <RefreshCw className="size-4 mr-2" /> Reinstall tracker
            </Button>
          </div>

          <p className="text-[11px] text-muted-foreground mt-3">
            Removed the extension or switching computers? Reinstall to download a fresh copy.
          </p>

          <div className="mt-10 grid grid-cols-3 gap-3 max-w-md mx-auto text-left">
            <Highlight n="01" label="Clock in" caption="From the toolbar" />
            <Highlight n="02" label="Work as usual" caption="We listen quietly" />
            <Highlight n="03" label="Review later" caption="SOPs write themselves" />
          </div>
        </div>
      </div>

      {/* Privacy reassurance — kept for context */}
      <div className="surface-card relative overflow-hidden px-5 py-5 flex gap-4 items-start mt-6">
        <span aria-hidden className="absolute left-0 inset-y-5 w-[2px] rounded-r-full bg-gold" />
        <ShieldCheck className="size-5 text-gold shrink-0 mt-0.5" />
        <div className="text-sm">
          <div className="font-display text-lg leading-tight">You're in control</div>
          <p className="text-muted-foreground mt-1 leading-relaxed">
            Pause tracking anytime from the extension. Review what's recorded in Settings → Privacy.
          </p>
        </div>
      </div>

      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes popIn { 0% { opacity: 0; transform: scale(0.5); } 100% { opacity: 1; transform: scale(1); } }
        @keyframes sparkleIn {
          0%   { opacity: 0; transform: scale(0) translateY(8px); }
          60%  { opacity: 1; transform: scale(1.4) translateY(-2px); }
          100% { opacity: 0.85; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}

function Highlight({ n, label, caption }: { n: string; label: string; caption: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/40 p-3">
      <div className="text-[10px] uppercase tracking-[0.2em] text-gold/80 font-medium">{n}</div>
      <div className="font-display text-base mt-1 leading-tight">{label}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{caption}</div>
    </div>
  );
}

function Step({
  n, icon, title, subtitle, children, done,
}: {
  n: number; icon: React.ReactNode; title: string; subtitle: string; children: React.ReactNode; done: boolean;
}) {
  return (
    <div className="surface-card relative overflow-hidden p-6 md:p-7 transition-all hover:-translate-y-0.5 hover:shadow-elevated group">
      <div className="flex items-start gap-5">
        <div className="relative shrink-0">
          <div
            className={`grid place-items-center size-12 rounded-full font-display text-xl tabular-nums transition-all ${
              done
                ? "bg-success/15 text-success ring-1 ring-success/40"
                : "bg-gold/10 text-gold ring-1 ring-gold/30 group-hover:ring-gold/60"
            }`}
          >
            {done ? <Check className="size-5" /> : n}
          </div>
          {!done && (
            <span aria-hidden className="absolute -inset-1 rounded-full bg-gold/10 blur-md opacity-0 group-hover:opacity-100 transition-opacity" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-muted-foreground/80">
            {icon}
            <div className="text-[10px] uppercase tracking-[0.22em] font-medium">Step {n}</div>
          </div>
          <h2 className="font-display text-2xl leading-tight mt-1">{title}</h2>
          <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

function SubStep({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-1.5 grid place-items-center size-3.5 shrink-0 rounded-full bg-gold/20 ring-1 ring-gold/40 text-gold">
        {icon ?? <span className="size-1 rounded-full bg-gold" />}
      </span>
      <span>{children}</span>
    </li>
  );
}

function CopyChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }
  return (
    <button
      onClick={copy}
      className="group inline-flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs hover:border-gold/40 hover:bg-muted transition-all press"
    >
      <span className="truncate">{value}</span>
      <span className="text-muted-foreground group-hover:text-gold transition-colors">
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </span>
      {copied && <span className="text-[10px] text-success font-sans">Copied</span>}
    </button>
  );
}

function relTime(iso?: string | null) {
  if (!iso) return "just now";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
