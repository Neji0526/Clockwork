// Shared helpers for Financials (Invoices + Payroll panels) and for
// admin.tsx (Timesheets export, etc). Lifted from src/routes/admin.tsx
// when Financials was promoted to its own /financials route, so both the
// new route and the rest of Team keep one source of truth.

export function secsToHours(s: number) {
  return (s / 3600).toFixed(2);
}

export function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// Monday-anchored week. Returns the Monday of the week containing `d`.
export function mondayOf(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = x.getDay(); // 0 sun .. 6 sat
  const diff = dow === 0 ? -6 : 1 - dow;
  x.setDate(x.getDate() + diff);
  return x;
}

export function startOfMonth(d: Date) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfMonth(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  x.setHours(0, 0, 0, 0);
  return x;
}

export type PayrollPreset =
  | "this-week"
  | "last-week"
  | "last-2-weeks"
  | "this-month"
  | "last-month"
  | "custom";

export function presetRange(p: PayrollPreset, today: Date): { start: Date; end: Date } {
  const t = new Date(today);
  t.setHours(0, 0, 0, 0);
  if (p === "this-week") {
    const s = mondayOf(t);
    return { start: s, end: addDays(s, 7) };
  }
  if (p === "last-week") {
    const s = addDays(mondayOf(t), -7);
    return { start: s, end: addDays(s, 7) };
  }
  if (p === "last-2-weeks") {
    const s = addDays(mondayOf(t), -14);
    return { start: s, end: addDays(mondayOf(t), 0) };
  }
  if (p === "this-month") return { start: startOfMonth(t), end: endOfMonth(t) };
  if (p === "last-month") {
    const lm = new Date(t.getFullYear(), t.getMonth() - 1, 1);
    return { start: startOfMonth(lm), end: startOfMonth(t) };
  }
  return { start: addDays(t, -14), end: addDays(t, 1) };
}

export function fmtRange(start: Date, end: Date) {
  const e = addDays(end, -1); // end is exclusive
  const f = (x: Date) =>
    x.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${f(start)} → ${f(e)}`;
}
