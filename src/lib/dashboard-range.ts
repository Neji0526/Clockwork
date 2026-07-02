// Resolves admin-dashboard date-range presets to {from, to} ET local-day
// strings using ONLY the helpers in @/lib/reporting (no new date math).
import {
  todayLocal,
  nextDay,
  prevDay,
  startOfWeekET,
  startOfMonthET,
  endOfMonthET,
} from "./reporting";

export type RangePreset =
  | "today"
  | "yesterday"
  | "this-week"
  | "last-week"
  | "this-month"
  | "last-month"
  | "custom";

export type ResolvedRange = { from: string; to: string };

export const PRESET_LABEL: Record<RangePreset, string> = {
  "today": "Today",
  "yesterday": "Yesterday",
  "this-week": "This week",
  "last-week": "Last week",
  "this-month": "This month",
  "last-month": "Last month",
  "custom": "Custom range",
};

export function resolveRange(
  preset: RangePreset,
  custom?: ResolvedRange,
  today: string = todayLocal(),
): ResolvedRange {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = prevDay(today);
      return { from: y, to: y };
    }
    case "this-week":
      return { from: startOfWeekET(today), to: today };
    case "last-week": {
      const thisWkStart = startOfWeekET(today);
      const lastWkEnd = prevDay(thisWkStart);          // Sunday of last week
      const lastWkStart = startOfWeekET(lastWkEnd);    // Monday of last week
      return { from: lastWkStart, to: lastWkEnd };
    }
    case "this-month":
      return { from: startOfMonthET(today), to: today };
    case "last-month": {
      const lastMonthAnchor = prevDay(startOfMonthET(today));
      return {
        from: startOfMonthET(lastMonthAnchor),
        to: endOfMonthET(lastMonthAnchor),
      };
    }
    case "custom":
      return custom ?? { from: today, to: today };
  }
}

/** Inclusive day count between two ET local-day strings (from <= to). */
export function daysInclusive(from: string, to: string): number {
  let n = 1;
  let cur = from;
  // Hard safety cap — ranges shouldn't exceed ~400 days in practice.
  while (cur < to && n < 800) {
    cur = nextDay(cur);
    n++;
  }
  return n;
}

/** "Natural" length of the preset's window — full week / full month — for
 * detecting partial periods. For presets that are inherently 1 day or a full
 * historical window, this equals the resolved range's day count. */
function naturalLength(
  preset: RangePreset,
  current: ResolvedRange,
  today: string,
): number {
  switch (preset) {
    case "today":
    case "yesterday":
      return 1;
    case "this-week":
    case "last-week":
      return 7;
    case "this-month":
      return daysInclusive(startOfMonthET(today), endOfMonthET(today));
    case "last-month":
      return daysInclusive(current.from, current.to);
    case "custom":
      return daysInclusive(current.from, current.to);
  }
}

export type PreviousRange = {
  from: string;
  to: string;
  /** True when the *current* period hasn't fully elapsed (e.g. "this week"
   * only 3 days in, or "today" mid-day). Prev range is still clamped to the
   * same length, so the numeric comparison is apples-to-apples; this flag is
   * for UI labeling. */
  isPartial: boolean;
  daysCompared: number;
  fullLength: number;
  /** Human label, e.g. "vs last week". */
  label: string;
  /** Custom partial-note text overriding the default "partial · N of Md".
   * Used for intra-day cases like "today" where day-count is 1 of 1 but the
   * day itself is incomplete. */
  partialLabel?: string;
};

const PREV_LABEL: Record<RangePreset, string> = {
  "today": "vs yesterday",
  "yesterday": "vs prev day",
  "this-week": "vs last week",
  "last-week": "vs week before",
  "this-month": "vs last month",
  "last-month": "vs prev month",
  "custom": "vs prev period",
};

/** Previous period of EQUAL length to the current resolved range, ending the
 * day before `current.from`. Same-length is the apples-to-apples comparison
 * the dashboard needs — never 3 days vs 7. */
export function previousRange(
  current: ResolvedRange,
  preset: RangePreset,
  today: string = todayLocal(),
): PreviousRange {
  const daysCompared = daysInclusive(current.from, current.to);
  const fullLength = naturalLength(preset, current, today);

  const prev_to = prevDay(current.from);
  let prev_from = prev_to;
  for (let i = 1; i < daysCompared; i++) prev_from = prevDay(prev_from);

  // Intra-day partial: when the current range ends on today's local day, the
  // final day hasn't fully elapsed yet. For multi-day presets that's already
  // caught by daysCompared < fullLength (e.g. this-week mid-week). But for
  // "today" itself, 1 == 1, so flag it explicitly with a tailored label.
  const endsToday = current.to === today;
  let isPartial = daysCompared < fullLength;
  let partialLabel: string | undefined;

  if (preset === "today" && endsToday) {
    isPartial = true;
    partialLabel = "so far today";
  } else if (preset === "custom" && endsToday && daysCompared === fullLength) {
    // Custom range ending today: final day is in progress.
    isPartial = true;
    partialLabel = "current day in progress";
  }

  return {
    from: prev_from,
    to: prev_to,
    isPartial,
    daysCompared,
    fullLength,
    label: PREV_LABEL[preset],
    partialLabel,
  };
}
