import { hostOf } from "./format";

export type Rating = "productive" | "unproductive" | "neutral";
export type Rule = { id?: string; pattern: string; rating: Rating };

export function keyOf(ev: { app?: string | null; url?: string | null }): string {
  const h = ev.url ? hostOf(ev.url) : "";
  return (h || ev.app || "Unknown").toLowerCase();
}

/** Longest-matching rule wins. Patterns may be exact ("youtube.com"),
 * suffix-by-default (host endsWith ".pattern" also matches), or wildcard
 * ("*.slack.com" — host endsWith ".slack.com"). */
export function classify(key: string, rules: Rule[]): Rating {
  const host = key.toLowerCase();
  let best: { len: number; rating: Rating } | null = null;
  for (const r of rules) {
    const p = r.pattern.toLowerCase().trim();
    if (!p) continue;
    let matched = false;
    let len = 0;
    if (p.startsWith("*.")) {
      const suffix = p.slice(1); // ".slack.com"
      if (host.endsWith(suffix) && host.length > suffix.length) { matched = true; len = suffix.length; }
    } else if (host === p || host.endsWith("." + p)) {
      matched = true; len = p.length;
    }
    if (matched && (!best || len > best.len)) best = { len, rating: r.rating };
  }
  return best?.rating ?? "neutral";
}

export type Breakdown = { productive: number; unproductive: number; neutral: number };

export function aggregate(
  events: Array<{ app?: string | null; url?: string | null; duration_sec?: number | null }>,
  rules: Rule[],
): { breakdown: Breakdown; byKey: Map<string, { sec: number; rating: Rating }> } {
  const byKey = new Map<string, { sec: number; rating: Rating }>();
  for (const e of events) {
    const k = keyOf(e);
    const sec = e.duration_sec ?? 0;
    if (sec <= 0) continue;
    const cur = byKey.get(k);
    if (cur) cur.sec += sec;
    else byKey.set(k, { sec, rating: classify(k, rules) });
  }
  const breakdown: Breakdown = { productive: 0, unproductive: 0, neutral: 0 };
  for (const { sec, rating } of byKey.values()) breakdown[rating] += sec;
  return { breakdown, byKey };
}

export function scorePct(b: Breakdown): number | null {
  const denom = b.productive + b.unproductive;
  if (denom <= 0) return null;
  return Math.round((b.productive / denom) * 100);
}

export function ratingColor(r: Rating): { bg: string; text: string; dot: string } {
  switch (r) {
    case "productive": return { bg: "bg-emerald-500/15", text: "text-emerald-600", dot: "bg-emerald-500" };
    case "unproductive": return { bg: "bg-rose-500/15", text: "text-rose-600", dot: "bg-rose-500" };
    default: return { bg: "bg-muted", text: "text-muted-foreground", dot: "bg-muted-foreground/60" };
  }
}
