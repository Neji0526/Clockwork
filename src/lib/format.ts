export function fmtDuration(sec: number) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Human-friendly duration from hours: >=1h → "X.Xh", >=1m → "Xm", else "Xs". */
export function fmtHoursHuman(hours: number) {
  if (!isFinite(hours) || hours <= 0) return "0s";
  const sec = Math.round(hours * 3600);
  if (sec >= 3600) return `${(sec / 3600).toFixed(1)}h`;
  if (sec >= 60) return `${Math.floor(sec / 60)}m`;
  return `${sec}s`;
}

/** Same rules but from seconds input. */
export function fmtSecHuman(sec: number) {
  return fmtHoursHuman((sec || 0) / 3600);
}

export function fmtClock(sec: number) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600).toString().padStart(2, "0");
  const m = Math.floor((sec % 3600) / 60).toString().padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function hostOf(url: string | null | undefined) {
  if (!url) return "";
  try { return new URL(url).host; } catch { return url; }
}
