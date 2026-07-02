import { supabase } from "@/integrations/supabase/client";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";

export const REPORT_TZ = "America/New_York";

export type Slice = {
  segment_id: string;
  session_id: string;
  va_id: string;
  kind: "work" | "break";
  client_id: string | null;
  project_id: string | null;
  local_day: string; // 'YYYY-MM-DD' in REPORT_TZ
  slice_start: string;
  slice_end: string;
  active_sec: number;
  idle_sec: number;
};

/** Local Eastern day string ('YYYY-MM-DD') for a given Date. */
export function todayLocal(d: Date = new Date()): string {
  return formatInTimeZone(d, REPORT_TZ, "yyyy-MM-dd");
}

/** UTC ISO instant for 00:00:00 of the given local-day in REPORT_TZ. DST-safe. */
export function tzDayStart(day: string): string {
  return fromZonedTime(`${day}T00:00:00`, REPORT_TZ).toISOString();
}

/** day+1 (calendar) — used to form an exclusive upper bound. Stepped in the
 * report timezone and formatted in the report timezone so the result is the
 * next Eastern calendar day in any browser timezone. Anchoring at noon ET
 * avoids DST-edge double/skipped days. */
export function nextDay(day: string): string {
  const anchorMs = fromZonedTime(`${day}T12:00:00`, REPORT_TZ).getTime();
  return formatInTimeZone(new Date(anchorMs + 86_400_000), REPORT_TZ, "yyyy-MM-dd");
}

/** day-1 (calendar) in REPORT_TZ. Mirror of nextDay — same noon-anchor pattern,
 * DST-safe, works across month and year boundaries because formatInTimeZone
 * always renders the correct ET calendar date for the resulting instant. */
export function prevDay(day: string): string {
  const anchorMs = fromZonedTime(`${day}T12:00:00`, REPORT_TZ).getTime();
  return formatInTimeZone(new Date(anchorMs - 86_400_000), REPORT_TZ, "yyyy-MM-dd");
}

/** Monday of the ET week containing `day` (ISO week, Mon=1..Sun=7). */
export function startOfWeekET(day: string): string {
  const anchor = fromZonedTime(`${day}T12:00:00`, REPORT_TZ);
  // "i" = ISO day of week, 1 (Mon) .. 7 (Sun).
  const iso = parseInt(formatInTimeZone(anchor, REPORT_TZ, "i"), 10);
  let cur = day;
  for (let i = 1; i < iso; i++) cur = prevDay(cur);
  return cur;
}

/** First ET calendar day of the month containing `day`. */
export function startOfMonthET(day: string): string {
  const anchor = fromZonedTime(`${day}T12:00:00`, REPORT_TZ);
  return formatInTimeZone(anchor, REPORT_TZ, "yyyy-MM") + "-01";
}

/** Last ET calendar day of the month containing `day`. Computed as
 * prevDay(firstOfNextMonth), so month length (28/29/30/31) is automatic. */
export function endOfMonthET(day: string): string {
  const first = startOfMonthET(day);
  // Step ~32 days forward from the first, then truncate to that month's 1st —
  // guarantees we land in the next calendar month regardless of length.
  const anchorMs = fromZonedTime(`${first}T12:00:00`, REPORT_TZ).getTime();
  const nextMonthFirst =
    formatInTimeZone(new Date(anchorMs + 32 * 86_400_000), REPORT_TZ, "yyyy-MM") + "-01";
  return prevDay(nextMonthFirst);
}

export async function fetchSlices(
  from: string,
  to: string,
  vaId: string | null,
): Promise<Slice[]> {
  // RPC is typed loose here; types.ts will regenerate later.
  const { data, error } = await (supabase.rpc as any)(
    "report_segment_day_slices",
    { p_from: from, p_to: to, p_va_id: vaId },
  );
  if (error) throw error;
  return (data ?? []) as Slice[];
}
