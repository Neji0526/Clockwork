import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { RequireAuth } from "@/components/require-auth";
import { AppShell } from "@/components/app-shell";
import { VaHome } from "@/components/va-home";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ClockWork — Your day" },
      { name: "description", content: "Track your work, take breaks transparently, and watch your SOPs grow from the tasks you repeat." },
    ],
  }),
  component: IndexPage,
});

function IndexPage() {
  return (
    <RequireAuth requireConsent>
      <Inner />
    </RequireAuth>
  );
}

function Inner() {
  const { profile } = useAuth();
  if (profile?.role === "admin") return <Navigate to="/admin" />;
  return (
    <AppShell>
      <VaHome />
    </AppShell>
  );
}
