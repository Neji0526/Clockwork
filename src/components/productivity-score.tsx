import type React from "react";
import { Breakdown, scorePct } from "@/lib/productivity";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/** Compact on-task score chip — share of classified work time on productive apps.
 *  When `muted`, renders de-emphasized so it doesn't visually compete with an
 *  idle / stopped-responding status on the same card. */
export function ProductivityScore({
  breakdown,
  size = "sm",
  muted = false,
}: { breakdown: Breakdown; size?: "sm" | "md"; muted?: boolean }) {
  const pct = scorePct(breakdown);
  const textSize = size === "md" ? "text-xs" : "text-[10px]";
  const baseCls = `inline-flex items-center gap-1.5 ${textSize} uppercase tracking-[0.16em]`;

  let content: React.ReactNode;
  if (pct === null) {
    content = (
      <span className={`${baseCls} text-muted-foreground`}>
        <span className="size-1.5 rounded-full bg-muted-foreground/40" /> No data
      </span>
    );
  } else {
    const tone = muted
      ? { dot: "bg-muted-foreground/50", text: "text-muted-foreground" }
      : pct >= 70 ? { dot: "bg-emerald-500", text: "text-emerald-600" }
      : pct >= 40 ? { dot: "bg-amber-500", text: "text-amber-600" }
      :             { dot: "bg-rose-500", text: "text-rose-600" };
    content = (
      <span className={`${baseCls} ${tone.text}`}>
        <span className={`size-1.5 rounded-full ${tone.dot}`} />
        <span className="tabular-nums">{pct}% on-task</span>
      </span>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help">{content}</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px] text-xs leading-snug">
          Share of classified work time spent on productive apps. Does not
          include idle time or measure how much was done.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Horizontal stacked bar of productive / unproductive / neutral seconds. */
export function ProductivityBar({ breakdown, height = 6 }: { breakdown: Breakdown; height?: number }) {
  const total = breakdown.productive + breakdown.unproductive + breakdown.neutral;
  if (total <= 0) return <div className="text-xs text-muted-foreground">No classified activity.</div>;
  const p = (breakdown.productive / total) * 100;
  const u = (breakdown.unproductive / total) * 100;
  const n = (breakdown.neutral / total) * 100;
  return (
    <div>
      <div className="w-full overflow-hidden rounded-full bg-muted/60" style={{ height }}>
        <div className="flex h-full">
          <div className="h-full bg-emerald-500 transition-[width]" style={{ width: `${p}%` }} title={`Productive ${p.toFixed(0)}%`} />
          <div className="h-full bg-rose-500 transition-[width]" style={{ width: `${u}%` }} title={`Unproductive ${u.toFixed(0)}%`} />
          <div className="h-full bg-muted-foreground/40 transition-[width]" style={{ width: `${n}%` }} title={`Neutral ${n.toFixed(0)}%`} />
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-emerald-500" />Productive {Math.round(p)}%</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-rose-500" />Unproductive {Math.round(u)}%</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-muted-foreground/60" />Neutral {Math.round(n)}%</span>
      </div>
    </div>
  );
}
