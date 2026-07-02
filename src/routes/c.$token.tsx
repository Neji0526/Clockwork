import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getClientShareView } from "@/lib/client-share.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDuration, fmtHoursHuman, fmtSecHuman } from "@/lib/format";
import { Clock, ShieldCheck, CalendarDays, Eye, EyeOff, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/c/$token")({
  head: () => ({
    meta: [
      { title: "ClockWork — Shared report" },
      { name: "description", content: "Read-only snapshot of a virtual assistant's recent work for one brand." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ClientShareView,
});

function ClientShareView() {
  const { token } = useParams({ from: "/c/$token" });
  const fetchView = useServerFn(getClientShareView);
  const q = useQuery({
    queryKey: ["client-share", token],
    queryFn: () => fetchView({ data: { token } }),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  if (q.isLoading) {
    return (
      <div className="min-h-screen grid place-items-center text-muted-foreground text-sm">
        <div className="flex items-center gap-2">
          <RefreshCw className="size-3.5 animate-spin" /> Loading report…
        </div>
      </div>
    );
  }

  const v = q.data;
  if (!v?.ok) {
    const reason = v?.reason ?? "not_found";
    const label =
      reason === "expired" ? "This share link has expired."
      : reason === "revoked" ? "This share link was revoked."
      : reason === "legacy_token_reissue_required" ? "This share link was created before per-brand scoping and is no longer valid. Ask whoever shared it for a new link."
      : "This share link isn't valid.";
    return (
      <div className="min-h-screen grid place-items-center px-6 bg-background">
        <div className="text-center max-w-md space-y-3">
          <div className="text-[10px] uppercase tracking-[0.22em] text-gold/90 font-medium">ClockWork</div>
          <ShieldCheck className="size-10 text-muted-foreground mx-auto" />
          <h1 className="font-display text-3xl leading-tight">Link unavailable</h1>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
      </div>
    );
  }

  const activeDays = v.daily.filter(d => d.activeSec > 0).length;
  const activeHours = v.totals.activeSec / 3600;
  const avgPerDay = v.totals.activeSec / Math.max(1, activeDays) / 3600;
  const max = Math.max(1, ...v.daily.map(d => d.activeSec));

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-gradient-to-b from-gold/[0.04] to-transparent">
        <div className="max-w-4xl mx-auto px-6 pt-10 pb-8">
          <div className="text-[10px] uppercase tracking-[0.22em] text-gold/90 font-medium">
            ClockWork · Shared report
          </div>
          <h1 className="font-display text-4xl md:text-5xl leading-[1.05] mt-2">
            {v.vaName}'s last {v.windowDays} days
          </h1>
          <p className="text-sm text-muted-foreground mt-3 max-w-xl">
            {v.label ? `Prepared for ${v.label}. ` : ""}A calm, read-only snapshot of hours worked on your account — nothing private, nothing from other brands.
          </p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <HeroStat
            icon={<Clock className="size-3.5" />}
            label="Active hours"
            value={fmtHoursHuman(activeHours)}
            caption={`${v.totals.sessions} session${v.totals.sessions === 1 ? "" : "s"} on your account`}
          />
          <HeroStat
            icon={<CalendarDays className="size-3.5" />}
            label="Avg per active day"
            value={fmtHoursHuman(avgPerDay)}
            caption={`${activeDays} of ${v.windowDays} days`}
          />
          <HeroStat
            icon={<CalendarDays className="size-3.5" />}
            label="Window"
            value={`${v.windowDays}d`}
            caption="Eastern time"
          />
        </div>

        <section className="grid sm:grid-cols-3 gap-2.5">
          <Promise icon={<Eye />} title="What you see" body="Only your account's hours and sessions." />
          <Promise icon={<EyeOff />} title="What's hidden" body="Other brands, screenshots, URLs, raw activity." />
          <Promise icon={<RefreshCw />} title="Stays fresh" body="Refreshes automatically every 5 minutes." />
        </section>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-baseline justify-between">
            <div>
              <CardTitle className="text-base">Daily activity</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Active hours per day on your account · last {v.windowDays} days</p>
            </div>
            <div className="text-[11px] text-muted-foreground tabular-nums hidden sm:block">
              Peak {fmtSecHuman(max)}
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-[3px] h-36">
              {v.daily.map((d, i) => {
                const h = (d.activeSec / max) * 100;
                const isToday = i === v.daily.length - 1;
                return (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                    <div className="w-full flex-1 flex items-end">
                      <div
                        title={`${d.date} · ${fmtSecHuman(d.activeSec)}`}
                        className={`w-full rounded-sm transition-colors ${
                          d.activeSec === 0
                            ? "bg-muted/40"
                            : isToday
                              ? "bg-gold/80 hover:bg-gold"
                              : "bg-gold/30 hover:bg-gold/60"
                        }`}
                        style={{ height: `${Math.max(2, h)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground mt-2 tabular-nums">
              <span>{fmtMonthDay(v.daily[0].date)}</span>
              <span>{fmtMonthDay(v.daily[Math.floor(v.daily.length / 2)].date)}</span>
              <span>Today</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent sessions on your account</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Most recent 10 · times shown in your local timezone · only the portion spent on your work</p>
          </CardHeader>
          <CardContent>
            {v.recentSessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sessions on your account in this window.</p>
            ) : (
              <div className="divide-y divide-border">
                {v.recentSessions.map((s, i) => (
                  <div key={i} className="py-2.5 flex items-center justify-between text-sm">
                    <span>
                      <span className="font-medium">
                        {new Date(s.startedAt).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
                      </span>{" "}
                      <span className="text-muted-foreground">
                        · {new Date(s.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        {s.endedAt && ` → ${new Date(s.endedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                      </span>
                    </span>
                    <span className="tabular-nums font-display">{fmtDuration(s.activeSec)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <footer className="text-center text-[11px] text-muted-foreground pt-2 pb-8 space-y-1">
          <div className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-3 text-gold/80" />
            Read-only · refreshes every 5 minutes
          </div>
          <div>Powered by ClockWork</div>
        </footer>
      </main>
    </div>
  );
}

function HeroStat({
  icon, label, value, caption,
}: { icon: React.ReactNode; label: string; value: string; caption: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-4">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        <span className="text-gold/80">{icon}</span>
        {label}
      </div>
      <div className="font-display text-3xl md:text-4xl mt-2 leading-none tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground mt-1.5">{caption}</div>
    </div>
  );
}

function Promise({
  icon, title, body,
}: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/30 px-3.5 py-3 flex gap-2.5">
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-gold/10 ring-1 ring-gold/30 text-gold/90 [&_svg]:size-3.5">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[11px] font-medium">{title}</div>
        <div className="text-[11px] text-muted-foreground leading-snug mt-0.5">{body}</div>
      </div>
    </div>
  );
}

function fmtMonthDay(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
