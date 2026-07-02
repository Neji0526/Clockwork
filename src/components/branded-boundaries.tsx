/**
 * Branded 404 + global error boundary.
 * Uses the live ClockMark for a calm, on-brand "lost in time" feel.
 */
import { Link, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { ClockMark } from "./clock-mark";
import { Button } from "./ui/button";
import { ArrowLeft, Home, RotateCcw, AlertTriangle } from "lucide-react";
import { reportLovableError } from "@/lib/lovable-error-reporting";

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen grid place-items-center px-6 py-16 bg-background overflow-hidden">
      {/* Ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 30%, color-mix(in oklab, var(--color-gold) 14%, transparent), transparent 70%)",
        }}
      />
      <div className="relative w-full max-w-lg text-center">{children}</div>
    </div>
  );
}

export function BrandedNotFound() {
  return (
    <Frame>
      <div className="mx-auto mb-6 relative">
        <div
          aria-hidden
          className="absolute inset-0 -m-6 rounded-full blur-2xl opacity-50"
          style={{ background: "color-mix(in oklab, var(--color-gold) 35%, transparent)" }}
        />
        <ClockMark size={88} className="relative text-foreground mx-auto" live />
      </div>
      <div className="text-[11px] uppercase tracking-[0.24em] text-gold/90 font-medium">
        Lost in time
      </div>
      <h1 className="font-display text-6xl md:text-7xl mt-2 leading-none">404</h1>
      <p className="mt-4 text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
        The page you're looking for slipped between the seconds. Let's get you
        back to something solid.
      </p>
      <div className="mt-7 flex items-center justify-center gap-3 flex-wrap">
        <Button asChild size="lg" className="press">
          <Link to="/"><Home className="size-4 mr-2" /> Go home</Link>
        </Button>
        <Button asChild variant="outline" size="lg" className="press">
          <button onClick={() => window.history.back()}>
            <ArrowLeft className="size-4 mr-2" /> Back
          </button>
        </Button>
      </div>
    </Frame>
  );
}

export function BrandedError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "branded_root_error_component" });
  }, [error]);

  return (
    <Frame>
      <div className="mx-auto mb-6 relative">
        <div
          aria-hidden
          className="absolute inset-0 -m-6 rounded-full blur-2xl opacity-60"
          style={{ background: "color-mix(in oklab, var(--destructive) 30%, transparent)" }}
        />
        <ClockMark size={88} className="relative text-foreground mx-auto" live={false} />
        <span className="absolute -bottom-1 -right-1 grid place-items-center size-8 rounded-full bg-destructive text-destructive-foreground ring-4 ring-background">
          <AlertTriangle className="size-4" />
        </span>
      </div>
      <div className="text-[11px] uppercase tracking-[0.24em] text-destructive/90 font-medium">
        The clock paused
      </div>
      <h1 className="font-display text-4xl md:text-5xl mt-2 leading-tight">
        Something went sideways
      </h1>
      <p className="mt-4 text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
        We hit an unexpected snag. Your work is safe — try again, and if it
        keeps happening we'll already know.
      </p>
      {error?.message && (
        <pre className="mt-5 text-left text-[11px] leading-relaxed bg-muted/60 border border-border rounded-md p-3 max-h-32 overflow-auto font-mono text-muted-foreground whitespace-pre-wrap">
          {error.message}
        </pre>
      )}
      <div className="mt-6 flex items-center justify-center gap-3 flex-wrap">
        <Button
          size="lg"
          className="press"
          onClick={() => {
            router.invalidate();
            reset();
          }}
        >
          <RotateCcw className="size-4 mr-2" /> Try again
        </Button>
        <Button asChild variant="outline" size="lg" className="press">
          <Link to="/"><Home className="size-4 mr-2" /> Go home</Link>
        </Button>
      </div>
    </Frame>
  );
}
