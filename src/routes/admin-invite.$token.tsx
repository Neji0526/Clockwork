import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useServerFn } from "@tanstack/react-start";
import { acceptAdminInvite, previewAdminInvite } from "@/lib/admin-invites.functions";
import { Button } from "@/components/ui/button";
import { ClockMark } from "@/components/clock-mark";
import { ShieldCheck, AlertTriangle, Sparkles, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin-invite/$token")({
  head: () => ({
    meta: [
      { title: "Admin invite — ClockWork" },
      { name: "description", content: "Accept an admin invite to a ClockWork workspace." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminInvitePage,
});

const STASH_KEY = "pending_admin_invite_token";

function AdminInvitePage() {
  const { token } = Route.useParams();
  const { user, profile, loading, refreshProfile } = useAuth() as any;
  const navigate = useNavigate();
  const preview = useServerFn(previewAdminInvite);
  const accept = useServerFn(acceptAdminInvite);

  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "invalid"; reason: string }
    | { kind: "valid"; label: string | null; expires_at: string }
    | { kind: "claiming" }
    | { kind: "done"; alreadyAdmin: boolean }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  // Stash the token so the sign-in/sign-up flow can bring the user back here.
  useEffect(() => {
    try {
      sessionStorage.setItem(STASH_KEY, token);
    } catch {}
  }, [token]);

  // Validate the token regardless of signed-in state — but the server fn
  // requires auth, so we only preview once the user is present.
  useEffect(() => {
    if (loading) return;
    if (!user) {
      setState({ kind: "loading" }); // wait for sign-in
      return;
    }
    let cancelled = false;
    preview({ data: { token } })
      .then((res: any) => {
        if (cancelled) return;
        if (!res.valid) setState({ kind: "invalid", reason: res.reason });
        else setState({ kind: "valid", label: res.label, expires_at: res.expires_at });
      })
      .catch((e: any) => {
        if (!cancelled) setState({ kind: "error", message: e?.message ?? "Could not load this invite." });
      });
    return () => {
      cancelled = true;
    };
  }, [loading, user, token, preview]);

  async function handleAccept() {
    setState({ kind: "claiming" });
    try {
      const res: any = await accept({ data: { token } });
      try {
        sessionStorage.removeItem(STASH_KEY);
      } catch {}
      try {
        await refreshProfile?.();
      } catch {}
      setState({ kind: "done", alreadyAdmin: !!res.alreadyAdmin });
      toast.success(res.alreadyAdmin ? "You're already an admin." : "You're now an admin.");
      setTimeout(() => navigate({ to: "/admin" }), 1200);
    } catch (e: any) {
      const msg = e?.message ?? "Could not accept this invite.";
      setState({ kind: "error", message: msg });
      toast.error(msg);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center px-4 py-12 bg-background">
      <div className="w-full max-w-md surface-card relative overflow-hidden p-8">
        <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
        <div className="flex items-center gap-2 mb-6">
          <ClockMark size={28} className="text-primary" />
          <span className="font-display text-xl">ClockWork</span>
        </div>

        <div className="text-[11px] uppercase tracking-[0.24em] text-gold/90 font-medium mb-2 inline-flex items-center gap-1.5">
          <Sparkles className="size-3" /> Admin invite
        </div>
        <h1 className="font-display text-3xl leading-tight">
          Become an <span className="text-gold">admin</span>.
        </h1>

        {loading || (user && state.kind === "loading") ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Checking your invite…
          </div>
        ) : !user ? (
          <SignedOutView token={token} />
        ) : state.kind === "invalid" ? (
          <InvalidView reason={state.reason} />
        ) : state.kind === "error" ? (
          <InvalidView reason={state.message} />
        ) : state.kind === "done" ? (
          <div className="mt-6">
            <div className="flex items-start gap-3 rounded-lg border border-success/40 bg-success/10 p-4">
              <ShieldCheck className="size-5 text-success shrink-0 mt-0.5" />
              <div className="text-sm">
                <div className="font-medium text-foreground">
                  {state.alreadyAdmin ? "You already have admin access." : "You're now an admin."}
                </div>
                <p className="text-muted-foreground mt-1">Taking you to the team workspace…</p>
              </div>
            </div>
          </div>
        ) : state.kind === "valid" || state.kind === "claiming" ? (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-muted-foreground leading-relaxed">
              You've been invited to admin{state.kind === "valid" && state.label ? <> the <span className="text-foreground font-medium">{state.label}</span> workspace</> : <> this ClockWork workspace</>}. Admins can invite team members, run payroll, manage SOPs, and audit activity.
            </p>
            {profile?.role === "admin" ? (
              <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                You're already an admin — accepting will keep your access unchanged.
              </div>
            ) : null}
            <div className="text-xs text-muted-foreground">
              Signed in as <span className="font-mono text-foreground/80">{user.email}</span>.{" "}
              <button
                className="text-gold hover:underline"
                onClick={async () => {
                  const { supabase } = await import("@/integrations/supabase/client");
                  await supabase.auth.signOut();
                  navigate({ to: "/auth", search: { next: `/admin-invite/${token}` } as any });
                }}
              >
                Use a different account
              </button>
            </div>
            <Button
              onClick={handleAccept}
              disabled={state.kind === "claiming"}
              size="lg"
              className="w-full press"
            >
              {state.kind === "claiming" ? (
                <><Loader2 className="size-4 mr-2 animate-spin" /> Accepting…</>
              ) : (
                <><ShieldCheck className="size-4 mr-2" /> Accept admin invite <ArrowRight className="size-4 ml-2" /></>
              )}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SignedOutView({ token }: { token: string }) {
  return (
    <div className="mt-6 space-y-4">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Sign in or create a ClockWork account to accept this admin invite. You'll be brought right back here.
      </p>
      <div className="grid gap-2">
        <Button asChild size="lg" className="w-full press">
          <Link to="/auth" search={{ next: `/admin-invite/${token}` } as any}>
            Sign in or sign up <ArrowRight className="size-4 ml-2" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

function InvalidView({ reason }: { reason: string }) {
  const msg =
    reason === "not_found"
      ? "We couldn't find that invite link. Double-check the URL or ask the admin for a fresh one."
      : reason === "expired"
        ? "This invite link has expired. Ask the admin to send a new one."
        : reason === "revoked"
          ? "This invite link has been revoked."
          : reason === "used_up"
            ? "This invite link has already been used."
            : reason;
  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <AlertTriangle className="size-5 text-destructive shrink-0 mt-0.5" />
        <div className="text-sm text-foreground/90">{msg}</div>
      </div>
      <Button asChild variant="outline" className="w-full">
        <Link to="/">Go to ClockWork</Link>
      </Button>
    </div>
  );
}
