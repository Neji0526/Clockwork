import { ArrowRight, Briefcase } from "lucide-react";

// Display-only chronological view of session_segments for a single day,
// across all sessions for one VA. Mirrors the per-session SegmentTimeline
// vocabulary (client chips + arrows) but takes pre-fetched data. Durations
// are wall-clock per segment — same caveat as SegmentTimeline: this won't
// match Reporting (which sums active_sec excluding idle).

type Seg = {
  id: string;
  session_id: string;
  client_id: string | null;
  started_at: string;
  ended_at: string | null;
  active_sec: number | null;
};

function fmtDur(sec: number) {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

export function DaySegmentTimeline({
  segments,
  clientMap,
}: {
  segments: Seg[];
  clientMap: Map<string, string>;
}) {
  const now = Date.now();
  const items = segments
    .map((s) => {
      const live = !s.ended_at;
      const wallSec = Math.max(
        0,
        Math.round(
          ((live ? now : new Date(s.ended_at!).getTime()) -
            new Date(s.started_at).getTime()) / 1000,
        ),
      );
      return { ...s, live, wallSec };
    })
    // Hide zero-duration seed segments (auto-opened "no client" stubs closed
    // within a second when the VA picked a client).
    .filter((s) => s.live || s.wallSec >= 2);

  if (items.length === 0) return null;

  return (
    <div className="pt-4 mt-4 border-t border-border">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-2 flex items-center gap-1">
        <Briefcase className="size-3" /> Switches today
      </div>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-sm">
        {items.map((s, i) => {
          const name = s.client_id
            ? (clientMap.get(s.client_id) ?? "Unknown client")
            : "Untagged";
          return (
            <span key={s.id} className="inline-flex items-center gap-1.5">
              {i > 0 && <ArrowRight className="size-3.5 text-muted-foreground" />}
              <span
                className={
                  "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 " +
                  (s.live
                    ? "border-success/40 bg-success/10"
                    : s.client_id
                      ? "border-border bg-muted/40"
                      : "border-warning/30 bg-warning/5")
                }
              >
                <span className="font-medium">{name}</span>
                <span className="tabular-nums text-muted-foreground text-xs">
                  {s.live ? "live" : fmtDur(s.wallSec)}
                </span>
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
