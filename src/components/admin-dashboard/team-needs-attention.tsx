// Team-wide Needs Attention widget. Shares logic with NeedsAttentionStrip
// via @/lib/needs-attention.
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { AlertCircle, Clock, Edit3, Tag } from "lucide-react";
import { useTeamNeedsAttention } from "@/hooks/use-team-needs-attention";
import { iconKeyFor, type NeedsAttentionKind } from "@/lib/needs-attention";

const MAX_VISIBLE = 8;

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function iconFor(kind: NeedsAttentionKind) {
  switch (iconKeyFor(kind)) {
    case "alert": return <AlertCircle className="size-3.5 text-warning" />;
    case "clock": return <Clock className="size-3.5 text-warning" />;
    case "edit":  return <Edit3 className="size-3.5 text-muted-foreground" />;
    case "tag":   return <Tag className="size-3.5 text-warning" />;
  }
}

export function TeamNeedsAttentionWidget() {
  const { flags, earlierCount, vaCountWithFlags, isLoading } = useTeamNeedsAttention();
  const [expanded, setExpanded] = useState(false);

  const visible = expanded ? flags : flags.slice(0, MAX_VISIBLE);
  const hiddenCount = Math.max(0, flags.length - visible.length);
  const hasAny = flags.length > 0 || earlierCount > 0;

  const calm = !hasAny && !isLoading;

  return (
    <section
      aria-label="Team needs attention"
      className={
        calm
          ? "rounded-xl border border-border bg-card/60 px-4 py-3"
          : "rounded-xl border border-warning/30 bg-warning/[0.04] px-4 py-3"
      }
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-medium">
          Needs attention
        </div>
        {!isLoading && (flags.length > 0 || vaCountWithFlags > 0) && (
          <div className="text-xs text-muted-foreground tabular-nums">
            <span className="text-foreground font-medium">{flags.length}</span>{" "}
            {flags.length === 1 ? "flag" : "flags"} ·{" "}
            <span className="text-foreground font-medium">{vaCountWithFlags}</span>{" "}
            {vaCountWithFlags === 1 ? "teammate" : "teammates"}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="mt-2 text-xs text-muted-foreground">Loading…</div>
      ) : calm ? (
        <div className="mt-1 text-xs text-muted-foreground italic">No flags across the team today.</div>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {visible.map((f) => (
            <li key={f.key} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5 shrink-0">{iconFor(f.kind)}</span>
              <span className="min-w-0 flex-1">
                <Link
                  to="/admin/$vaId"
                  params={{ vaId: f.vaId }}
                  className="font-medium text-foreground underline-offset-2 hover:underline"
                >
                  {f.vaName}
                </Link>
                <span className="text-muted-foreground"> · </span>
                <span className="text-foreground">{f.message}</span>
                {f.when && (
                  <span className="text-muted-foreground tabular-nums ml-1.5">
                    · {fmtTime(f.when)}
                  </span>
                )}
              </span>
            </li>
          ))}

          {hiddenCount > 0 && (
            <li className="text-xs text-muted-foreground pt-1">
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="underline-offset-2 hover:underline"
              >
                +{hiddenCount} more
              </button>
            </li>
          )}

          {earlierCount > 0 && (
            <li className="text-xs text-muted-foreground pt-1">
              <Link to="/admin" className="underline-offset-2 hover:underline">
                +{earlierCount} earlier this week
              </Link>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
