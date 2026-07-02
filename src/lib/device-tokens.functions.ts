import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertAdmin(context: any) {
  const { data: isAdmin, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId, _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!isAdmin) throw new Error("Forbidden: admin only");
}

// SHA-256 hex, matching what the agent-ingest edge function computes
// on the presented Bearer token.
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // url-safe base64
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `cwagent_${b64}`;
}

const MintInput = z.object({
  va_id: z.string().uuid(),
  label: z.string().trim().min(1).max(80),
  platform: z.enum(["macos", "windows", "linux"]),
});

/** Mint a new device token for a VA. Returns the plaintext ONCE; only the hash is stored. */
export const mintDeviceToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => MintInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const plaintext = randomToken();
    const token_hash = await sha256Hex(plaintext);
    const { data: row, error } = await supabaseAdmin
      .from("device_tokens")
      .insert({
        va_id: data.va_id,
        label: data.label,
        platform: data.platform,
        token_hash,
        created_by: context.userId,
      })
      .select("id, va_id, label, platform, created_at")
      .single();
    if (error) throw new Error(error.message);
    return { device: row, token: plaintext };
  });

const ListInput = z.object({ va_id: z.string().uuid() });

export const listDeviceTokens = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("device_tokens")
      .select("id, va_id, label, platform, created_at, last_seen_at, revoked_at")
      .eq("va_id", data.va_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const RevokeInput = z.object({ id: z.string().uuid() });

export const revokeDeviceToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RevokeInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("device_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
