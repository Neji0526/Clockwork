// Who's online — compact presence widget. LIVE; not driven by the date filter.
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useTeamStatusNow, type TeamMemberStatus } from "@/hooks/use-team-status-now";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { LiveState } from "@/lib/live-status";

const ORDER: Record<LiveState, number> = { working: 0, break: 1, idle: 2, off: 3 };

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

export function WhosOnlineWidget() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const { members, isLoading } = useTeamStatusNow(now);

  const { onList, offList } = useMemo(() => {
    const sorted = [...members].sort((a, b) => {
      const da = ORDER[a.status.state] - ORDER[b.status.state];
      if (da !== 0) return da;
      return a.name.localeCompare(b.name);
    });
    return {
      onList: sorted.filter((m) => m.status.state !== "off"),
      offList: sorted.filter((m) => m.status.state === "off"),
    };
  }, [members]);

  return (
    <section
      aria-label="Online"
      className="rounded-xl border border-border bg-card/60 p-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
          Online
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {isLoading ? "—" : (
            <>
              <span className="text-foreground font-medium">{onList.length}</span> on ·{" "}
              <span className="text-foreground font-medium">{offList.length}</span> off
            </>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="mt-3 text-xs text-muted-foreground">Loading…</div>
      ) : members.length === 0 ? (
        <div className="mt-3 text-xs text-muted-foreground italic">No teammates yet.</div>
      ) : (
        <ul className="mt-4 space-y-2">
          {onList.map((m) => (
            <PresenceRow key={m.vaId} member={m} now={now} dimmed={false} />
          ))}
          {offList.map((m) => (
            <PresenceRow key={m.vaId} member={m} now={now} dimmed />
          ))}
        </ul>
      )}

      <div className="mt-4 pt-3 border-t border-border/60">
        <Link
          to="/admin"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
        >
          View full team
          <ArrowRight className="size-3" />
        </Link>
      </div>
    </section>
  );
}

function PresenceRow({
  member,
  now,
  dimmed,
}: {
  member: TeamMemberStatus;
  now: number;
  dimmed: boolean;
}) {
  const { status, name, sessionStartedAt } = member;
  const timeOnSec =
    sessionStartedAt
      ? Math.max(0, Math.floor((now - new Date(sessionStartedAt).getTime()) / 1000))
      : 0;

  return (
    <li
      className={
        "flex items-center gap-3 " +
        (dimmed ? "opacity-55" : "")
      }
    >
      <span
        aria-hidden
        className={`inline-block size-2 rounded-full shrink-0 ${status.dotClass}`}
        title={status.label}
      />
      <Avatar className="size-7">
        <AvatarFallback className="text-[10px] font-medium">
          {initialsOf(name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 flex items-baseline justify-between gap-2">
        <span className="truncate text-sm text-foreground">{name}</span>
        {sessionStartedAt ? (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {formatDuration(timeOnSec)}
          </span>
        ) : (
          <span className="shrink-0 text-xs text-muted-foreground">Off</span>
        )}
      </div>
    </li>
  );
}
