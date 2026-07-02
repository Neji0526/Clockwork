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

const ClientIdInput = z.object({ clientId: z.string().uuid() });

// Counts the history that delete-safety depends on. Drives the 3-case UI:
//   invoices > 0          → DB will RESTRICT a delete; surface as disabled.
//   segments+sessions > 0 → delete would SET NULL on hours (orphans them).
//   all zero              → safe simple-confirm delete.
export const getClientHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ClientIdInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [inv, seg, ws] = await Promise.all([
      supabaseAdmin.from("invoices").select("*", { count: "exact", head: true }).eq("client_id", data.clientId),
      supabaseAdmin.from("session_segments").select("*", { count: "exact", head: true }).eq("client_id", data.clientId),
      supabaseAdmin.from("work_sessions").select("*", { count: "exact", head: true }).eq("client_id", data.clientId),
    ]);
    if (inv.error) throw new Error(inv.error.message);
    if (seg.error) throw new Error(seg.error.message);
    if (ws.error) throw new Error(ws.error.message);

    return {
      invoices: inv.count ?? 0,
      segments: seg.count ?? 0,
      sessions: ws.count ?? 0,
    };
  });

// Hard delete. Guarded:
//   - admin only
//   - brand must be archived (must archive first)
//   - refuses if invoices exist (the DB FK is RESTRICT anyway; we surface a
//     clean error before letting Postgres throw 23503)
// Segment/session FKs are SET NULL, so historical hours survive but lose
// their brand label. That consequence is shown in the UI before this runs.
export const deleteClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ClientIdInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: client, error: cErr } = await supabaseAdmin
      .from("clients").select("id, name, archived").eq("id", data.clientId).maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!client) throw new Error("Brand not found.");
    if (!client.archived) throw new Error("Archive the brand before deleting it.");

    const { count: invCount, error: iErr } = await supabaseAdmin
      .from("invoices").select("*", { count: "exact", head: true }).eq("client_id", data.clientId);
    if (iErr) throw new Error(iErr.message);
    if ((invCount ?? 0) > 0) {
      throw new Error(`Cannot delete — brand has ${invCount} invoice${invCount === 1 ? "" : "s"}. Brands with billing history are kept for audit.`);
    }

    const { error: dErr } = await supabaseAdmin.from("clients").delete().eq("id", data.clientId);
    if (dErr) throw new Error(dErr.message);

    await supabaseAdmin.from("admin_actions").insert({
      actor_id: context.userId,
      action: "client_deleted",
      metadata: { client_id: data.clientId, name: client.name },
    });
    return { ok: true };
  });

// =========================== PROJECTS ============================
// Projects never bill, so delete safety is simpler than brands:
// no invoice case. Only the segment/session orphan case applies.
// session_segments.project_id and work_sessions.project_id are both
// ON DELETE SET NULL, so hard delete preserves the hours and just
// drops the project label.

const ProjectIdInput = z.object({ projectId: z.string().uuid() });

export const getProjectHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ProjectIdInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [seg, ws] = await Promise.all([
      supabaseAdmin.from("session_segments").select("*", { count: "exact", head: true }).eq("project_id", data.projectId),
      supabaseAdmin.from("work_sessions").select("*", { count: "exact", head: true }).eq("project_id", data.projectId),
    ]);
    if (seg.error) throw new Error(seg.error.message);
    if (ws.error) throw new Error(ws.error.message);

    return {
      segments: seg.count ?? 0,
      sessions: ws.count ?? 0,
    };
  });

export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ProjectIdInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: project, error: pErr } = await supabaseAdmin
      .from("projects").select("id, name, archived, client_id").eq("id", data.projectId).maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!project) throw new Error("Project not found.");
    if (!project.archived) throw new Error("Archive the project before deleting it.");

    const { error: dErr } = await supabaseAdmin.from("projects").delete().eq("id", data.projectId);
    if (dErr) throw new Error(dErr.message);

    await supabaseAdmin.from("admin_actions").insert({
      actor_id: context.userId,
      action: "project_deleted",
      metadata: { project_id: data.projectId, client_id: project.client_id, name: project.name },
    });
    return { ok: true };
  });

