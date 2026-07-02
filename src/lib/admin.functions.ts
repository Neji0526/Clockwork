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

// List all team members with email pulled from auth.users (admin-only).
export const listTeam = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select("user_id, display_name, role, status, consent_at, created_at, pay_rate_cents, pay_currency")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    // Page through auth users to get emails (up to 1000)
    const emails = new Map<string, string>();
    let page = 1;
    for (;;) {
      const { data, error: e } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
      if (e) break;
      for (const u of data.users) if (u.email) emails.set(u.id, u.email);
      if (!data.users.length || data.users.length < 200 || page >= 5) break;
      page++;
    }

    return (profiles ?? []).map((p) => ({ ...p, email: emails.get(p.user_id) ?? null }));
  });

// Legacy direct-create (kept for compatibility); prefer the admin-invite edge function.
const CreateVaInput = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(72),
  display_name: z.string().trim().min(1).max(80),
});

export const createVa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateVaInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { display_name: data.display_name },
    });
    if (error) throw new Error(error.message);
    return { ok: true, user_id: created.user?.id ?? null };
  });

const SetRoleInput = z.object({
  user_id: z.string().uuid(),
  role: z.enum(["admin", "va"]),
});

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SetRoleInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Guard: prevent demoting the only admin (especially yourself)
    if (data.role === "va") {
      const { data: admins, error: aErr } = await supabaseAdmin
        .from("profiles")
        .select("user_id")
        .eq("role", "admin");
      if (aErr) throw new Error(aErr.message);
      const isTargetAdmin = (admins ?? []).some((a) => a.user_id === data.user_id);
      if (isTargetAdmin && (admins ?? []).length <= 1) {
        throw new Error("Cannot demote the only remaining admin.");
      }
    }

    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ role: data.role })
      .eq("user_id", data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const SetStatusInput = z.object({
  user_id: z.string().uuid(),
  status: z.enum(["active", "invited", "disabled"]),
});

export const setUserStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SetStatusInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ status: data.status })
      .eq("user_id", data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const SetPayInput = z.object({
  user_id: z.string().uuid(),
  pay_rate_cents: z.number().int().min(0).max(1_000_000),
  pay_currency: z.string().trim().min(3).max(3).default("USD"),
});

export const setUserPayRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SetPayInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        pay_rate_cents: data.pay_rate_cents,
        pay_currency: data.pay_currency.toUpperCase(),
      })
      .eq("user_id", data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const AdjustSessionInput = z.object({
  session_id: z.string().uuid(),
  active_sec: z.number().int().min(0).max(86_400 * 7).optional(),
  idle_sec: z.number().int().min(0).max(86_400 * 7).optional(),
  ended_at: z.string().datetime().nullable().optional(),
  note: z.string().trim().max(500).optional(),
});

export const adjustSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AdjustSessionInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: {
      active_sec?: number;
      idle_sec?: number;
      ended_at?: string | null;
      status?: "active" | "ended";
    } = {};
    if (data.active_sec !== undefined) patch.active_sec = data.active_sec;
    if (data.idle_sec !== undefined) patch.idle_sec = data.idle_sec;
    if (data.ended_at !== undefined) {
      patch.ended_at = data.ended_at;
      patch.status = data.ended_at ? "ended" : "active";
    }
    if (!Object.keys(patch).length) return { ok: true };
    const { error } = await supabaseAdmin
      .from("work_sessions")
      .update(patch)
      .eq("id", data.session_id);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("admin_actions").insert({
      actor_id: context.userId,
      action: "session_adjusted",
      metadata: { session_id: data.session_id, patch: patch as Record<string, string | number | null>, note: data.note ?? null },
    });
    return { ok: true };
  });
