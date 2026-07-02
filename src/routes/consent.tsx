import { createFileRoute, useNavigate, Navigate } from "@tanstack/react-router";
import { ClockMark } from "@/components/clock-mark";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Eye, EyeOff, ShieldCheck, KeyRound, Check } from "lucide-react";
import { toast } from "sonner";

export const POLICY_VERSION = "v1.0";

export const Route = createFileRoute("/consent")({
  head: () => ({
    meta: [
      { title: "Consent — ClockWork" },
      { name: "description", content: "A quick, honest heads-up on what ClockWork records while you're clocked in — and what it never captures." },
      { property: "og:title", content: "Consent — ClockWork" },
      { property: "og:description", content: "Transparent by design. See exactly what gets recorded — and what doesn't." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ConsentPage,
});

function ConsentPage() {
  const { loading, user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);

  if (loading) return <div className="min-h-screen grid place-items-center text-muted-foreground text-sm">Loading…</div>;
  if (!user) return <Navigate to="/auth" />;
  const alreadyConsented = profile?.role === "admin" || !!profile?.consent_at;

  async function accept() {
    if (!user) return;
    setBusy(true);
    const now = new Date().toISOString();
    const { error: cErr } = await supabase
      .from("consent_records")
      .insert({ va_id: user.id, policy_version: POLICY_VERSION, agreed_at: now });
    if (cErr) { setBusy(false); return toast.error(cErr.message); }
    const { error: pErr } = await supabase
      .from("profiles")
      .update({ consent_at: now })
      .eq("user_id", user.id);
    setBusy(false);
    if (pErr) return toast.error(pErr.message);
    await refreshProfile();
    toast.success("Thanks — you're all set.");
    navigate({ to: "/" });
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.05fr_1fr] bg-background">
      {/* Left stage */}
      <div className="auth-stage relative hidden lg:flex flex-col justify-between p-12 text-white overflow-hidden">
        <div className="relative z-10 flex items-center gap-2.5">
          <ClockMark size={36} className="text-primary shrink-0" />
          <span className="font-display text-2xl">ClockWork</span>
        </div>

        <div className="relative z-10 max-w-lg">
          <div className="text-[11px] uppercase tracking-[0.25em] text-gold/90 font-medium mb-4">
            Transparent by design
          </div>
          <h1 className="font-display text-5xl xl:text-6xl leading-[1.02] tracking-tight">
            A clock you<br/>can <span className="text-gold">trust</span> —<br/>both ways.
          </h1>
          <p className="mt-6 text-white/65 text-base leading-relaxed max-w-md">
            You see exactly what your admin sees, in real time. No hidden capture, no keystroke logging, no surprises.
          </p>

          <div className="mt-10 space-y-3 max-w-md">
            <Promise icon={<Eye className="size-4" />} title="What you'll see" body="Live mirror of your sessions, idle time, and SOPs — same view as your admin." />
            <Promise icon={<EyeOff className="size-4" />} title="What's never captured" body="Keystrokes, passwords, camera, microphone, or anything off-the-clock." />
            <Promise icon={<KeyRound className="size-4" />} title="Your kill-switch" body="Hit Pause or Clock out anytime. Recording stops instantly." />
          </div>
        </div>

        <div className="relative z-10 text-xs text-white/40">
          Policy {POLICY_VERSION} · © ClockWork {new Date().getFullYear()}
        </div>
      </div>

      {/* Right: consent body */}
      <div className="relative flex items-start lg:items-center justify-center px-5 py-12 lg:py-16 bg-background overflow-y-auto">
        {/* Mobile-only ambient gold glow at top */}
        <span aria-hidden className="lg:hidden absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
        <span aria-hidden className="lg:hidden absolute top-0 left-1/2 -translate-x-1/2 size-72 rounded-full bg-gold/[0.06] blur-3xl pointer-events-none" />

        <div className="relative w-full max-w-md">
          <div className="flex items-center gap-2.5 lg:hidden mb-8">
            <ClockMark size={40} className="text-primary shrink-0" />
            <span className="font-display text-2xl">ClockWork</span>
          </div>

          <div className="mb-7">
            <div className="text-[10px] uppercase tracking-[0.22em] text-gold/90 font-medium mb-2">
              Before you clock in
            </div>
            <h2 className="font-display text-3xl lg:text-4xl leading-[1.05]">
              A quick, honest <span className="text-gold lg:text-foreground">heads-up.</span>
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Two minutes now means zero surprises later. Here's exactly what gets recorded — and what doesn't.
            </p>
          </div>

          <div className="space-y-5 text-sm leading-relaxed">
            <Section title="Recorded while you're clocked in" tone="on">
              <Bullet>Start &amp; end of each session, plus any pauses you take.</Bullet>
              <Bullet>The app or website you're actively using — page title and URL.</Bullet>
              <Bullet>Active vs idle time (no keystrokes, ever).</Bullet>
              <Bullet>Occasional screenshots of the active tab for context.</Bullet>
              <Bullet>An admin can also request an on-demand screenshot of your active tab while you're clocked in — same scope as the periodic captures, just on request.</Bullet>
              <Bullet>The sequence of clicks for repeated tasks, so ClockWork can draft SOPs for you.</Bullet>
            </Section>

            <Section title="Never recorded" tone="off">
              <Bullet>Anything while you're clocked out or on a break.</Bullet>
              <Bullet>Keystrokes, passwords, camera, or microphone.</Bullet>
              <Bullet>Personal tabs in a separate browser profile.</Bullet>
            </Section>

            <Section title="Your rights" tone="on">
              <Bullet>See exactly what admins see about you, in real time.</Bullet>
              <Bullet>Stop recording any time — Pause or Clock out.</Bullet>
              <Bullet>Request deletion of your captured data.</Bullet>
            </Section>

            {alreadyConsented ? (
              <div className="flex items-center justify-between gap-2 pt-1">
                <Button variant="ghost" onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/auth" }); }} className="text-muted-foreground">
                  Sign out
                </Button>
                <Button onClick={() => navigate({ to: "/" })} className="press">
                  <ShieldCheck className="size-4 mr-1.5" />
                  Back to dashboard
                </Button>
              </div>
            ) : (
              <>
                <label className="flex items-start gap-3 pt-1 cursor-pointer rounded-lg border border-border/60 bg-card/40 p-4 hover:bg-card/70 transition">
                  <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(!!v)} className="mt-0.5" />
                  <span className="text-sm">
                    I've read the above and consent to ClockWork recording my work activity while I am clocked in.
                    <span className="block text-xs text-muted-foreground mt-1">Policy {POLICY_VERSION}</span>
                  </span>
                </label>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <Button variant="ghost" onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/auth" }); }} className="text-muted-foreground">
                    Sign out
                  </Button>
                  <Button disabled={!agreed || busy} onClick={accept} className="press">
                    <ShieldCheck className="size-4 mr-1.5" />
                    {busy ? "Saving…" : "I agree — continue"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, tone, children }: { title: string; tone: "on" | "off"; children: React.ReactNode }) {
  const dotClass = tone === "on" ? "bg-gold" : "bg-muted-foreground/40";
  return (
    <div>
      <h3 className="flex items-center gap-2 font-medium text-foreground text-[13px] uppercase tracking-[0.12em] mb-2.5">
        <span className={`inline-block size-1.5 rounded-full ${dotClass}`} />
        {title}
      </h3>
      <ul className="space-y-1.5 text-muted-foreground pl-1">{children}</ul>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Check className="size-3.5 text-gold/80 mt-1 shrink-0" strokeWidth={2.5} />
      <span>{children}</span>
    </li>
  );
}

function Promise({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-3.5">
      <div className="grid place-items-center size-8 rounded-lg bg-gold/15 text-gold shrink-0">{icon}</div>
      <div>
        <div className="text-sm font-medium text-white">{title}</div>
        <div className="text-xs text-white/55 mt-0.5">{body}</div>
      </div>
    </div>
  );
}
