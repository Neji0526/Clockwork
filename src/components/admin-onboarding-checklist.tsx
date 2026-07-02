import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  Check,
  Sparkles,
  Briefcase,
  DollarSign,
  UserPlus,
  Settings as SettingsIcon,
  X,
  ArrowRight,
} from "lucide-react";

/**
 * First-run guidance for new admins. Mirrors the VA OnboardingChecklist look.
 * Auto-detects progress from real data:
 *  1. Add your first client   — ≥1 non-archived client
 *  2. Set a bill / pay rate   — any client.bill_rate_cents>0 OR any VA pay_rate_cents>0
 *  3. Invite your first VA    — at least one profile with role='va'
 *  4. Review workspace settings — admin has visited Team → Settings (per-user flag)
 *
 * Auto-hides when all four are done OR the admin dismisses it.
 * Dismissal + the "visited settings" flag persist in localStorage per admin.
 */
export function AdminOnboardingChecklist({ userId }: { userId: string }) {
  const storageKey = `clockwork:admin-onboarding-dismissed:${userId}`;
  const settingsVisitKey = `clockwork:admin-visited-settings:${userId}`;

  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(storageKey) === "1";
  });
  const [visitedSettings, setVisitedSettings] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(settingsVisitKey) === "1";
  });

  // Pick up the settings-visited flag when admin returns from Settings.
  useEffect(() => {
    function onFocus() {
      if (typeof window === "undefined") return;
      setVisitedSettings(window.localStorage.getItem(settingsVisitKey) === "1");
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [settingsVisitKey]);

  const progressQ = useQuery({
    queryKey: ["admin-onboarding-progress", userId],
    enabled: !dismissed,
    queryFn: async () => {
      const [clientsRes, billedClientRes, paidVaRes, vaRes] = await Promise.all([
        supabase
          .from("clients")
          .select("id", { count: "exact", head: true })
          .eq("archived", false),
        supabase
          .from("clients")
          .select("id")
          .gt("bill_rate_cents", 0)
          .limit(1)
          .maybeSingle(),
        supabase
          .from("profiles")
          .select("user_id")
          .eq("role", "va")
          .gt("pay_rate_cents", 0)
          .limit(1)
          .maybeSingle(),
        supabase
          .from("profiles")
          .select("user_id", { count: "exact", head: true })
          .eq("role", "va"),
      ]);
      return {
        hasClient: (clientsRes.count ?? 0) > 0,
        hasRate: !!billedClientRes.data?.id || !!paidVaRes.data?.user_id,
        hasVa: (vaRes.count ?? 0) > 0,
      };
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const steps = useMemo(() => {
    const hasClient = progressQ.data?.hasClient ?? false;
    const hasRate = progressQ.data?.hasRate ?? false;
    const hasVa = progressQ.data?.hasVa ?? false;
    return [
      {
        key: "client",
        title: "Add your first brand",
        sub: "Group sessions and hours under the work they belong to.",
        icon: <Briefcase className="size-4" />,
        done: hasClient,
        cta: { to: "/admin" as const, search: { tab: "clients" as const }, label: "Open Brands" },
      },
      {
        key: "rate",
        title: "Set a bill or pay rate",
        sub: "Add a bill rate to a brand or a pay rate to a member so totals flow.",
        icon: <DollarSign className="size-4" />,
        done: hasRate,
        cta: { to: "/admin" as const, search: { tab: "clients" as const }, label: "Set rates" },
      },
      {
        key: "va",
        title: "Invite your first member",
        sub: "Send an invite — they'll install the tracker and start clocking in.",
        icon: <UserPlus className="size-4" />,
        done: hasVa,
        cta: { to: "/admin" as const, search: { tab: "vas" as const }, label: "Invite member" },
      },
      {
        key: "settings",
        title: "Review workspace settings",
        sub: "Idle thresholds, screenshot retention, and billing defaults.",
        icon: <SettingsIcon className="size-4" />,
        done: visitedSettings,
        cta: { to: "/admin/settings" as const, search: undefined, label: "Open Settings" },
      },
    ];
  }, [progressQ.data, visitedSettings]);

  const completed = steps.filter((s) => s.done).length;
  const total = steps.length;
  const allDone = completed === total;
  const pct = Math.round((completed / total) * 100);

  // Auto-dismiss with a beat once everything is checked off.
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
      aria-label="Admin setup checklist"
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
              {allDone ? "All set" : "Set up your workspace"}
            </div>
            <h2 className="font-display text-xl md:text-2xl leading-tight mt-0.5">
              {allDone
                ? "Your workspace is ready"
                : "Four quick steps to get your team tracking"}
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
          aria-label="Dismiss setup checklist"
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
                    if (s.key === "settings") {
                      try { window.localStorage.setItem(settingsVisitKey, "1"); } catch {}
                      setVisitedSettings(true);
                    }
                  }}
                >
                  <Link to={s.cta.to} search={s.cta.search}>
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
