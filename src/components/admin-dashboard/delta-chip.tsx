// Period-over-period delta indicator used by the ranged dashboard KPIs.
// Tone:
//   - "directional": green up / red down (use when more = better, e.g. on-task %)
//   - "neutral":      muted arrow + number (use when more isn't unambiguously
//                     good, e.g. hours)
// Edge cases:
//   - prev === 0 && current === 0  → render "—"
//   - prev === 0 && current > 0    → render "new"
//   - loading prev                 → render small placeholder, no value
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type DeltaTone = "directional" | "neutral";

export function DeltaChip({
  current,
  previous,
  label,
  isLoading,
  isPartial,
  daysCompared,
  fullLength,
  partialLabel,
  tone,
}: {
  current: number | null;
  previous: number | null;
  label: string;
  isLoading?: boolean;
  isPartial?: boolean;
  daysCompared?: number;
  fullLength?: number;
  partialLabel?: string;
  tone: DeltaTone;
}) {
  if (isLoading || current === null || previous === null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/60">
        · · ·
      </span>
    );
  }

  if (previous === 0 && current === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="size-3" aria-hidden /> — {label}
      </span>
    );
  }

  if (previous === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <span
          className={
            tone === "directional"
              ? "text-success font-medium"
              : "text-foreground font-medium"
          }
        >
          new
        </span>
        <span>{label}</span>
        {isPartial && <PartialNote daysCompared={daysCompared} fullLength={fullLength} partialLabel={partialLabel} />}
      </span>
    );
  }

  const deltaPct = ((current - previous) / Math.abs(previous)) * 100;
  const rounded = Math.round(deltaPct);
  const isZero = rounded === 0;
  const isUp = deltaPct > 0;

  const Arrow = isZero ? Minus : isUp ? ArrowUp : ArrowDown;

  let valueClass = "text-foreground font-medium";
  if (tone === "directional" && !isZero) {
    valueClass = isUp ? "text-success font-medium" : "text-destructive font-medium";
  } else if (isZero) {
    valueClass = "text-muted-foreground";
  }

  const sign = isZero ? "" : isUp ? "+" : "";

  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Arrow className={`size-3 ${tone === "directional" && !isZero ? (isUp ? "text-success" : "text-destructive") : "text-muted-foreground"}`} aria-hidden />
      <span className={valueClass}>{sign}{rounded}%</span>
      <span>{label}</span>
      {isPartial && <PartialNote daysCompared={daysCompared} fullLength={fullLength} partialLabel={partialLabel} />}
    </span>
  );
}

function PartialNote({
  daysCompared,
  fullLength,
  partialLabel,
}: {
  daysCompared?: number;
  fullLength?: number;
  partialLabel?: string;
}) {
  const text = partialLabel
    ?? (daysCompared && fullLength ? `partial · ${daysCompared} of ${fullLength}d` : null);
  if (!text) return null;
  const tooltip = partialLabel
    ? "The current day isn't over yet, so it's being compared against a full prior day. Treat the delta as directional until the day completes."
    : `The current period hasn't fully elapsed. The previous period is clamped to the same ${daysCompared}-day window so the comparison is apples-to-apples.`;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="ml-0.5 text-[10px] text-muted-foreground/70 italic cursor-help">
            {text}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px] text-xs leading-snug">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
