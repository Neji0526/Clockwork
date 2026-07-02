import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";

type Sub = {
  /** Public-schema table to listen on. */
  table: string;
  /** Optional Postgres-changes filter, e.g. `va_id=eq.${userId}`. */
  filter?: string;
  /** Event filter (defaults to all). */
  event?: "INSERT" | "UPDATE" | "DELETE" | "*";
  /** Query keys (prefixes) to invalidate when a change fires. */
  invalidate: QueryKey[];
};

/**
 * Subscribes to Postgres changes on one or more tables and invalidates the
 * given React Query keys when rows change. Cleans up on unmount.
 *
 * Pair with existing polling fallbacks — realtime gives instant updates,
 * polling guarantees recovery if a subscription drops.
 */
export function useRealtimeInvalidate(
  channelName: string,
  subs: Sub[],
  enabled: boolean = true,
) {
  const qc = useQueryClient();
  // Stable key — re-subscribe only when filter set actually changes.
  const sig = JSON.stringify(
    subs.map((s) => [s.table, s.filter ?? "", s.event ?? "*"]),
  );

  useEffect(() => {
    if (!enabled || subs.length === 0) return;
    // Unique name per mount — reusing a channel name that is still
    // subscribed (StrictMode double-mount, HMR) makes Realtime throw
    // "cannot add `postgres_changes` callbacks after subscribe()".
    const uniqueName = `${channelName}:${Math.random().toString(36).slice(2, 10)}`;
    let channel = supabase.channel(uniqueName);
    for (const s of subs) {
      channel = (channel as any).on(
        "postgres_changes",
        {
          event: s.event ?? "*",
          schema: "public",
          table: s.table,
          ...(s.filter ? { filter: s.filter } : {}),
        },
        () => {
          for (const key of s.invalidate) {
            qc.invalidateQueries({ queryKey: key });
          }
        },
      );
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, sig, enabled]);
}
