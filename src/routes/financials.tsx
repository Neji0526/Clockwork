import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/require-auth";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth-context";
import { PayrollPanel } from "@/components/admin/financials/payroll-panel";
import { InvoicesPanel } from "@/components/admin/financials/invoices-panel";
import { TimesheetsPanel } from "@/components/admin/financials/timesheets-panel";

const FINANCIALS_SECTIONS = ["invoices", "payroll", "timesheets"] as const;
type FinancialsSection = (typeof FINANCIALS_SECTIONS)[number];

export const Route = createFileRoute("/financials")({
  head: () => ({ meta: [{ title: "Financials — ClockWork" }] }),
  validateSearch: (s: Record<string, unknown>): { section?: FinancialsSection } => {
    const sec = typeof s.section === "string" ? s.section : undefined;
    return {
      section: (FINANCIALS_SECTIONS as readonly string[]).includes(sec ?? "")
        ? (sec as FinancialsSection)
        : undefined,
    };
  },
  component: () => (
    <RequireAuth>
      <FinancialsGate />
    </RequireAuth>
  ),
});

function FinancialsGate() {
  const { profile } = useAuth();
  if (profile?.role !== "admin") {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">Admin only.</p>
      </AppShell>
    );
  }
  return (
    <AppShell>
      <FinancialsPage />
    </AppShell>
  );
}

function FinancialsPage() {
  const navigate = Route.useNavigate();
  const { section: sectionFromUrl } = Route.useSearch();
  // Default stays Invoices — that's the day-to-day entry point. Tab strip
  // order (Timesheets → Payroll → Invoices) tells the money-flow story:
  // approve hours, run payroll, bill clients.
  const section: FinancialsSection = sectionFromUrl ?? "invoices";

  const setSection = (next: FinancialsSection) => {
    navigate({
      search: { section: next === "invoices" ? undefined : next },
      replace: true,
    });
  };

  const sections: { value: FinancialsSection; label: string }[] = [
    { value: "timesheets", label: "Timesheets" },
    { value: "payroll", label: "Payroll" },
    { value: "invoices", label: "Invoices" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-gold/90 font-medium mb-1.5">Money</div>
          <h1 className="font-display text-4xl md:text-5xl leading-[1.05]">Financials</h1>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Approve hours, run payroll, bill brands.</p>
        <div
          role="tablist"
          aria-label="Financials sections"
          className="inline-flex items-center gap-1 rounded-full bg-muted/60 p-1 ring-1 ring-border"
        >
          {sections.map((s) => {
            const active = s.value === section;
            return (
              <button
                key={s.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSection(s.value)}
                className={
                  "px-3 py-1 rounded-full text-[11px] uppercase tracking-[0.15em] transition-colors cursor-pointer " +
                  (active
                    ? "bg-background text-foreground shadow-soft"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {section === "timesheets" ? (
        <TimesheetsPanel />
      ) : section === "payroll" ? (
        <PayrollPanel />
      ) : (
        <InvoicesPanel />
      )}
    </div>
  );
}
