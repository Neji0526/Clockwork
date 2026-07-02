import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";

/**
 * Bucketed rate-limit check backed by the `rate_limits` table.
 * Uses the service-role client so it bypasses RLS (the table has no policies
 * and is server-only).
 */
async function checkRate(
  admin: any,
  key: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  const bucket = new Date(
    Math.floor(Date.now() / (windowSec * 1000)) * windowSec * 1000,
  ).toISOString();
  const { data: existing } = await admin
    .from("rate_limits")
    .select("count")
    .eq("key", key)
    .eq("window_started_at", bucket)
    .maybeSingle();
  if (!existing) {
    await admin
      .from("rate_limits")
      .insert({ key, window_started_at: bucket, count: 1 });
    return true;
  }
  if (existing.count >= limit) return false;
  await admin
    .from("rate_limits")
    .update({ count: existing.count + 1 })
    .eq("key", key)
    .eq("window_started_at", bucket);
  return true;
}

/**
 * Public, rate-limited password-reset request.
 * Always returns `{ ok: true }` so the response shape does NOT reveal whether
 * the email exists. Quietly drops requests that exceed the limit.
 *
 * Limits: 5 / email / 15 min and 20 / IP / 15 min.
 */
export const requestPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        email: z.string().email().max(254).transform((s) => s.toLowerCase().trim()),
        redirectTo: z.string().url(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ip =
      getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ??
      getRequestHeader("cf-connecting-ip") ??
      "unknown";

    const okEmail = await checkRate(
      supabaseAdmin,
      `pwreset:email:${data.email}`,
      5,
      15 * 60,
    );
    const okIp = await checkRate(
      supabaseAdmin,
      `pwreset:ip:${ip}`,
      20,
      15 * 60,
    );

    if (!okEmail || !okIp) {
      // Audit the throttle but don't tell the caller.
      await supabaseAdmin.from("admin_actions").insert({
        action: "password_reset_rate_limited",
        target_email: data.email,
        ip_address: ip,
        metadata: { reason: !okEmail ? "email" : "ip" },
      });
      return { ok: true } as const;
    }

    // Open-redirect guard: only allow same-origin redirects to /reset-password.
    // We never trust the caller-supplied origin — derive the canonical app
    // origin from the request itself (Host header). This is domain-agnostic
    // so remixers don't need to change anything.
    const host = getRequestHeader("host");
    if (!host) {
      // Host header is always set by Cloudflare; this should never happen.
      return { ok: true } as const;
    }
    const proto =
      getRequestHeader("x-forwarded-proto")?.split(",")[0]?.trim() ?? "https";
    const safeRedirect = `${proto}://${host}/reset-password`;

    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(
      data.email,
      { redirectTo: safeRedirect },
    );

    await supabaseAdmin.from("admin_actions").insert({
      action: error ? "password_reset_failed" : "password_reset_requested",
      target_email: data.email,
      ip_address: ip,
      metadata: error ? { error: error.message } : {},
    });

    // Don't leak Supabase errors — same shape regardless.
    return { ok: true } as const;
  });
