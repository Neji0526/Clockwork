/**
 * Hairline ratio bar — segments laid out horizontally with a top label row.
 * Used for "active vs idle vs break" splits and "share of total" comparisons.
 */
export function RatioBar({
  segments,
  height = 6,
  className = "",
}: {
  segments: { value: number; color: string; label?: string }[];
  height?: number;
  className?: string;
}) {
  const total = segments.reduce((a, s) => a + Math.max(0, s.value), 0) || 1;
  return (
    <div
      className={`relative w-full overflow-hidden rounded-full bg-muted/70 ${className}`}
      style={{ height }}
      aria-hidden
    >
      <div className="absolute inset-0 flex">
        {segments.map((s, i) => {
          const w = (Math.max(0, s.value) / total) * 100;
          if (w <= 0) return null;
          return (
            <div
              key={i}
              style={{ width: `${w}%`, background: s.color }}
              className="h-full transition-[width] duration-700 ease-out first:rounded-l-full last:rounded-r-full"
              title={s.label}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Share-of-total horizontal bar with label + value. Designed for ranked lists.
 */
export function ShareRow({
  label,
  value,
  max,
  valueLabel,
  accent = false,
}: {
  label: string;
  value: number;
  max: number;
  valueLabel?: string;
  accent?: boolean;
}) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="group py-2.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium truncate">{label}</span>
        <span className="text-muted-foreground tabular-nums text-xs shrink-0">{valueLabel}</span>
      </div>
      <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-muted/60">
        <div
          style={{ width: `${pct}%` }}
          className={`h-full rounded-full transition-[width] duration-700 ease-out ${
            accent
              ? "bg-[var(--color-gold)]"
              : "bg-[var(--color-primary)]/85 group-hover:bg-[var(--color-primary)]"
          }`}
        />
      </div>
    </div>
  );
}
