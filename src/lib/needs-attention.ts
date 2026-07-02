// Pure "needs attention" computation. Used by both the per-VA strip
// (admin_.$vaId page) and the team-wide widget on the admin dashboard.
// No React, no Supabase — callers fetch and pass the inputs in.

export type BreakSeg = {
  id: string;
  session_id: string;
  started_at: string;
  ended_at: string | null;
};

export type SessionSeg = {
  id: string;
  client_id: string | null;
  active_sec: number | null;
};

export type AdminAction = {
  id: string;
  action: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

export type NeedsAttentionKind =
  | "live-stale"
  | "live-long-break"
  | "live-low-engagement"
  | "untagged-work"
  | "session-stale-closed"
  | "session-break-capped"
  | "session-adjusted";

export type NeedsAttentionFlag = {
  /** Stable per (vaId, kind, source id). */
  key: string;
  kind: NeedsAttentionKind;
  /** Plain text, already formatted — same wording as the legacy strip. */
  message: string;
  /** ISO timestamp the flag is anchored at (event time / live anchor). */
  when: string | null;
  vaId: string;
};

export const UNTAGGED_THRESHOLD_SEC = 300; // 5 minutes
export const UNTAGGED_THRESHOLD_MIN = UNTAGGED_THRESHOLD_SEC / 60;

export function fmtMinNA(sec: number): string {
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function isTodayIso(iso: string, now: number = Date.now()): boolean {
  return new Date(iso).toDateString() === new Date(now).toDateString();
}

export type NeedsAttentionInput = {
  vaId: string;
  activeSession: { id: string; last_activity_at: string | null } | null;
  todayBreaks: BreakSeg[];
  todaySegments: SessionSeg[];
  sessionTimeoutMin: number;
  maxBreakSec: number;
  lowEngagementOngoing: boolean;
  lowEngagementRunSec: number;
  /** Already filtered to this VA — exactly what the strip computes today. */
  adminActions: AdminAction[];
  now?: number;
};

export type NeedsAttentionResult = {
  todayFlags: NeedsAttentionFlag[];
  earlierCount: number;
};

export function computeNeedsAttention(input: NeedsAttentionInput): NeedsAttentionResult {
  const {
    vaId, activeSession, todayBreaks, todaySegments,
    sessionTimeoutMin, maxBreakSec,
    lowEngagementOngoing, lowEngagementRunSec,
    adminActions,
  } = input;
  const now = input.now ?? Date.now();

  const flags: NeedsAttentionFlag[] = [];

  // 1. Live: stale active session.
  if (activeSession?.last_activity_at) {
    const ageSec = (now - new Date(activeSession.last_activity_at).getTime()) / 1000;
    if (ageSec > sessionTimeoutMin * 60) {
      flags.push({
        key: `${vaId}:live-stale`,
        kind: "live-stale",
        vaId,
        message: `Active session hasn't sent data in ${fmtMinNA(ageSec)} — will auto-close at ${sessionTimeoutMin} min.`,
        when: activeSession.last_activity_at,
      });
    }
  }

  // 2. Live: long-running open break.
  const openBreak = todayBreaks.find((b) => !b.ended_at);
  if (openBreak) {
    const ageSec = (now - new Date(openBreak.started_at).getTime()) / 1000;
    if (ageSec >= 0.75 * maxBreakSec) {
      const capMin = Math.round(maxBreakSec / 60);
      const belongsToActive =
        activeSession?.id != null && openBreak.session_id === activeSession.id;
      flags.push({
        key: `${vaId}:live-long-break`,
        kind: "live-long-break",
        vaId,
        message: belongsToActive
          ? `Open break running ${fmtMinNA(ageSec)} — auto-caps at ${capMin} min.`
          : `Orphaned open break — ${fmtMinNA(ageSec)} long, parent session already ended (won't auto-cap).`,
        when: openBreak.started_at,
      });
    }
  }

  // 3. Live: low engagement in progress.
  if (lowEngagementOngoing) {
    flags.push({
      key: `${vaId}:live-low-engagement`,
      kind: "live-low-engagement",
      vaId,
      message: `Low engagement in progress — ${fmtMinNA(lowEngagementRunSec)} with no clicks, typing, or scrolling.`,
      when: null,
    });
  }

  // 4. Today's admin_actions.
  const todayActions: NeedsAttentionFlag[] = [];
  let earlierCount = 0;
  for (const a of adminActions) {
    if (isTodayIso(a.created_at, now)) todayActions.push(actionToFlag(a, vaId));
    else earlierCount++;
  }
  // adminActions arrives newest-first from the strip's query; preserve that order.
  flags.push(...todayActions);

  // 5. Untagged work: removed as a needs-attention flag.
  // Still surfaced informationally via the "Hours by client" widget's Untagged bucket.
  void todaySegments;

  return { todayFlags: flags, earlierCount };
}

export function actionToFlag(a: AdminAction, vaId: string): NeedsAttentionFlag {
  const m = (a.metadata ?? {}) as Record<string, unknown>;
  if (a.action === "session_stale_closed") {
    const timeout = typeof m.timeout_minutes === "number" ? m.timeout_minutes : null;
    return {
      key: a.id,
      kind: "session-stale-closed",
      vaId,
      message: `Session auto-closed as abandoned${timeout ? ` after ${timeout} min of no activity` : ""}.`,
      when: a.created_at,
    };
  }
  if (a.action === "session_break_capped") {
    const cap = typeof m.max_break_sec === "number" ? Math.round(m.max_break_sec / 60) : null;
    return {
      key: a.id,
      kind: "session-break-capped",
      vaId,
      message: `Break auto-capped${cap ? ` at the ${cap} min limit` : ""}; session closed.`,
      when: a.created_at,
    };
  }
  // session_adjusted
  const patch = (m.patch ?? {}) as Record<string, unknown>;
  const fields = Object.keys(patch).filter((k) => k !== "status");
  return {
    key: a.id,
    kind: "session-adjusted",
    vaId,
    message: `Admin adjusted a session${fields.length ? ` (${fields.join(", ")})` : ""}.`,
    when: a.created_at,
  };
}

/** Icon key the UI maps to a lucide icon. Pure mapping — UI owns the actual node. */
export function iconKeyFor(kind: NeedsAttentionKind): "alert" | "clock" | "edit" | "tag" {
  switch (kind) {
    case "live-stale":
    case "live-low-engagement":
    case "session-stale-closed":
      return "alert";
    case "live-long-break":
    case "session-break-capped":
      return "clock";
    case "session-adjusted":
      return "edit";
    case "untagged-work":
      return "tag";
  }
}
