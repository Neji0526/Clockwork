// Low-engagement detector.
// Active-time samples (one per minute, while clocked-in/not-paused/not-idle)
// where the VA registered no clicks, no typing, and no scrolling.
//
// A "stretch" = consecutive samples with interacted=false whose total
// window_sec is >= thresholdMinutes*60.
//
// PRIVACY NOTE: samples carry counts only — never keystroke values,
// never typed text, never scroll content.

export type EngagementSample = {
  sampled_at: string;
  window_sec: number;
  interacted: boolean;
};

export type LowEngagementStretch = {
  startedAt: string; // ISO
  endedAt: string;   // ISO (exclusive — sampled_at of last sample)
  durationSec: number;
};

export type LowEngagementSummary = {
  totalSec: number;
  stretches: LowEngagementStretch[];
  /** Currently inside a low-engagement stretch (last sample non-interacting and >= threshold). */
  currentlyLow: boolean;
  /** Seconds in the current ongoing low-engagement run (may be < threshold; still useful as "trending"). */
  currentRunSec: number;
};

export function computeLowEngagement(
  samples: EngagementSample[],
  thresholdMinutes: number,
): LowEngagementSummary {
  const thresholdSec = Math.max(60, thresholdMinutes * 60);
  // Ensure chronological order.
  const sorted = [...samples].sort(
    (a, b) => Date.parse(a.sampled_at) - Date.parse(b.sampled_at),
  );

  const stretches: LowEngagementStretch[] = [];
  let runStart: string | null = null;
  let runSec = 0;

  function closeRun(endAt: string) {
    if (runStart && runSec >= thresholdSec) {
      stretches.push({ startedAt: runStart, endedAt: endAt, durationSec: runSec });
    }
    runStart = null;
    runSec = 0;
  }

  for (const s of sorted) {
    if (!s.interacted) {
      if (!runStart) runStart = s.sampled_at;
      runSec += Math.max(1, Math.min(600, s.window_sec || 60));
    } else {
      closeRun(s.sampled_at);
    }
  }
  // Trailing run: only "counts" if it meets the threshold, but expose its size as currentRunSec.
  const currentRunSec = runStart ? runSec : 0;
  const currentlyLow = runStart != null && runSec >= thresholdSec;
  if (runStart && runSec >= thresholdSec) {
    stretches.push({
      startedAt: runStart,
      endedAt: sorted[sorted.length - 1]?.sampled_at ?? runStart,
      durationSec: runSec,
    });
  }

  const totalSec = stretches.reduce((a, s) => a + s.durationSec, 0);
  return { totalSec, stretches, currentlyLow, currentRunSec };
}

export function fmtMin(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}
