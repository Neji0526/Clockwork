import { useAuth } from "@/lib/auth-context";
import { Navigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

export function RequireAuth({ children, requireConsent = false }: { children: ReactNode; requireConsent?: boolean }) {
  const { loading, user, profile } = useAuth();
  if (loading) return <div className="min-h-screen grid place-items-center text-muted-foreground text-sm">Loading…</div>;
  if (!user) return <Navigate to="/auth" />;
  if (!profile) return <div className="min-h-screen grid place-items-center text-muted-foreground text-sm">Loading your profile…</div>;
  if (requireConsent && profile.role === "va" && !profile.consent_at) return <Navigate to="/consent" />;
  return <>{children}</>;
}
