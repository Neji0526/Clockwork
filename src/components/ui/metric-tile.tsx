import type { ReactNode } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Sparkline } from "./sparkline";

/**
 * Editorial metric tile — eyebrow label, large serif numeral, optional
 * sparkline trend, optional delta chip, optional caption.
 *
 * `tone="light"` (default) is the standard card-surface look used across
 * admin/VA panels. `tone="dark"` re-skins the same tile with light-on-dark
 * token colors so it reads on dark hero bands (e.g. `.auth-stage`). The dark
 * variant uses only existing tokens (`--gold`, `--success`, `--destructive`)
 * plus translucent white — the same idiom the surrounding hero already uses.
 */
export function MetricTile({
  label,
  value,
  caption,
  trend,
  delta,
  deltaLabel = "vs last week",
  accent = false,
  icon,
  tone = "light",
}: {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  trend?: number[];
  /** % change vs previous period. Auto-derived from `trend` if omitted. */
  delta?: number;
  deltaLabel?: string;
  accent?: boolean;
  icon?: ReactNode;
  /** "light" (default) for card surfaces; "dark" for dark hero bands. */
  tone?: "light" | "dark";
}) {
  let computedDelta = delta;
  if (computedDelta === undefined && trend && trend.length >= 2) {
    const first = trend[0];
    const last = trend[trend.length - 1];
    // Only compute a delta when there's a real baseline AND a real current value.
    // No baseline (first ~0) or no current value (last ~0) → no meaningful %.
    const EPS = 1e-6;
    if (Math.abs(first) > EPS && Math.abs(last) > EPS) {
      computedDelta = ((last - first) / first) * 100;
    }
  }

  const dir: "up" | "down" | "flat" =
    computedDelta === undefined || Math.abs(computedDelta) < 0.5 ? "flat"
      : computedDelta > 0 ? "up" : "down";

  const isDark = tone === "dark";

  const dirCls = (isDark
    ? {
        up:   "text-success bg-success/15 border-success/30",
        down: "text-destructive bg-destructive/20 border-destructive/40",
        flat: "text-white/70 bg-white/10 border-white/15",
      }
    : {
        up:   "text-success bg-success/10 border-success/20",
        down: "text-destructive bg-destructive/10 border-destructive/20",
        flat: "text-muted-foreground bg-muted border-border",
      })[dir];
  const DirIcon = dir === "up" ? TrendingUp : dir === "down" ? TrendingDown : Minus;

  const containerCls = isDark
    ? "relative overflow-hidden p-5 rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/[0.06]"
    : "surface-card relative overflow-hidden p-5 text-foreground transition-all duration-300 hover:-translate-y-0.5 hover:shadow-elevated";

  const labelCls = isDark
    ? "text-[10px] uppercase tracking-[0.2em] text-white/55 font-medium flex items-center gap-1.5"
    : "text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-medium flex items-center gap-1.5";

  const valueCls = isDark
    ? "mt-3 font-display text-4xl md:text-5xl leading-none tracking-tight text-white"
    : "mt-3 font-display text-4xl md:text-5xl leading-none tracking-tight text-foreground";

  const captionCls = isDark ? "text-xs text-white/60" : "text-xs text-muted-foreground";

  const accentRing = accent
    ? isDark ? "ring-1 ring-gold/40" : "ring-1 ring-gold/30"
    : "";

  return (
    <div className={`${containerCls} ${accentRing}`}>
      <div className="flex items-start justify-between gap-3">
        <div className={labelCls}>
          {icon}
          {label}
        </div>
        {trend && trend.length > 1 && (
          <Sparkline data={trend} width={88} height={28} />
        )}
      </div>
      <div className={valueCls}>
        {value}
      </div>
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        {computedDelta !== undefined && isFinite(computedDelta) && (
          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-medium tabular-nums ${dirCls}`}
            title={deltaLabel}
          >
            <DirIcon className="size-3" />
            {dir === "flat" ? "0%" : `${computedDelta > 0 ? "+" : ""}${computedDelta.toFixed(1)}%`}
          </span>
        )}
        {caption && (
          <div className={captionCls}>{caption}</div>
        )}
      </div>
      {accent && (
        <span
          aria-hidden
          className="absolute left-0 top-5 bottom-5 w-[2px] rounded-r-full bg-gold"
        />
      )}
    </div>
  );
}
