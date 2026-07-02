import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/require-auth";
import { AppShell } from "@/components/app-shell";
import { VaHome } from "@/components/va-home";
import { AdminDashboard } from "@/components/admin-dashboard";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/me")({
  head: () => ({
    meta: [
      { title: "ClockWork — Dashboard" },
      { name: "description", content: "Team overview at a glance." },
    ],
  }),
  component: MePage,
});

function MePage() {
  return (
    <RequireAuth requireConsent>
      <AppShell>
        <Inner />
      </AppShell>
    </RequireAuth>
  );
}

function Inner() {
  const { profile } = useAuth();
  return profile?.role === "admin" ? <AdminDashboard /> : <VaHome />;
}
