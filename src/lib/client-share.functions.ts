import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Admin: list active + revoked share links for a VA. */
export const listClientShareTokens = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ vaId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase
      .rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("client_share_tokens")
      .select("token, label, created_at, expires_at, revoked_at, client_id")
      .eq("va_id", data.vaId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/**
 * Admin: create a new tokenized client link for a VA, scoped to ONE client.
 *
 * SECURITY — token entropy is load-bearing for the public share endpoint.
 * The public `get_client_share_billable` RPC is granted to `anon`, so the
 * token string IS the security boundary. We use 32 bytes (256 bits) from
 * the platform CSPRNG (`crypto.getRandomValues`), encoded as base64url
 * (43 chars). Do NOT shorten this, do NOT switch to `Math.random`, do NOT
 * add a sequential or timestamp component, and do NOT roll a custom
 * "friendlier" token format — any of those collapses the containment.
 *
 * `clientId` is required: every new token is bound to a single (VA, client)
 * pair so the holder can only ever see that one client's hours. Legacy
 * tokens without a client_id will return `legacy_token_reissue_required`
 * from the share endpoint rather than leaking cross-client totals.
 */
export const createClientShareToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      vaId: z.string().uuid(),
      clientId: z.string().uuid(),
      label: z.string().trim().max(80).optional(),
      expiresInDays: z.number().int().min(1).max(365).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase
      .rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // 32 bytes → 43-char base64url, ~256 bits of entropy. See note above.
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const token = Buffer.from(bytes).toString("base64")
      .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    const expiresAt = data.expiresInDays
      ? new Date(Date.now() + data.expiresInDays * 86_400_000).toISOString()
      : null;
    const { error } = await supabaseAdmin.from("client_share_tokens").insert({
      token,
      va_id: data.vaId,
      client_id: data.clientId,
      label: data.label || null,
      created_by: context.userId,
      expires_at: expiresAt,
    });
    if (error) throw new Error(error.message);
    return { token };
  });

/** Admin: revoke a token immediately. */
export const revokeClientShareToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ token: z.string().min(8) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase
      .rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("client_share_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("token", data.token);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Public (no auth): resolve a token to a read-only (VA, client) snapshot.
 *
 * All scoping happens server-side in `get_client_share_billable`:
 *   - The caller passes only the token string. va_id and client_id are
 *     resolved from the token row inside the RPC and can never be supplied
 *     by the caller, so a Client A token cannot ask for Client B's data.
 *   - The RPC hard-filters segments to `va_id = tok.va_id AND
 *     client_id = tok.client_id`, so cross-client rows never enter the
 *     aggregation CTE.
 *   - Session start/end times in `recentSessions` are derived from
 *     client-scoped slices, NOT the raw session window — a session that
 *     spanned multiple clients shows only this client's portion.
 *   - SOPs are intentionally NOT returned: they are not client-scoped in
 *     the schema, so returning them here would leak SOPs about other
 *     clients. (Scoping SOPs is tracked as a separate future item.)
 *   - Legacy tokens (created before client_id was required) short-circuit
 *     to `legacy_token_reissue_required` before any segment data is read.
 */
export const getClientShareView = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ token: z.string().min(8) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin
      .rpc("get_client_share_billable" as any, { p_token: data.token });
    if (error) throw new Error(error.message);
    return result as
      | { ok: false; reason: "not_found" | "revoked" | "expired" | "legacy_token_reissue_required" }
      | {
          ok: true;
          label: string | null;
          vaName: string;
          windowDays: number;
          totals: { activeSec: number; sessions: number };
          daily: { date: string; activeSec: number }[];
          recentSessions: { startedAt: string; endedAt: string; activeSec: number }[];
        };
  });
