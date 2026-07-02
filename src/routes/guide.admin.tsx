import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { RequireAuth } from "@/components/require-auth";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth-context";
import { GuideView } from "@/components/guide-content";
import { adminGuide } from "@/components/guide-data";

export const Route = createFileRoute("/guide/admin")({
  head: () => ({
    meta: [
      { title: "Admin guide — ClockWork" },
      { name: "description", content: "Run the ClockWork workspace: invite members, approve timesheets, run payroll, manage SOPs, and audit." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <RequireAuth>
      <AppShell>
        <AdminGuidePage />
      </AppShell>
    </RequireAuth>
  ),
});

function AdminGuidePage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  if (profile && profile.role !== "admin") return <Navigate to="/guide" />;

  const toggle = (
    <div className="inline-flex rounded-md border border-border bg-card/60 p-0.5">
      <button
        type="button"
        onClick={() => navigate({ to: "/guide" })}
        className="px-3 py-1.5 text-xs font-medium rounded-[5px] text-muted-foreground hover:text-foreground"
      >
        User guide
      </button>
      <button
        type="button"
        className="px-3 py-1.5 text-xs font-medium rounded-[5px] bg-sidebar-accent text-foreground"
        aria-current="page"
      >
        Admin guide
      </button>
    </div>
  );

  return <GuideView doc={adminGuide} headerActions={toggle} />;
}
