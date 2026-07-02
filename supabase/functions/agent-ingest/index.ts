// ClockWork ingest endpoint for the native DESKTOP AGENT (macOS/Windows/Linux).
// Auth: device tokens (Authorization: Bearer cwagent_xxx) minted by an admin
// in the Connected devices panel. We never store the plaintext token — only its
// SHA-256 hex digest in public.device_tokens.token_hash.
// verify_jwt = false (set in supabase/config.toml) so the agent doesn't need
// a Supabase user session.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { processEvent } from "../_shared/ingest-core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Best-effort in-memory rate limit per token: 600 events / minute.
// Workers are stateless, but a single warm instance still benefits.
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(key: string, limit = 600, windowMs = 60_000): boolean {
  const now = Date.now();
  const b = rateBuckets.get(key);
  if (!b || b.resetAt < now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count++;
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  const presented = authHeader.replace("Bearer ", "").trim();
  if (!presented) return json({ error: "unauthorized" }, 401);

  const tokenHash = await sha256Hex(presented);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Constant-time lookup happens at the DB layer (unique index on token_hash).
  const { data: device, error: devErr } = await admin
    .from("device_tokens")
    .select("id, va_id, platform, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (devErr) {
    console.error("device lookup failed", devErr);
    return json({ error: "server_error" }, 500);
  }
  if (!device || device.revoked_at) return json({ error: "unauthorized" }, 401);

  if (!rateLimit(device.id)) return json({ error: "rate_limited" }, 429);

  // Confirm VA isn't disabled
  const { data: prof } = await admin
    .from("profiles").select("status").eq("user_id", device.va_id).maybeSingle();
  if (prof?.status === "disabled") return json({ error: "account_disabled" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }

  try {
    const res = await processEvent(admin, body, {
      vaId: device.va_id,
      source: "desktop",
      platform: device.platform as "macos" | "windows" | "linux",
    });

    // Mark device as seen (best-effort; don't block on failure).
    admin.from("device_tokens")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", device.id)
      .then(() => {}, (e: any) => console.error("last_seen update", e));

    return json(res.body, res.status);
  } catch (e: any) {
    console.error("agent-ingest error", e);
    return json({ error: e?.message ?? "server_error" }, 500);
  }
});
