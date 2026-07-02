import { createFileRoute } from "@tanstack/react-router";

// Nightly job: delete expired screenshots from the va-screenshots bucket
// and clear their references. Never deletes a screenshot referenced by a
// generated SOP. Called by pg_cron via pg_net (apikey header required).
//
// Auth: /api/public/* bypasses platform auth — we still require the project's
// publishable apikey header so randoms can't trigger it.
export const Route = createFileRoute("/api/public/hooks/cleanup-screenshots")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Auth: require the server-only secret stored in public.internal_secrets
        // (readable only by service_role; cron reads it as the postgres role).
        // The Supabase publishable/anon key is PUBLIC and must never gate this.
        const provided = request.headers.get("x-cleanup-auth") ?? "";
        const { data: secretRow } = await supabaseAdmin
          .from("internal_secrets" as never)
          .select("value")
          .eq("name", "cleanup_webhook_secret")
          .maybeSingle();
        const expected = (secretRow as { value?: string } | null)?.value ?? "";
        const { timingSafeEqual } = await import("node:crypto");
        const a = Buffer.from(provided);
        const b = Buffer.from(expected);
        if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        // 1) Load retention window
        const { data: cfg } = await supabaseAdmin
          .from("app_config")
          .select("screenshot_retention_days")
          .eq("id", 1)
          .maybeSingle();
        const days = cfg?.screenshot_retention_days ?? 30;
        const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

        const result = {
          ok: true,
          cutoff,
          retention_days: days,
          monitoring: { rows_deleted: 0, objects_deleted: 0, storage_errors: 0 },
          steps: { rows_cleared: 0, objects_deleted: 0, storage_errors: 0 },
        };

        const BUCKET = "va-screenshots";
        const BATCH = 100;

        async function removeObjects(paths: string[]): Promise<{ ok: number; err: number }> {
          let ok = 0, err = 0;
          // Remove in chunks to keep payloads small
          for (let i = 0; i < paths.length; i += BATCH) {
            const chunk = paths.slice(i, i + BATCH).filter(Boolean);
            if (!chunk.length) continue;
            const { data, error } = await supabaseAdmin.storage.from(BUCKET).remove(chunk);
            if (error) {
              console.error("[cleanup-screenshots] bulk remove failed, retrying individually:", error.message);
              for (const p of chunk) {
                const r = await supabaseAdmin.storage.from(BUCKET).remove([p]);
                if (r.error) { err++; console.error("[cleanup-screenshots] remove failed", p, r.error.message); }
                else ok += (r.data?.length ?? 1);
              }
            } else {
              ok += data?.length ?? chunk.length;
            }
          }
          return { ok, err };
        }

        // 2) MONITORING screenshots — delete row + object
        try {
          const { data: oldShots, error } = await supabaseAdmin
            .from("screenshots")
            .select("id, storage_path, captured_at")
            .lt("captured_at", cutoff)
            .limit(5000);
          if (error) throw error;
          const ids = (oldShots ?? []).map((r) => r.id);
          const paths = (oldShots ?? []).map((r) => r.storage_path).filter(Boolean) as string[];

          if (paths.length) {
            const r = await removeObjects(paths);
            result.monitoring.objects_deleted = r.ok;
            result.monitoring.storage_errors = r.err;
          }
          if (ids.length) {
            const { error: delErr } = await supabaseAdmin.from("screenshots").delete().in("id", ids);
            if (delErr) console.error("[cleanup-screenshots] monitoring row delete error:", delErr.message);
            else result.monitoring.rows_deleted = ids.length;
          }
        } catch (e: any) {
          console.error("[cleanup-screenshots] monitoring phase error:", e?.message ?? e);
        }

        // 3) STEP screenshots — preserve any referenced by a SOP
        try {
          // Collect SOP-referenced screenshot paths
          const referenced = new Set<string>();
          let from = 0; const page = 500;
          for (;;) {
            const { data: sops, error } = await supabaseAdmin
              .from("sops")
              .select("steps")
              .range(from, from + page - 1);
            if (error) throw error;
            if (!sops?.length) break;
            for (const s of sops) {
              const steps = Array.isArray(s.steps) ? s.steps : [];
              for (const st of steps) {
                const p = (st && typeof st === "object" && (st as any).screenshot_path) as string | null | undefined;
                if (p) referenced.add(p);
              }
            }
            if (sops.length < page) break;
            from += page;
          }

          const { data: oldSteps, error: stepErr } = await supabaseAdmin
            .from("workflow_steps")
            .select("id, screenshot_path, created_at")
            .lt("created_at", cutoff)
            .not("screenshot_path", "is", null)
            .limit(10000);
          if (stepErr) throw stepErr;

          const toClear = (oldSteps ?? []).filter((r) => r.screenshot_path && !referenced.has(r.screenshot_path));
          const paths = toClear.map((r) => r.screenshot_path as string);
          const ids = toClear.map((r) => r.id);

          if (paths.length) {
            const r = await removeObjects(paths);
            result.steps.objects_deleted = r.ok;
            result.steps.storage_errors = r.err;
          }
          if (ids.length) {
            // Clear references in batches
            for (let i = 0; i < ids.length; i += 500) {
              const chunk = ids.slice(i, i + 500);
              const { error: upErr } = await supabaseAdmin
                .from("workflow_steps")
                .update({ screenshot_path: null })
                .in("id", chunk);
              if (upErr) console.error("[cleanup-screenshots] step clear error:", upErr.message);
              else result.steps.rows_cleared += chunk.length;
            }
          }
        } catch (e: any) {
          console.error("[cleanup-screenshots] steps phase error:", e?.message ?? e);
        }

        console.log("[cleanup-screenshots] done", JSON.stringify(result));
        return new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
