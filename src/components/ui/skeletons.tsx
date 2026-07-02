/**
 * Editorial skeleton primitives — shimmering placeholders that mirror the
 * shape of real content (cards, tiles, rows) instead of generic gray blocks.
 * Uses a subtle gold-tinted shimmer aligned to the brand.
 */

function shimmer(extra = "") {
  return `relative overflow-hidden bg-muted/60 rounded-md after:absolute after:inset-0 after:-translate-x-full after:animate-[shimmer_1.8s_infinite] after:bg-gradient-to-r after:from-transparent after:via-white/40 after:to-transparent ${extra}`;
}

export function SkeletonLine({ w = "100%", className = "" }: { w?: string | number; className?: string }) {
  return <div style={{ width: typeof w === "number" ? `${w}px` : w }} className={`h-3 ${shimmer(className)}`} />;
}

export function SkeletonTile() {
  return (
    <div className="surface-card p-5 space-y-3">
      <div className={`h-2.5 w-20 ${shimmer()}`} />
      <div className={`h-9 w-32 ${shimmer()}`} />
      <div className={`h-2.5 w-24 ${shimmer()}`} />
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="surface-card overflow-hidden p-0">
      <div className={`aspect-[16/9] w-full ${shimmer("rounded-none")}`} />
      <div className="p-4 space-y-3">
        <div className={`h-4 w-3/4 ${shimmer()}`} />
        <div className={`h-3 w-full ${shimmer()}`} />
        <div className={`h-3 w-2/3 ${shimmer()}`} />
      </div>
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 py-3 border-b border-border last:border-0">
      <div className={`size-9 rounded-full ${shimmer()}`} />
      <div className="flex-1 space-y-2">
        <div className={`h-3 w-1/3 ${shimmer()}`} />
        <div className={`h-2.5 w-1/2 ${shimmer()}`} />
      </div>
      <div className={`h-7 w-16 rounded-full ${shimmer()}`} />
    </div>
  );
}

export function SkeletonGrid({ count = 6, variant = "card" }: { count?: number; variant?: "card" | "tile" | "row" }) {
  const Item = variant === "card" ? SkeletonCard : variant === "tile" ? SkeletonTile : SkeletonRow;
  if (variant === "row") {
    return <div className="surface-card px-5">{Array.from({ length: count }).map((_, i) => <Item key={i} />)}</div>;
  }
  const cols = variant === "tile" ? "md:grid-cols-2 lg:grid-cols-4" : "md:grid-cols-2 lg:grid-cols-3";
  return (
    <div className={`grid gap-4 ${cols}`}>
      {Array.from({ length: count }).map((_, i) => <Item key={i} />)}
    </div>
  );
}
