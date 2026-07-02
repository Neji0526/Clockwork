import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  Check,
  Sparkles,
  Chrome,
  Clock,
  Briefcase,
  BookOpen,
  X,
  ArrowRight,
} from "lucide-react";

/**
 * First-run guidance for new VAs. Auto-detects progress from real data:
 *  1. Install the tracker        — true once any work_session exists
 *  2. Clock in for the first time— true once any work_session exists
 *  3. Tag a client on a session  — true once any session has a client_id
 *  4. Peek at the SOP library    — true once the VA visits /sops (localStorage flag)
 *
 * Hides automatically when all four are done OR the user dismisses it.
 * Persisted per-user in localStorage so it doesn't follow shared devices.
 */
export function OnboardingChecklist({ userId }: { userId: string }) {
  const storageKey = `clockwork:onboarding-dismissed:${userId}`;
  const sopVisitKey = `clockwork:visited-sops:${userId}`;

  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(storageKey) === "1";
  });
  const [visitedSops, setVisitedSops] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(sopVisitKey) === "1";
  });

  // Pick up the SOP-visited flag when user returns from /sops.
  useEffect(() => {
    function onFocus() {
      if (typeof window === "undefined") return;
      setVisitedSops(window.localStorage.getItem(sopVisitKey) === "1");
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [sopVisitKey]);

  const progressQ = useQuery({
    queryKey: ["onboarding-progress", userId],
    enabled: !dismissed,
    queryFn: async () => {
      const [{ count: anySess }, { data: clientTagged }] = await Promise.all([
        supabase
          .from("work_sessions")
          .select("id", { count: "exact", head: true })
          .eq("va_id", userId),
        supabase
          .from("work_sessions")
          .select("id")
          .eq("va_id", userId)
          .not("client_id", "is", null)
          .limit(1)
          .maybeSingle(),
      ]);
      return {
        hasSession: (anySess ?? 0) > 0,
        hasClientTagged: !!clientTagged?.id,
      };
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const steps = useMemo(() => {
    const hasSession = progressQ.data?.hasSession ?? false;
    const hasClient = progressQ.data?.hasClientTagged ?? false;
    return [
      {
        key: "install",
        title: "Install the ClockWork tracker",
        sub: "Three small steps in Chrome. About a minute.",
        icon: <Chrome className="size-4" />,
        done: hasSession,
        cta: { to: "/install", label: "Open installer" },
      },
      {
        key: "clockin",
        title: "Clock in for the first time",
        sub: "Open the extension and press Clock In — this page lights up.",
        icon: <Clock className="size-4" />,
        done: hasSession,
        cta: null,
      },
      {
        key: "client",
        title: "Tag a session with a brand",
        sub: "So your hours roll up to the right project.",
        icon: <Briefcase className="size-4" />,
        done: hasClient,
        cta: null,
      },
      {
        key: "sops",
        title: "Peek at the SOP library",
        sub: "See the playbooks ClockWork is building from your work.",
        icon: <BookOpen className="size-4" />,
        done: visitedSops,
        cta: { to: "/sops", label: "Open SOPs" },
      },
    ];
  }, [progressQ.data, visitedSops]);

  const completed = steps.filter((s) => s.done).length;
  const total = steps.length;
  const allDone = completed === total;
  const pct = Math.round((completed / total) * 100);

  // Auto-dismiss with a celebration once everything is checked off,
  // but only after the user has had a beat to see the 100% state.
  useEffect(() => {
    if (!allDone || dismissed) return;
    const t = setTimeout(() => {
      try { window.localStorage.setItem(storageKey, "1"); } catch {}
      setDismissed(true);
    }, 8000);
    return () => clearTimeout(t);
  }, [allDone, dismissed, storageKey]);

  function dismiss() {
    try { window.localStorage.setItem(storageKey, "1"); } catch {}
    setDismissed(true);
  }

  if (dismissed) return null;

  return (
    <section
      aria-label="Getting started checklist"
      className="surface-card relative overflow-hidden p-5 md:p-6"
    >
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent"
      />
      <span
        aria-hidden
        className="absolute -top-16 -right-16 size-48 rounded-full bg-gold/10 blur-3xl pointer-events-none"
      />

      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="grid place-items-center size-9 rounded-full bg-gold/15 ring-1 ring-gold/40 text-gold shrink-0">
            {allDone ? <Check className="size-4" /> : <Sparkles className="size-4" />}
          </span>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.22em] text-gold/90 font-medium">
              {allDone ? "All set" : "Welcome to ClockWork"}
            </div>
            <h2 className="font-display text-xl md:text-2xl leading-tight mt-0.5">
              {allDone
                ? "You're up and running"
                : "A two-minute setup, then you're tracking"}
            </h2>
            <p className="text-xs text-muted-foreground mt-1 max-w-md">
              {allDone
                ? "Nice. This card will tuck itself away in a moment."
                : "Tick these off in any order — we'll mark them as you go."}
            </p>
          </div>
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss onboarding"
          className="text-muted-foreground hover:text-foreground transition-colors p-1 -m-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40"
        >
          <X className="size-4" />
        </button>
      </header>

      {/* Progress */}
      <div className="mt-4 flex items-center gap-3">
        <div className="flex-1 h-1.5 rounded-full bg-muted/60 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-gold/80 to-gold transition-[width] duration-700 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="text-xs tabular-nums text-muted-foreground shrink-0">
          {completed}/{total}
        </div>
      </div>

      {/* Steps */}
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {steps.map((s) => (
          <li
            key={s.key}
            className={`group flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
              s.done
                ? "border-success/30 bg-success/5"
                : "border-border bg-background/40 hover:border-gold/40"
            }`}
          >
            <span
              className={`mt-0.5 grid place-items-center size-5 rounded-full shrink-0 transition-colors ${
                s.done
                  ? "bg-success/20 text-success ring-1 ring-success/40"
                  : "bg-muted text-muted-foreground ring-1 ring-border"
              }`}
            >
              {s.done ? <Check className="size-3" /> : s.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium leading-tight">{s.title}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{s.sub}</div>
              {!s.done && s.cta && (
                <Button
                  asChild
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 mt-1.5 text-xs text-gold hover:text-gold hover:bg-gold/10"
                  onClick={() => {
                    if (s.key === "sops") {
                      try { window.localStorage.setItem(sopVisitKey, "1"); } catch {}
                    }
                  }}
                >
                  <Link to={s.cta.to}>
                    {s.cta.label}
                    <ArrowRight className="size-3 ml-1" />
                  </Link>
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
