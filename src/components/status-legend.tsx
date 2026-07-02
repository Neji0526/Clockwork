import { ChevronDown } from "lucide-react";

type Row = { dot: string; label: string; desc: string };

const ROWS: Row[] = [
  { dot: "bg-success",             label: "Working now",        desc: "Clocked in, not on break, active in the last 10 minutes." },
  { dot: "bg-warning",             label: "On break",           desc: "Clocked in with an open break. Breaks auto-close after 60 minutes." },
  { dot: "bg-muted-foreground/60", label: "Idle",               desc: "Clocked in but no mouse/keyboard activity in the last 5 minutes." },
  { dot: "bg-muted-foreground/40", label: "Stopped responding", desc: "Clocked in, but the tracker hasn't sent any data for over 10 minutes. The session will be marked abandoned shortly." },
  { dot: "bg-muted-foreground/30", label: "Off the clock",      desc: "No active session — not currently clocked in." },
  { dot: "bg-warning",             label: "Low engagement",     desc: "Clocked in and not idle, but no clicks, typing, or scrolling for 10+ continuous minutes." },
  { dot: "bg-emerald-500",         label: "On-task %",          desc: "Of today's classified work time, the share spent on apps marked productive. Does not measure how much was done, and excludes idle and unclassified time." },
];

export function StatusLegend() {
  return (
    <details className="group rounded-lg border border-border bg-card/40">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground">
        <span>What do these mean?</span>
        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <dl className="grid gap-2 px-3 pb-3 pt-1 sm:grid-cols-2">
        {ROWS.map((r) => (
          <div key={r.label} className="flex items-start gap-2 text-xs">
            <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${r.dot}`} />
            <div className="min-w-0">
              <dt className="font-medium text-foreground">{r.label}</dt>
              <dd className="text-muted-foreground leading-snug">{r.desc}</dd>
            </div>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** Tooltip copy keyed for status badges. Same wording as the legend. */
export const STATUS_TOOLTIPS: Record<string, string> = {
  working: ROWS[0].desc,
  break:   ROWS[1].desc,
  idle:    ROWS[2].desc,
  stopped: ROWS[3].desc,
  off:     ROWS[4].desc,
};

/** Picks the right tooltip string from a computeLiveStatus result. */
export function tooltipForLive(state: string, label: string): string {
  if (state === "off") return label === "Stopped responding" ? STATUS_TOOLTIPS.stopped : STATUS_TOOLTIPS.off;
  return STATUS_TOOLTIPS[state] ?? "";
}
