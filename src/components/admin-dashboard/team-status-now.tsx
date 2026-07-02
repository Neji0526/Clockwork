// Team status now — counts of working / on break / idle / off across all active VAs.
// Each tile is a deep-link to the Team page (/admin Today tab) filtered to that state.
// Tiles with a count of 0 render as a non-link in the same dimmed style.
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTeamStatusNow } from "@/hooks/use-team-status-now";

type StateKey = "working" | "break" | "idle" | "off";

type Row = {
  key: StateKey;
  label: string;
  dot: string;
  text: string;
  // Selected/hover tint applied to active (count > 0) tiles.
  hoverRing: string;
  hoverBg: string;
};

const ROWS: Row[] = [
  {
    key: "working",
    label: "Working",
    dot: "bg-success",
    text: "text-success",
    hoverRing: "hover:ring-success/40 focus-visible:ring-success/40",
    hoverBg: "hover:bg-success/[0.06]",
  },
  {
    key: "break",
    label: "Break",
    dot: "bg-warning",
    text: "text-warning",
    hoverRing: "hover:ring-warning/40 focus-visible:ring-warning/40",
    hoverBg: "hover:bg-warning/[0.06]",
  },
  {
    key: "idle",
    label: "Idle",
    dot: "bg-muted-foreground/60",
    text: "text-muted-foreground",
    hoverRing: "hover:ring-muted-foreground/30 focus-visible:ring-muted-foreground/30",
    hoverBg: "hover:bg-muted/40",
  },
  {
    key: "off",
    label: "Off",
    dot: "bg-muted-foreground/40",
    text: "text-muted-foreground",
    hoverRing: "hover:ring-muted-foreground/30 focus-visible:ring-muted-foreground/30",
    hoverBg: "hover:bg-muted/40",
  },
];

export function TeamStatusNowWidget() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const { counts, isLoading } = useTeamStatusNow(now);

  return (
    <section className="rounded-xl border border-border bg-card/60 p-5">
      <div className="flex items-baseline justify-between">
        <div className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
          Team status now
        </div>
        <div className="text-xs text-muted-foreground">
          {isLoading ? "—" : (
            <>
              <span className="text-foreground font-medium">{counts.total}</span>{" "}
              {counts.total === 1 ? "teammate" : "teammates"}
            </>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {ROWS.map((r) => {
          const count = counts[r.key];
          const isInteractive = !isLoading && count > 0;
          const base =
            "rounded-lg border border-border/70 bg-background/40 p-3 flex flex-col transition-colors ring-1 ring-transparent";
          const inner = (
            <>
              <div className="flex items-center gap-2 h-4 text-[11px] leading-none uppercase tracking-[0.12em] text-muted-foreground">
                <span aria-hidden className={`inline-block size-1.5 rounded-full shrink-0 ${r.dot}`} />
                <span className="truncate">{r.label}</span>
              </div>
              <div className={`mt-2 font-display text-3xl leading-none tabular-nums ${r.text}`}>
                {isLoading ? "—" : count}
              </div>
            </>
          );

          if (isInteractive) {
            return (
              <Link
                key={r.key}
                to="/admin"
                search={{ tab: "today", status: r.key }}
                aria-label={`Show ${r.label.toLowerCase()} teammates`}
                className={`${base} ${r.hoverRing} ${r.hoverBg} focus-visible:outline-none focus-visible:ring-2`}
              >
                {inner}
              </Link>
            );
          }

          return (
            <div
              key={r.key}
              className={`${base} opacity-60`}
              aria-disabled="true"
            >
              {inner}
            </div>
          );
        })}
      </div>
    </section>
  );
}
