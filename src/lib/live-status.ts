// Shared mutually-exclusive "what is this VA doing right now?" helper.
// Used by Admin Today, Admin Live, and the VA detail page hero badge so the
// three live states render consistently everywhere.

export type LiveState = "working" | "break" | "idle" | "off";

export type LiveStatusInput = {
  /** Active work_session (status='active') if any. Null/undefined = off the clock. */
  activeSession?: { id: string; started_at: string } | null;
  /** Open break_segment (ended_at is null) belonging to the active session, if any. */
  openBreak?: { started_at: string } | null;
  /** Latest idle_segment row (the extension emits these post-fact when active resumes). */
  latestIdle?: { started_at: string } | null;
  /** "now" reference for live tick — defaults to Date.now(). */
  now?: number;
  /** Minutes of no input before "working" flips to "idle". Defaults to 5. */
  idleThresholdMin?: number;
  /**
   * Last time we heard anything from this session (activity, screenshot, idle, break, engagement).
   * If older than `sessionTimeoutMin`, the session is treated as stale and falls back to "off"
   * even though `work_sessions.status` is still 'active' — the auto-close job will end it shortly.
   */
  lastActivityAt?: string | null;
  /** Minutes of no heartbeat after which a session is considered stale. Defaults to 10. */
  sessionTimeoutMin?: number;
};


export type LiveStatus = {
  state: LiveState;
  /** Human label, e.g. "Working now", "On break", "Idle", "Off the clock". */
  label: string;
  /** Tailwind background color token for the status dot. */
  dotClass: string;
  /** Tailwind text color token (matches the dot). */
  textClass: string;
  /** Ring/border token for callouts. */
  ringClass: string;
  /** Pill background+text+border combo. */
  pillClass: string;
  /** ISO timestamp the current state started at, for "X ago" duration. */
  since: string | null;
  /** Seconds elapsed since `since`. 0 if no anchor. */
  sinceSec: number;
};

export function computeLiveStatus(input: LiveStatusInput): LiveStatus {
  const now = input.now ?? Date.now();
  const idleThresholdMs = (input.idleThresholdMin ?? 5) * 60_000;
  const sessionTimeoutMs = (input.sessionTimeoutMin ?? 10) * 60_000;

  // 1) No active session → off the clock.
  if (!input.activeSession) {
    return {
      state: "off",
      label: "Off the clock",
      dotClass: "bg-muted-foreground/40",
      textClass: "text-muted-foreground",
      ringClass: "ring-muted-foreground/20",
      pillClass: "bg-muted text-muted-foreground border border-border",
      since: null,
      sinceSec: 0,
    };
  }

  // 2) Open break — authoritative over heartbeat staleness. A VA on break
  //    generates no activity_events, so last_activity_at will go stale; that
  //    must NOT flip them to "Stopped responding".
  if (input.openBreak) {
    const since = input.openBreak.started_at;
    return {
      state: "break",
      label: "On break",
      dotClass: "bg-warning",
      textClass: "text-warning",
      ringClass: "ring-warning/40",
      pillClass: "bg-warning/15 text-warning border border-warning/40",
      since,
      sinceSec: Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000)),
    };
  }

  // 3) Stale heartbeat (clocked in, not on break) → stopped responding.
  const stale = !!(
    input.lastActivityAt &&
    now - new Date(input.lastActivityAt).getTime() > sessionTimeoutMs
  );
  if (stale) {
    return {
      state: "off",
      label: "Stopped responding",
      dotClass: "bg-muted-foreground/40",
      textClass: "text-muted-foreground",
      ringClass: "ring-muted-foreground/20",
      pillClass: "bg-muted text-muted-foreground border border-border",
      since: null,
      sinceSec: 0,
    };
  }

  // 4) Recent idle_segment within threshold → idle.
  const idleRecently = !!(input.latestIdle && (now - new Date(input.latestIdle.started_at).getTime()) < idleThresholdMs);
  if (idleRecently) {
    const since = input.latestIdle!.started_at;
    return {
      state: "idle",
      label: "Idle",
      dotClass: "bg-muted-foreground/60",
      textClass: "text-muted-foreground",
      ringClass: "ring-muted-foreground/25",
      pillClass: "bg-muted text-muted-foreground border border-border",
      since,
      sinceSec: Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000)),
    };
  }


  return {
    state: "working",
    label: "Working now",
    dotClass: "bg-success",
    textClass: "text-success",
    ringClass: "ring-success/40",
    pillClass: "bg-success/15 text-success border border-success/40",
    since: input.activeSession.started_at,
    sinceSec: Math.max(0, Math.floor((now - new Date(input.activeSession.started_at).getTime()) / 1000)),
  };
}
