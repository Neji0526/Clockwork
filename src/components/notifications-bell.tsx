import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Bell, FileQuestion, Coffee, ArrowRight, Inbox, Timer, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";

/**
 * Admin-only notifications bell. Surfaces things that need a human:
 *  - SOPs flagged as needs_review
 *  - Active VAs whose current break is past the configured max (still on break)
 *  - Live sessions idle past the configured threshold (no input for a while)
 *  - Invoices that flipped to "paid" in the last 24h (informational)
 *
 * Reads small, denormalized counts so the bell stays cheap to render on every
 * page. Subscribes to realtime so a freshly flagged SOP lights up without a
 * page refresh.
 */
const LONG_IDLE_SEC = 15 * 60; // 15 minutes

export function NotificationsBell() {
  const [open, setOpen] = useState(false);

  // SOPs needing review
  const sopsQ = useQuery({
    queryKey: ["notif-sops-needs-review"],
    queryFn: async () => {
      const { data } = await supabase
        .from("sops")
        .select("id, title, updated_at")
        .eq("needs_review", true)
        .order("updated_at", { ascending: false })
        .limit(8);
      return data ?? [];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // Max break threshold for "still on break" alerts
  const configQ = useQuery({
    queryKey: ["notif-config"],
    queryFn: async () => {
      const { data } = await supabase
        .from("app_config")
        .select("max_break_sec")
        .eq("id", 1)
        .maybeSingle();
      return data;
    },
    staleTime: 5 * 60_000,
  });
  const maxBreakSec = configQ.data?.max_break_sec ?? 60 * 60;

  // Open breaks past the cap
  const longBreaksQ = useQuery({
    queryKey: ["notif-long-breaks", maxBreakSec],
    queryFn: async () => {
      const cutoff = new Date(Date.now() - maxBreakSec * 1000).toISOString();
      const { data: breaks } = await supabase
        .from("break_segments")
        .select("id, va_id, started_at, reason")
        .is("ended_at", null)
        .lte("started_at", cutoff)
        .order("started_at", { ascending: true })
        .limit(8);
      if (!breaks?.length) return [];
      const vaIds = Array.from(new Set(breaks.map((b) => b.va_id)));
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", vaIds);
      const nameMap = new Map((profs ?? []).map((p) => [p.user_id, p.display_name ?? "Member"]));
      return breaks.map((b) => ({ ...b, name: nameMap.get(b.va_id) ?? "Member" }));
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // Live sessions that haven't logged input recently
  const longIdleQ = useQuery({
    queryKey: ["notif-long-idle"],
    queryFn: async () => {
      const cutoff = new Date(Date.now() - LONG_IDLE_SEC * 1000).toISOString();
      const { data: sessions } = await supabase
        .from("work_sessions")
        .select("id, va_id, last_activity_at")
        .eq("status", "active")
        .lte("last_activity_at", cutoff)
        .order("last_activity_at", { ascending: true })
        .limit(8);
      if (!sessions?.length) return [];
      const vaIds = Array.from(new Set(sessions.map((s) => s.va_id)));
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", vaIds);
      const nameMap = new Map((profs ?? []).map((p) => [p.user_id, p.display_name ?? "Member"]));
      return sessions.map((s) => ({ ...s, name: nameMap.get(s.va_id) ?? "Member" }));
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // Invoices flipped to paid in the last 24h
  const paidInvoicesQ = useQuery({
    queryKey: ["notif-paid-invoices"],
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("invoices")
        .select("id, number, total_cents, currency, updated_at, client_id")
        .eq("status", "paid")
        .gte("updated_at", cutoff)
        .order("updated_at", { ascending: false })
        .limit(8);
      if (!data?.length) return [];
      const clientIds = Array.from(new Set(data.map((i) => i.client_id)));
      const { data: clients } = await supabase
        .from("clients")
        .select("id, name")
        .in("id", clientIds);
      const nameMap = new Map((clients ?? []).map((c) => [c.id, c.name]));
      return data.map((i) => ({ ...i, clientName: nameMap.get(i.client_id) ?? "Client" }));
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  useRealtimeInvalidate("notif-bell", [
    { table: "sops", invalidate: [["notif-sops-needs-review"]] },
    { table: "break_segments", invalidate: [["notif-long-breaks", maxBreakSec]] },
    { table: "work_sessions", invalidate: [["notif-long-idle"]] },
    { table: "invoices", invalidate: [["notif-paid-invoices"]] },
  ]);

  const sops = sopsQ.data ?? [];
  const breaks = longBreaksQ.data ?? [];
  const idles = longIdleQ.data ?? [];
  const paid = paidInvoicesQ.data ?? [];
  // Action items (red dot) — informational paid invoices don't count toward the badge.
  const actionable = sops.length + breaks.length + idles.length;
  const total = actionable + paid.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Notifications${total ? ` (${total})` : ""}`}
          className="relative h-9 w-9 p-0"
        >
          <Bell className="size-4" />
          {actionable > 0 && (
            <span className="absolute top-1 right-1 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground tabular-nums leading-none">
              {actionable > 9 ? "9+" : actionable}
            </span>
          )}
          {actionable === 0 && paid.length > 0 && (
            <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-gold" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[340px] p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-[0.22em] text-gold/90 font-medium">
            {actionable > 0 ? "Needs attention" : "Notifications"}
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">{total}</span>
        </div>

        {total === 0 ? (
          <div className="px-6 py-10 text-center">
            <Inbox className="size-6 text-muted-foreground mx-auto mb-2" />
            <div className="text-sm font-medium">All clear</div>
            <p className="text-xs text-muted-foreground mt-1">Nothing to review, nothing overdue. Nice.</p>
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto divide-y divide-border">
            {idles.length > 0 && (
              <div className="px-4 py-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2 flex items-center gap-1.5">
                  <Timer className="size-3" /> Long idle ({Math.round(LONG_IDLE_SEC / 60)}m+)
                </div>
                <ul className="space-y-1.5">
                  {idles.map((s) => {
                    const mins = s.last_activity_at
                      ? Math.floor((Date.now() - new Date(s.last_activity_at).getTime()) / 60_000)
                      : 0;
                    return (
                      <li key={s.id}>
                        <Link
                          to="/admin/$vaId"
                          params={{ vaId: s.va_id }}
                          onClick={() => setOpen(false)}
                          className="group flex items-center gap-2 rounded-md px-2 py-1.5 -mx-2 hover:bg-accent/50 transition-colors"
                        >
                          <span className="size-1.5 rounded-full bg-destructive shrink-0" />
                          <span className="text-sm truncate flex-1">
                            {s.name}
                            <span className="text-muted-foreground ml-1">· {mins}m idle</span>
                          </span>
                          <ArrowRight className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {sops.length > 0 && (
              <div className="px-4 py-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2 flex items-center gap-1.5">
                  <FileQuestion className="size-3" /> SOPs flagged for review
                </div>
                <ul className="space-y-1.5">
                  {sops.map((s) => (
                    <li key={s.id}>
                      <Link
                        to="/sops/$sopId"
                        params={{ sopId: s.id }}
                        onClick={() => setOpen(false)}
                        className="group flex items-center gap-2 rounded-md px-2 py-1.5 -mx-2 hover:bg-accent/50 transition-colors"
                      >
                        <span className="size-1.5 rounded-full bg-warning shrink-0" />
                        <span className="text-sm truncate flex-1">{s.title}</span>
                        <ArrowRight className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {breaks.length > 0 && (
              <div className="px-4 py-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2 flex items-center gap-1.5">
                  <Coffee className="size-3" /> Long breaks ({Math.round(maxBreakSec / 60)}m+)
                </div>
                <ul className="space-y-1.5">
                  {breaks.map((b) => {
                    const mins = Math.floor((Date.now() - new Date(b.started_at).getTime()) / 60_000);
                    return (
                      <li key={b.id}>
                        <Link
                          to="/admin/$vaId"
                          params={{ vaId: b.va_id }}
                          onClick={() => setOpen(false)}
                          className="group flex items-center gap-2 rounded-md px-2 py-1.5 -mx-2 hover:bg-accent/50 transition-colors"
                        >
                          <span className="size-1.5 rounded-full bg-amber-500 shrink-0" />
                          <span className="text-sm truncate flex-1">
                            {b.name}
                            <span className="text-muted-foreground ml-1">· {mins}m on break</span>
                          </span>
                          <ArrowRight className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {paid.length > 0 && (
              <div className="px-4 py-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2 flex items-center gap-1.5">
                  <CheckCircle2 className="size-3" /> Recently paid
                </div>
                <ul className="space-y-1.5">
                  {paid.map((inv) => {
                    const amount = (inv.total_cents / 100).toLocaleString(undefined, {
                      style: "currency",
                      currency: inv.currency || "USD",
                    });
                    return (
                      <li key={inv.id}>
                        <Link
                          to="/admin/invoices/$invoiceId"
                          params={{ invoiceId: inv.id }}
                          onClick={() => setOpen(false)}
                          className="group flex items-center gap-2 rounded-md px-2 py-1.5 -mx-2 hover:bg-accent/50 transition-colors"
                        >
                          <span className="size-1.5 rounded-full bg-success shrink-0" />
                          <span className="text-sm truncate flex-1">
                            #{inv.number} · {inv.clientName}
                            <span className="text-muted-foreground ml-1">· {amount}</span>
                          </span>
                          <ArrowRight className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="px-4 py-2 border-t border-border bg-muted/30">
          <Link
            to="/admin"
            onClick={() => setOpen(false)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center justify-between"
          >
            Open admin dashboard <ArrowRight className="size-3" />
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
