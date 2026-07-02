// Admin invite links: admins create one-time/limited-use links that promote
// the redeemer to admin. Token generation + redemption use the service-role
// client behind authenticated server functions.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertAdmin(context: any) {
  const { data: isAdmin, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!isAdmin) throw new Error("Forbidden: admin only");
}

function generateToken(): string {
  // URL-safe ~22-char base64 token (16 random bytes).
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const CreateInput = z.object({
  label: z.string().trim().max(80).optional(),
  expires_days: z.number().int().min(1).max(90).default(7),
  max_uses: z.number().int().min(1).max(100).default(1),
});

export const createAdminInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const token = generateToken();
    const expires_at = new Date(Date.now() + data.expires_days * 86_400_000).toISOString();
    const { data: row, error } = await supabaseAdmin
      .from("admin_invite_tokens")
      .insert({
        token,
        created_by: context.userId,
        label: data.label ?? null,
        max_uses: data.max_uses,
        expires_at,
      })
      .select("id, token, label, max_uses, uses, expires_at, revoked_at, created_at")
      .single();
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("admin_actions").insert({
      actor_id: context.userId,
      action: "admin_invite_link_created",
      metadata: { invite_id: row.id, label: data.label ?? null, max_uses: data.max_uses, expires_at },
    });
    return row;
  });

export const listAdminInvites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("admin_invite_tokens")
      .select("id, token, label, max_uses, uses, expires_at, revoked_at, created_at, created_by")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const RevokeInput = z.object({ id: z.string().uuid() });

export const revokeAdminInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RevokeInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("admin_invite_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("admin_actions").insert({
      actor_id: context.userId,
      action: "admin_invite_link_revoked",
      metadata: { invite_id: data.id },
    });
    return { ok: true };
  });

// Look up a token without consuming it — for the accept page preview.
const TokenInput = z.object({ token: z.string().min(8).max(128) });

export const previewAdminInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TokenInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("admin_invite_tokens")
      .select("id, label, max_uses, uses, expires_at, revoked_at")
      .eq("token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return { valid: false as const, reason: "not_found" as const };
    if (row.revoked_at) return { valid: false as const, reason: "revoked" as const };
    if (new Date(row.expires_at).getTime() < Date.now()) return { valid: false as const, reason: "expired" as const };
    if (row.uses >= row.max_uses) return { valid: false as const, reason: "used_up" as const };
    return { valid: true as const, label: row.label, expires_at: row.expires_at };
  });

export const acceptAdminInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TokenInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Already an admin — no-op success, but don't burn a use.
    const { data: alreadyAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (alreadyAdmin) return { ok: true as const, alreadyAdmin: true };

    const { data: row, error: lookupErr } = await supabaseAdmin
      .from("admin_invite_tokens")
      .select("id, max_uses, uses, expires_at, revoked_at")
      .eq("token", data.token)
      .maybeSingle();
    if (lookupErr) throw new Error(lookupErr.message);
    if (!row) throw new Error("This invite link is not valid.");
    if (row.revoked_at) throw new Error("This invite link has been revoked.");
    if (new Date(row.expires_at).getTime() < Date.now()) throw new Error("This invite link has expired.");
    if (row.uses >= row.max_uses) throw new Error("This invite link has already been used.");

    // Atomically increment uses only if still under the cap and not revoked/expired.
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from("admin_invite_tokens")
      .update({ uses: row.uses + 1 })
      .eq("id", row.id)
      .eq("uses", row.uses)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();
    if (claimErr) throw new Error(claimErr.message);
    if (!claimed) throw new Error("This invite link was just used. Ask the admin for a new one.");

    // Promote the redeemer to admin.
    const { error: promoErr } = await supabaseAdmin
      .from("profiles")
      .update({ role: "admin" })
      .eq("user_id", context.userId);
    if (promoErr) throw new Error(promoErr.message);

    await supabaseAdmin.from("admin_actions").insert({
      actor_id: context.userId,
      action: "admin_invite_link_redeemed",
      target_user_id: context.userId,
      metadata: { invite_id: row.id },
    });

    return { ok: true as const, alreadyAdmin: false };
  });
