import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RequireAuth } from "@/components/require-auth";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth-context";
import { GuideView } from "@/components/guide-content";
import { userGuide } from "@/components/guide-data";

export const Route = createFileRoute("/guide/")({
  head: () => ({
    meta: [
      { title: "Guide — ClockWork" },
      { name: "description", content: "How to use ClockWork as a member: clocking in, the Day dashboard, the SOP library, and your privacy rights." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <RequireAuth>
      <AppShell>
        <GuidePage />
      </AppShell>
    </RequireAuth>
  ),
});

function GuidePage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const navigate = useNavigate();

  const toggle = isAdmin ? (
    <div className="inline-flex rounded-md border border-border bg-card/60 p-0.5">
      <button
        type="button"
        className="px-3 py-1.5 text-xs font-medium rounded-[5px] bg-sidebar-accent text-foreground"
        aria-current="page"
      >
        User guide
      </button>
      <button
        type="button"
        onClick={() => navigate({ to: "/guide/admin" })}
        className="px-3 py-1.5 text-xs font-medium rounded-[5px] text-muted-foreground hover:text-foreground"
      >
        Admin guide
      </button>
    </div>
  ) : null;

  return <GuideView doc={userGuide} headerActions={toggle} />;
}
