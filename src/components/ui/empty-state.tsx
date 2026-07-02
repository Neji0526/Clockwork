import type { ReactNode } from "react";

/**
 * Editorial empty state — serif eyebrow + display headline + supportive copy
 * + optional action. Replaces plain "no data yet" text everywhere.
 */
export function EmptyState({
  icon,
  eyebrow,
  title,
  description,
  action,
  className = "",
}: {
  icon?: ReactNode;
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`surface-card relative overflow-hidden px-6 py-14 text-center ${className}`}>
      {/* Decorative gold hairline */}
      <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/40 to-transparent" />
      <div className="max-w-md mx-auto space-y-3">
        {icon && (
          <div className="mx-auto size-12 rounded-full ring-1 ring-gold/30 bg-gold/10 text-foreground/70 grid place-items-center [&>svg]:size-5">
            {icon}
          </div>
        )}
        {eyebrow && (
          <div className="text-[10px] uppercase tracking-[0.22em] text-gold/90 font-medium">{eyebrow}</div>
        )}
        <h3 className="font-display text-2xl md:text-3xl leading-tight">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
        )}
        {action && <div className="pt-2">{action}</div>}
      </div>
    </div>
  );
}
