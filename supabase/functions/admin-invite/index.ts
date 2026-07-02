// Admin-only: create a VA account with a one-time temporary password.
// verify_jwt = true (set in supabase/config.toml).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function randInt(maxExclusive: number): number {
  // CSPRNG-backed unbiased integer in [0, maxExclusive)
  const buf = new Uint32Array(1);
  const limit = Math.floor(0xffffffff / maxExclusive) * maxExclusive;
  // Rejection sampling to avoid modulo bias
  // eslint-disable-next-line no-constant-condition
  while (true) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % maxExclusive;
  }
}

function tempPassword(): string {
  // Friendly, readable 14-char password — avoids ambiguous chars.
  const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const sym = "!@#$%&*";
  const all = alpha + lower + digits + sym;
  const rand = (s: string) => s[randInt(s.length)];
  const base = [rand(alpha), rand(lower), rand(digits), rand(sym)];
  for (let i = 0; i < 10; i++) base.push(rand(all));
  // Fisher–Yates shuffle with CSPRNG
  for (let i = base.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [base[i], base[j]] = [base[j], base[i]];
  }
  return base.join("");
}

async function checkRateLimit(
  admin: ReturnType<typeof createClient>,
  key: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  const now = new Date();
  const bucket = new Date(Math.floor(now.getTime() / (windowSec * 1000)) * windowSec * 1000).toISOString();
  // Upsert + increment via RPC-less approach: try insert, then increment.
  const { data: existing } = await admin
    .from("rate_limits")
    .select("count")
    .eq("key", key)
    .eq("window_started_at", bucket)
    .maybeSingle();
  if (!existing) {
    await admin.from("rate_limits").insert({ key, window_started_at: bucket, count: 1 });
    return true;
  }
  if ((existing as any).count >= limit) return false;
  await admin
    .from("rate_limits")
    .update({ count: (existing as any).count + 1 })
    .eq("key", key)
    .eq("window_started_at", bucket);
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  const token = authHeader.replace("Bearer ", "");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: u, error: ue } = await userClient.auth.getUser();
  if (ue || !u.user) return json({ error: "unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Verify the caller is an admin
  const { data: callerProfile } = await admin
    .from("profiles")
    .select("role")
    .eq("user_id", u.user.id)
    .maybeSingle();
  if (callerProfile?.role !== "admin") return json({ error: "forbidden" }, 403);

  // Rate limit: 10 invites per admin per 10 minutes, plus 20/IP/10min.
  const okUser = await checkRateLimit(admin, `admin-invite:user:${u.user.id}`, 10, 600);
  const okIp = await checkRateLimit(admin, `admin-invite:ip:${ip}`, 20, 600);
  if (!okUser || !okIp) return json({ error: "rate_limited" }, 429);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }

  const email = String(body?.email ?? "").trim().toLowerCase();
  const display_name = String(body?.display_name ?? "").trim().slice(0, 80);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "bad_email" }, 400);
  if (!display_name) return json({ error: "bad_name" }, 400);

  const password = tempPassword();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name },
  });
  if (createErr || !created.user) {
    await admin.from("admin_actions").insert({
      actor_id: u.user.id,
      action: "admin_invite_failed",
      target_email: email,
      metadata: { error: createErr?.message ?? "create_failed" },
      ip_address: ip,
    });
    return json({ error: createErr?.message ?? "create_failed" }, 400);
  }

  // handle_new_user trigger creates the profiles row; ensure role=va, status=active.
  await admin
    .from("profiles")
    .update({ role: "va", status: "active", display_name })
    .eq("user_id", created.user.id);

  await admin.from("admin_actions").insert({
    actor_id: u.user.id,
    action: "admin_invite_created",
    target_user_id: created.user.id,
    target_email: email,
    metadata: { display_name },
    ip_address: ip,
  });

  return json({
    ok: true,
    user_id: created.user.id,
    email,
    display_name,
    temp_password: password,
  });
});

