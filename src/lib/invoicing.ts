// Shared helpers for client invoicing.

export type BillableRow = {
  va_id: string;
  va_name: string;
  active_sec: number;
  break_sec: number;
  billable_sec: number;
  hours: number;
};

export function fmtMoney(cents: number, currency = "USD") {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format((cents ?? 0) / 100);
  } catch {
    return `${currency} ${((cents ?? 0) / 100).toFixed(2)}`;
  }
}

export function secsToHours(sec: number) {
  return Math.round(((sec ?? 0) / 3600) * 100) / 100;
}

export function statusBadgeClass(status: string) {
  switch (status) {
    case "paid":
      return "bg-emerald-500/15 text-emerald-600 ring-1 ring-emerald-500/30";
    case "sent":
      return "bg-blue-500/15 text-blue-600 ring-1 ring-blue-500/30";
    default:
      return "bg-muted text-muted-foreground ring-1 ring-border";
  }
}
