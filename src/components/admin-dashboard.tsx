// Admin operational at-a-glance dashboard. Replaces VaHome for admins at /me.
import { useMemo, useState } from "react";
import { TeamNeedsAttentionWidget } from "./admin-dashboard/team-needs-attention";
import { TeamStatusNowWidget } from "./admin-dashboard/team-status-now";
import { TeamHoursTodayWidget } from "./admin-dashboard/team-hours-today";
import { OnTaskTodayWidget } from "./admin-dashboard/on-task-today";
import { ActiveHours7dWidget } from "./admin-dashboard/active-hours-7d";
import { HoursByClientTodayWidget } from "./admin-dashboard/hours-by-client-today";
// WhosOnlineWidget intentionally not rendered — status tiles deep-link to the
// Team page filtered to each state, so the roster lives there, not here.
import { RangeFilter, LiveBadge } from "./admin-dashboard/range-filter";
import { resolveRange, type RangePreset, type ResolvedRange } from "@/lib/dashboard-range";
import { todayLocal } from "@/lib/reporting";

export function AdminDashboard() {
  const today = todayLocal();
  const [preset, setPreset] = useState<RangePreset>("today");
  const [custom, setCustom] = useState<ResolvedRange>({ from: today, to: today });
  const { from, to } = useMemo(
    () => resolveRange(preset, custom, today),
    [preset, custom, today],
  );

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-display text-3xl">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Team overview at a glance.</p>
        </div>
        <RangeFilter
          preset={preset}
          custom={custom}
          onChange={(n) => { setPreset(n.preset); setCustom(n.custom); }}
        />
      </header>

      {/* Band 1 — Needs attention (live) */}
      <section aria-label="Needs attention (live)" className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-medium">
            Live
          </span>
          <LiveBadge />
          <span className="text-xs text-muted-foreground">
            Always current — not affected by the date filter.
          </span>
        </div>
        <TeamNeedsAttentionWidget />
      </section>

      {/* Band 2 — Presence (live, clickable → Team page filtered) */}
      <section aria-label="Presence (live)" className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-medium">
            Live
          </span>
          <LiveBadge />
          <span className="text-xs text-muted-foreground">
            Click a tile to see who's in that state.
          </span>
        </div>
        <TeamStatusNowWidget />
      </section>

      {/* Band 3 — Ranged performance KPIs */}
      <section aria-label="Ranged metrics" className="space-y-3">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-medium">
          Selected range
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <TeamHoursTodayWidget from={from} to={to} preset={preset} />
          <OnTaskTodayWidget from={from} to={to} preset={preset} />
          <ActiveHours7dWidget from={from} to={to} preset={preset} />
          <HoursByClientTodayWidget from={from} to={to} />
        </div>
      </section>
    </div>
  );
}
