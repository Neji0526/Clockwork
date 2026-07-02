import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RequireAuth } from "@/components/require-auth";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  User as UserIcon, Mail, Shield, DollarSign, Lock, LogOut,
  Check, Calendar, Sparkles, AlertTriangle, Clock, Eye, EyeOff, MonitorOff,
} from "lucide-react";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Account — ClockWork" }] }),
  component: () => (
    <RequireAuth><AppShell><SettingsPage /></AppShell></RequireAuth>
  ),
});

const SECTIONS = [
  { id: "profile", label: "Profile" },
  { id: "security", label: "Security" },
  { id: "privacy", label: "Privacy" },
  { id: "danger", label: "Danger zone" },
] as const;

function SettingsPage() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const [active, setActive] = useState<string>("profile");

  // Track which section is in view to highlight the sticky nav.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the topmost intersecting section.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-96px 0px -55% 0px", threshold: 0 },
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  const payQ = useQuery({
    queryKey: ["settings-pay", user?.id],
    enabled: !!user?.id && profile?.role === "va",
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("pay_rate_cents, pay_currency")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  function jump(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - 80;
    window.scrollTo({ top: y, behavior: "smooth" });
  }

  return (
    <div className="max-w-5xl">
      <header className="mb-8">
        <div className="text-[11px] uppercase tracking-[0.22em] text-gold/90 font-medium mb-1.5">Personal</div>
        <h1 className="font-display text-4xl md:text-5xl leading-[1.05]">Account</h1>
        <p className="text-muted-foreground text-sm mt-2 max-w-lg">
          Your profile, sign-in, and what we track on your behalf.
        </p>
      </header>

      {/* Sticky section pills — mobile scrolls horizontally, desktop centers */}
      <div className="sticky top-0 z-20 -mx-4 px-4 sm:mx-0 sm:px-0 bg-background/85 backdrop-blur-md border-b border-border/60 mb-8">
        <nav className="flex gap-1 overflow-x-auto scrollbar-none py-2.5 [mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-12px),transparent)] sm:[mask-image:none]">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => jump(s.id)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs tracking-wide transition-colors ${
                active === s.id
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="grid lg:grid-cols-[1fr_220px] gap-10">
        <div className="space-y-12 min-w-0">
          {/* Profile */}
          <section id="profile" className="scroll-mt-24 space-y-4">
            <SectionHeader
              eyebrow="01"
              title="Profile"
              caption="How you appear to your team."
            />
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <UserIcon className="size-4" /> Identity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-start gap-4 pb-5 border-b border-border">
                  <div className="size-14 rounded-full ring-1 ring-gold/30 bg-gold/10 grid place-items-center shrink-0">
                    <UserIcon className="size-6 text-foreground/70" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-2xl leading-tight truncate">
                      {profile?.display_name ?? "—"}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 flex-wrap text-xs">
                      <Badge variant={profile?.role === "admin" ? "default" : "secondary"}>
                        {profile?.role}
                      </Badge>
                      {profile?.status && profile.status !== "active" && (
                        <Badge variant="outline">{profile.status}</Badge>
                      )}
                      <span className="text-muted-foreground inline-flex items-center gap-1 truncate">
                        <Mail className="size-3 shrink-0" /> {user?.email ?? "—"}
                      </span>
                      <span className="text-muted-foreground inline-flex items-center gap-1">
                        <Clock className="size-3 shrink-0" /> {Intl.DateTimeFormat().resolvedOptions().timeZone}
                      </span>
                    </div>
                  </div>
                </div>

                <DisplayNameForm
                  initial={profile?.display_name ?? ""}
                  onSaved={refreshProfile}
                />
              </CardContent>
            </Card>

            {profile?.role === "va" && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <DollarSign className="size-4" /> Pay rate
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-end gap-4 flex-wrap">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-1">Hourly</div>
                      <div className="font-display text-4xl leading-none tabular-nums">
                        {payQ.data?.pay_rate_cents
                          ? ((payQ.data.pay_rate_cents ?? 0) / 100).toLocaleString(undefined, {
                              style: "currency",
                              currency: payQ.data.pay_currency ?? "USD",
                            })
                          : "—"}
                        <span className="text-sm text-muted-foreground font-sans ml-1">/hr</span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground flex-1 min-w-[200px]">
                      Set by your team admin. Ask them if you think this needs an update.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </section>

          {/* Security */}
          <section id="security" className="scroll-mt-24 space-y-4">
            <SectionHeader
              eyebrow="02"
              title="Security"
              caption="Keep your account locked down."
            />
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Lock className="size-4" /> Change password
                </CardTitle>
              </CardHeader>
              <CardContent>
                <PasswordForm />
              </CardContent>
            </Card>
          </section>

          {/* Privacy */}
          <section id="privacy" className="scroll-mt-24 space-y-4">
            <SectionHeader
              eyebrow="03"
              title="Privacy"
              caption="What we record on your behalf, and when."
            />
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="size-4" /> Monitoring consent
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <div className="font-medium">Consent status</div>
                    <div className="text-xs text-muted-foreground">
                      {profile?.consent_at
                        ? `Granted ${new Date(profile.consent_at).toLocaleDateString()}`
                        : "Not yet granted"}
                    </div>
                  </div>
                  {profile?.consent_at ? (
                    <Badge variant="outline" className="gap-1.5 text-success border-success/40">
                      <Check className="size-3" /> Active
                    </Badge>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => navigate({ to: "/consent" })}>
                      Review consent
                    </Button>
                  )}
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground leading-relaxed">
                  We record screenshots and app activity only while you're clocked in. Pause anytime from the
                  extension. Screenshots are retained per your team's settings.
                </div>
              </CardContent>
            </Card>
          </section>

          {/* Danger zone */}
          <section id="danger" className="scroll-mt-24 space-y-4">
            <SectionHeader
              eyebrow="04"
              title="Danger zone"
              caption="Actions that change session state."
              tone="warning"
            />
            <Card className="border-destructive/30">
              <CardContent className="py-4 flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <div className="font-medium text-sm flex items-center gap-1.5">
                    <LogOut className="size-3.5" /> Sign out of this device
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    You'll be returned to the welcome screen. Tracking will stop.
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={async () => { await signOut(); navigate({ to: "/auth" }); }}
                >
                  Sign out
                </Button>
              </CardContent>
            </Card>

            <Card className="border-destructive/30">
              <CardContent className="py-4 flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <div className="font-medium text-sm flex items-center gap-1.5">
                    <MonitorOff className="size-3.5" /> Sign out of every device
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Revokes every active session. Use this if you left ClockWork open somewhere you don't trust.
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      const { error } = await supabase.auth.signOut({ scope: "global" });
                      if (error) throw error;
                      toast.success("Signed out everywhere");
                      navigate({ to: "/auth" });
                    } catch (e: any) {
                      toast.error(e?.message ?? "Couldn't sign out everywhere");
                    }
                  }}
                >
                  Sign out everywhere
                </Button>
              </CardContent>
            </Card>
          </section>

          {user?.created_at && (
            <div className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
              <Calendar className="size-3" /> Member since {new Date(user.created_at).toLocaleDateString()}
            </div>
          )}
        </div>

        {/* Right rail — sticky outline (desktop only) */}
        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-3">
            <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground font-medium">
              On this page
            </div>
            <ul className="space-y-1 text-sm border-l border-border">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => jump(s.id)}
                    className={`block w-full text-left pl-4 -ml-px py-1 border-l-2 transition-colors ${
                      active === s.id
                        ? "border-gold text-foreground font-medium"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SectionHeader({
  eyebrow, title, caption, tone,
}: { eyebrow: string; title: string; caption: string; tone?: "warning" }) {
  return (
    <div className="space-y-1">
      <div className={`text-[10px] uppercase tracking-[0.22em] font-medium ${tone === "warning" ? "text-destructive/80" : "text-gold/90"}`}>
        {eyebrow}
        {tone === "warning" && <AlertTriangle className="size-3 inline ml-1.5 -mt-0.5" />}
      </div>
      <h2 className="font-display text-2xl md:text-3xl leading-tight">{title}</h2>
      <p className="text-sm text-muted-foreground">{caption}</p>
    </div>
  );
}

function DisplayNameForm({ initial, onSaved }: { initial: string; onSaved: () => Promise<void> }) {
  const { user } = useAuth();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setName(initial); }, [initial]);
  const dirty = !!name.trim() && name.trim() !== initial;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !dirty) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: name.trim() })
        .eq("user_id", user.id);
      if (error) throw error;
      await onSaved();
      toast.success("Profile updated");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={save} className="pt-5 space-y-3 max-w-md">
      <div className="space-y-1.5">
        <Label htmlFor="display_name" className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Display name</Label>
        <Input
          id="display_name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="How you appear to your team"
          maxLength={80}
        />
      </div>

      {/* Sticky save bar — only appears when there are unsaved changes */}
      {dirty && (
        <div className="fixed bottom-4 inset-x-4 sm:left-auto sm:right-6 sm:bottom-6 sm:w-auto z-30 animate-[fadeUp_240ms_ease-out_both]">
          <div className="rounded-full border border-border bg-card/95 backdrop-blur-md shadow-elevated px-3 py-2 flex items-center gap-3 max-w-md sm:max-w-none mx-auto">
            <span className="text-xs text-muted-foreground pl-2 truncate">Unsaved changes to your name</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setName(initial)}
              className="h-7"
            >
              Discard
            </Button>
            <Button type="submit" size="sm" disabled={busy} className="h-7">
              {busy ? "Saving…" : "Save"}
              {!busy && <Sparkles className="size-3 ml-1" />}
            </Button>
          </div>
        </div>
      )}

      <Button type="submit" size="sm" disabled={!dirty || busy} className="sm:hidden">
        {busy ? "Saving…" : "Save changes"}
      </Button>

      <style>{`@keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </form>
  );
}

function PasswordForm() {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const longEnough = pw.length >= 8;
  const matches = pw.length > 0 && pw === pw2;
  const ready = longEnough && matches;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      toast.success("Password updated");
      setPw(""); setPw2("");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-4 max-w-md">
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="pw" className="text-xs uppercase tracking-[0.18em] text-muted-foreground">New password</Label>
          <div className="relative">
            <Input
              id="pw"
              type={show ? "text" : "password"}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              autoComplete="new-password"
              className="pr-9"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute inset-y-0 right-0 px-2.5 text-muted-foreground hover:text-foreground"
              aria-label={show ? "Hide password" : "Show password"}
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pw2" className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Confirm</Label>
          <Input
            id="pw2"
            type={show ? "text" : "password"}
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            autoComplete="new-password"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 text-[11px]">
        <Rule met={longEnough} label="At least 8 characters" />
        <Rule met={matches} label="Passwords match" />
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={busy || !ready}>
          {busy ? "Updating…" : "Update password"}
        </Button>
        <p className="text-[11px] text-muted-foreground">You'll stay signed in on this device.</p>
      </div>
    </form>
  );
}

function Rule({ met, label }: { met: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors ${
        met
          ? "border-success/40 bg-success/10 text-success"
          : "border-border bg-muted/30 text-muted-foreground"
      }`}
    >
      <Check className={`size-3 ${met ? "opacity-100" : "opacity-40"}`} />
      {label}
    </span>
  );
}
