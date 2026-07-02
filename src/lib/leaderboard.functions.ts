import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Weekly leaderboard for the current calendar week (Mon..Sun in user's local
 * time approximated as UTC). Returns one row per active VA with total active
 * seconds this week + their consecutive-day streak (days with any active_sec
 * ending today). Service-role read so VAs can see anonymized team standings
 * without needing broad RLS on work_sessions.
 */
export const getWeeklyLeaderboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const now = new Date();
    const dow = now.getUTCDay(); // 0=Sun..6=Sat
    const daysSinceMon = (dow + 6) % 7;
    const weekStart = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMon,
    ));
    const lastWeekStart = new Date(weekStart);
    lastWeekStart.setUTCDate(lastWeekStart.getUTCDate() - 7);
    const streakSince = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29,
    ));

    const { data: vas, error: vErr } = await supabaseAdmin
      .from("profiles")
      .select("user_id, display_name")
      .eq("role", "va")
      .eq("status", "active");
    if (vErr) throw new Error(vErr.message);

    const { data: sessions, error: sErr } = await supabaseAdmin
      .from("work_sessions")
      .select("va_id, started_at, active_sec")
      .gte("started_at", streakSince.toISOString());
    if (sErr) throw new Error(sErr.message);

    const dayKey = (iso: string) => iso.slice(0, 10);
    const todayKey = now.toISOString().slice(0, 10);

    const weekSec = new Map<string, number>();
    const lastWeekSec = new Map<string, number>();
    const daysActive = new Map<string, Set<string>>();
    for (const s of sessions ?? []) {
      const a = s.active_sec ?? 0;
      if (!a) continue;
      const dk = dayKey(s.started_at);
      const t = new Date(s.started_at).getTime();
      if (t >= weekStart.getTime()) {
        weekSec.set(s.va_id, (weekSec.get(s.va_id) ?? 0) + a);
      } else if (t >= lastWeekStart.getTime()) {
        lastWeekSec.set(s.va_id, (lastWeekSec.get(s.va_id) ?? 0) + a);
      }
      const set = daysActive.get(s.va_id) ?? new Set<string>();
      set.add(dk);
      daysActive.set(s.va_id, set);
    }

    function streakFor(uid: string): number {
      const set = daysActive.get(uid);
      if (!set) return 0;
      let streak = 0;
      const cur = new Date(todayKey + "T00:00:00Z");
      // Allow today OR yesterday to start a streak (worker may not be on yet today)
      if (!set.has(cur.toISOString().slice(0, 10))) {
        cur.setUTCDate(cur.getUTCDate() - 1);
        if (!set.has(cur.toISOString().slice(0, 10))) return 0;
      }
      while (set.has(cur.toISOString().slice(0, 10))) {
        streak++;
        cur.setUTCDate(cur.getUTCDate() - 1);
      }
      return streak;
    }

    const rows = (vas ?? []).map((v) => ({
      userId: v.user_id,
      name: v.display_name ?? "Member",
      isMe: v.user_id === context.userId,
      weekSec: weekSec.get(v.user_id) ?? 0,
      streak: streakFor(v.user_id),
      hasToday: daysActive.get(v.user_id)?.has(todayKey) ?? false,
    }));
    rows.sort((a, b) => b.weekSec - a.weekSec);
    const ranked = rows.map((r, i) => ({ ...r, rank: i + 1 }));

    // Last week's champion (highest active seconds Mon..Sun of previous week)
    let lastWinner: { userId: string; name: string; weekSec: number; isMe: boolean } | null = null;
    for (const v of vas ?? []) {
      const sec = lastWeekSec.get(v.user_id) ?? 0;
      if (sec > 0 && (!lastWinner || sec > lastWinner.weekSec)) {
        lastWinner = {
          userId: v.user_id,
          name: v.display_name ?? "Member",
          weekSec: sec,
          isMe: v.user_id === context.userId,
        };
      }
    }

    const me = ranked.find((r) => r.isMe) ?? null;
    return {
      weekStart: weekStart.toISOString(),
      lastWeekStart: lastWeekStart.toISOString(),
      top: ranked.slice(0, 5),
      me,
      teamSize: ranked.length,
      lastWinner,
    };
  });
