import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ClockMark } from "@/components/clock-mark";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Eye, EyeOff, Mail, Lock, User, UserCircle2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { requestPasswordReset as requestPasswordResetFn } from "@/lib/auth.functions";

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>): { next?: string } => {
    const raw = typeof s.next === "string" ? s.next : undefined;
    const next = raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : undefined;
    return { next };
  },
  head: () => ({
    meta: [
      { title: "Sign in — ClockWork" },
      { name: "description", content: "Sign in to your ClockWork workspace — transparent time tracking & automatic SOPs for virtual assistants." },
      { property: "og:title", content: "Sign in — ClockWork" },
      { property: "og:description", content: "Transparent time tracking & automatic SOPs for virtual assistants." },
      { name: "twitter:title", content: "Sign in — ClockWork" },
      { name: "twitter:description", content: "Transparent time tracking & automatic SOPs for virtual assistants." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const destination = next ?? "/";
  const [busy, setBusy] = useState(false);
  const requestPasswordReset = useServerFn(requestPasswordResetFn);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [remember, setRemember] = useState(true);
  const [showSignInPw, setShowSignInPw] = useState(false);
  const [showSignUpPw, setShowSignUpPw] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate({ to: destination });
  }, [loading, user, navigate, destination]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Welcome back");
    navigate({ to: destination });
  }


  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}${destination}`,
        data: { display_name: name || email.split("@")[0] },
      },
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Account created. You can sign in now.");
  }

  async function handleForgotPassword() {
    if (!email) return toast.error("Enter your email above first.");
    setBusy(true);
    try {
      await requestPasswordReset({
        data: {
          email,
          redirectTo: `${window.location.origin}/reset-password`,
        },
      });
      toast.success("If that email is registered, a reset link is on its way.");
    } catch {
      toast.success("If that email is registered, a reset link is on its way.");
    } finally {
      setBusy(false);
    }
  }

  const brandGreen = "oklch(0.42 0.10 165)";

  return (
    <div className="auth-page min-h-screen grid lg:grid-cols-[1.05fr_1fr] bg-background">
      {/* Left: cinematic stage */}
      <div className="auth-stage relative hidden lg:flex flex-col justify-between p-12 text-white overflow-hidden">
        <div className="relative z-10 flex items-center gap-2.5">
          <ClockMark size={36} className="text-emerald-300 shrink-0" />
          <span className="text-2xl font-semibold tracking-tight">ClockWork</span>
        </div>

        <div className="relative z-10 max-w-lg">
          <div className="text-[11px] uppercase tracking-[0.25em] text-gold/90 font-semibold mb-4">
            Premium time intelligence
          </div>
          <h1 className="text-5xl xl:text-6xl leading-[1.05] tracking-tight font-semibold">
            The clock that<br/>writes your<br/><span className="text-gold italic font-serif" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>playbook.</span>
          </h1>
          <p className="mt-6 text-white/70 text-base leading-relaxed max-w-md">
            Transparent time tracking that learns from every keystroke — and turns the workflows your team repeats into living SOPs.
          </p>

          <div className="mt-10 grid grid-cols-3 gap-6 max-w-md">
            <Stat n="98%" label={<>Billable<br/>Accuracy</>} />
            <Stat n="7×" label={<>Faster<br/>Onboarding</>} />
            <Stat n="0" label={<>Screenshots<br/>Seen by Humans</>} />
          </div>
        </div>

        <div className="relative z-10 flex items-center justify-between text-xs text-white/45">
          <span>© ClockWork · {new Date().getFullYear()}</span>
          <span className="hidden xl:inline">Built for teams that bill by the minute.</span>
        </div>

        {/* Floating decorative card */}
        <div aria-hidden className="absolute right-[-40px] top-1/2 -translate-y-1/2 hidden xl:block">
          <div className="rounded-2xl border border-white/12 bg-white/[0.04] backdrop-blur-xl p-5 w-72 shadow-2xl">
            <div className="text-[10px] uppercase tracking-[0.2em] text-emerald-300/90 mb-2 flex items-center gap-2">
              <span className="inline-block size-2 rounded-full bg-emerald-400 animate-pulse" />
              Live · Manila team
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl text-white tabular-nums font-semibold">06:42:15</span>
              <span className="text-xs text-white/55">Active</span>
            </div>
            <div className="mt-4 h-1 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full w-3/4 bg-emerald-400" />
            </div>
            <div className="mt-3 flex items-center justify-between text-[11px] text-white/60">
              <span>Active 82%</span><span>Idle 11%</span><span>Break 7%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right: form */}
      <div className="relative flex items-center justify-center px-5 py-12 lg:py-16 bg-background">
        <div className="relative w-full max-w-md">
          {/* Mobile hero */}
          <div className="lg:hidden mb-8">
            <div className="flex items-center gap-2.5 mb-6">
              <ClockMark size={40} className="text-emerald-600 shrink-0" />
              <span className="text-2xl font-semibold tracking-tight">ClockWork</span>
            </div>
          </div>

          <div className="mb-6 flex items-center gap-2.5 text-emerald-700">
            <UserCircle2 className="size-5" strokeWidth={1.75} />
            <span className="text-sm font-medium">Welcome back</span>
          </div>
          <h2 className="text-4xl leading-[1.1] tracking-tight font-semibold text-foreground">
            Sign in to your workspace
          </h2>
          <p className="mt-3 text-[15px] text-muted-foreground leading-relaxed">
            Transparent time tracking & automatic SOPs for virtual assistants.
          </p>

          <Tabs defaultValue="signin" className="mt-8">
            <TabsList
              className="grid grid-cols-2 w-full h-12 bg-muted/50 p-1 rounded-lg"
            >
              <TabsTrigger
                value="signin"
                className="rounded-md text-sm font-medium data-[state=active]:bg-background data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm"
                style={{ ["--tw-ring-color" as never]: brandGreen }}
              >
                Sign in
              </TabsTrigger>
              <TabsTrigger
                value="signup"
                className="rounded-md text-sm font-medium data-[state=active]:bg-background data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm"
              >
                Create account
              </TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="mt-6">
              <form onSubmit={handleSignIn} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-semibold text-foreground">Email address</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input id="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" className="h-12 pl-10 rounded-lg text-[15px]" />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-sm font-semibold text-foreground">Password</Label>
                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      className="text-sm font-medium text-emerald-700 hover:text-emerald-800 hover:underline underline-offset-4 transition-colors"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input id="password" type={showSignInPw ? "text" : "password"} autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" className="h-12 pl-10 pr-11 rounded-lg text-[15px]" />
                    <button
                      type="button"
                      onClick={() => setShowSignInPw(v => !v)}
                      aria-label={showSignInPw ? "Hide password" : "Show password"}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                    >
                      {showSignInPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
                <label className="flex items-center gap-2.5 text-sm text-foreground cursor-pointer select-none">
                  <Checkbox checked={remember} onCheckedChange={(v) => setRemember(!!v)} className="data-[state=checked]:bg-emerald-700 data-[state=checked]:border-emerald-700" />
                  <span>Remember me</span>
                </label>
                <Button
                  type="submit"
                  className="w-full h-12 rounded-lg text-[15px] font-semibold text-white hover:opacity-95 transition-opacity"
                  style={{ backgroundColor: "oklch(0.36 0.09 165)" }}
                  disabled={busy}
                >
                  {busy ? "Signing in…" : "Sign in"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup" className="mt-6">
              <form onSubmit={handleSignUp} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-sm font-semibold text-foreground">Your name</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input id="name" type="text" autoComplete="off" value={name} onChange={e => setName(e.target.value)} placeholder="Alex Tan" className="h-12 pl-10 rounded-lg text-[15px]" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email2" className="text-sm font-semibold text-foreground">Email address</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input id="email2" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" className="h-12 pl-10 rounded-lg text-[15px]" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password2" className="text-sm font-semibold text-foreground">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input id="password2" type={showSignUpPw ? "text" : "password"} autoComplete="new-password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" className="h-12 pl-10 pr-11 rounded-lg text-[15px]" />
                    <button
                      type="button"
                      onClick={() => setShowSignUpPw(v => !v)}
                      aria-label={showSignUpPw ? "Hide password" : "Show password"}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                    >
                      {showSignUpPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  <p className="text-[12px] text-muted-foreground">8 characters minimum.</p>
                </div>
                <Button
                  type="submit"
                  className="w-full h-12 rounded-lg text-[15px] font-semibold text-white hover:opacity-95 transition-opacity"
                  style={{ backgroundColor: "oklch(0.36 0.09 165)" }}
                  disabled={busy}
                >
                  {busy ? "Creating…" : "Create account"}
                </Button>
                <p className="text-xs text-muted-foreground text-center leading-relaxed">
                  The first account becomes the admin. After that, admins invite members.
                </p>
              </form>
            </TabsContent>
          </Tabs>

          <p className="lg:hidden mt-10 text-center text-[11px] text-muted-foreground">
            © ClockWork · {new Date().getFullYear()}
          </p>
        </div>
      </div>
    </div>
  );
}

function Stat({ n, label }: { n: string; label: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/12 bg-white/[0.03] px-3 py-3">
      <div className="text-emerald-300 mb-1.5">
        <span className="inline-block size-1.5 rounded-full bg-emerald-400" />
      </div>
      <div className="text-3xl text-white tabular-nums leading-none font-semibold">{n}</div>
      <div className="mt-2 text-[11px] text-white/60 leading-tight">{label}</div>
    </div>
  );
}
