import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { ClockMark } from "@/components/clock-mark";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Eye, EyeOff, ShieldCheck, Check } from "lucide-react";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset password — ClockWork" },
      { name: "description", content: "Set a new password for your ClockWork account." },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Only the recovery-link flow may set a new password from this page.
    // A user with a normal active session must NOT be allowed to change their
    // password here without re-authenticating — otherwise a stolen device or
    // a victim who follows a malicious link to /reset-password while already
    // signed in could have their password rotated silently.
    const { data: sub } = supabase.auth.onAuthStateChange((evt) => {
      if (evt === "PASSWORD_RECOVERY") setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return toast.error("Password must be at least 8 characters.");
    if (password !== confirm) return toast.error("Passwords do not match.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Password updated. You're signed in.");
    navigate({ to: "/" });
  }

  const longEnough = password.length >= 8;
  const matches = password.length > 0 && password === confirm;

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.05fr_1fr] bg-background">
      {/* Left stage — matches /auth */}
      <div className="auth-stage relative hidden lg:flex flex-col justify-between p-12 text-white overflow-hidden">
        <div className="relative z-10 flex items-center gap-2.5">
          <ClockMark size={36} className="text-primary shrink-0" />
          <span className="font-display text-2xl">ClockWork</span>
        </div>

        <div className="relative z-10 max-w-lg float-slow">
          <div className="text-[11px] uppercase tracking-[0.25em] text-gold/90 font-medium mb-4">
            Account security
          </div>
          <h1 className="font-display text-5xl xl:text-6xl leading-[1.02] tracking-tight">
            Pick a password<br/>only <span className="text-gold">you</span><br/>would type.
          </h1>
          <p className="mt-6 text-white/65 text-base leading-relaxed max-w-md">
            Your session, screenshots, and SOPs are tied to this account. A strong password keeps your work — and your clients' trust — protected.
          </p>
        </div>

        <div className="relative z-10 text-xs text-white/40">
          © ClockWork · {new Date().getFullYear()}
        </div>
      </div>

      {/* Right: form */}
      <div className="flex items-center justify-center px-5 py-12 lg:py-16 bg-background">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-2 lg:hidden mb-8">
            <ClockMark size={40} className="text-primary shrink-0" />
            <span className="font-display text-2xl">ClockWork</span>
          </div>

          <div className="mb-7">
            <div className="text-[10px] uppercase tracking-[0.22em] text-gold/90 font-medium mb-2">Reset</div>
            <h2 className="font-display text-4xl leading-[1.05]">Set a new password.</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {ready
                ? "Choose something at least 8 characters. You'll be signed in right after."
                : "Open this page from the password-reset link in your email."}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="new-pw">New password</Label>
              <div className="relative">
                <Input
                  id="new-pw"
                  type={show ? "text" : "password"}
                  required
                  minLength={8}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="pr-10"
                  disabled={!ready}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShow(v => !v)}
                  aria-label={show ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                >
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-pw">Confirm password</Label>
              <Input
                id="confirm-pw"
                type={show ? "text" : "password"}
                required
                minLength={8}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                disabled={!ready}
              />
            </div>

            <ul className="text-xs text-muted-foreground space-y-1.5 pt-1">
              <Rule ok={longEnough}>At least 8 characters</Rule>
              <Rule ok={matches}>Both passwords match</Rule>
            </ul>

            <Button type="submit" className="w-full press" disabled={busy || !ready || !longEnough || !matches}>
              {busy ? "Updating…" : "Update password"}
            </Button>
          </form>

          <div className="mt-6 flex items-center justify-between text-xs text-muted-foreground">
            <Link to="/auth" className="hover:text-foreground underline-offset-4 hover:underline">
              Back to sign in
            </Link>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 text-gold" /> Encrypted in transit
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Rule({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={`flex items-center gap-2 ${ok ? "text-foreground" : ""}`}>
      <span className={`grid place-items-center size-4 rounded-full ${ok ? "bg-gold/20 text-gold" : "bg-muted text-muted-foreground/60"}`}>
        <Check className="size-2.5" strokeWidth={3} />
      </span>
      {children}
    </li>
  );
}
