// Shared ingest core — both the Chrome extension (track-ingest) and the future
// native desktop agent (agent-ingest) call processEvent() so we have ONE source
// of truth for how event kinds turn into DB rows. The only thing that differs
// between the two transports is auth + the `source`/`platform` tag we stamp on
// the rows.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export type Admin = ReturnType<typeof createClient>;
export type IngestContext = {
  /** Resolved VA whose data we're writing for. */
  vaId: string;
  /** Logical transport: 'extension' (browser) or 'desktop' (native agent). */
  source: "extension" | "desktop";
  /** Platform tag: 'chrome' for the extension, 'macos'|'windows'|'linux' for the agent. */
  platform: "chrome" | "macos" | "windows" | "linux";
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const SOP_GENERATION_THRESHOLD = 10;
const MAX_STR = 2000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const trim = (s: unknown, n = MAX_STR) =>
  typeof s === "string" ? s.slice(0, n) : null;

function normalize(label: string | null | undefined): string {
  if (!label) return "";
  return label.toLowerCase().replace(/\d+/g, "#").replace(/[a-f0-9]{8,}/gi, "#")
    .replace(/\s+/g, " ").trim().slice(0, 80);
}
function normalizePath(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/\d+/g, "/#").replace(/\/[a-f0-9-]{8,}/gi, "/#");
    return `${u.host}${path}`;
  } catch { return ""; }
}

async function maybeGenerateSop(admin: Admin, vaId: string, signature: string) {
  const { data: steps } = await admin
    .from("workflow_steps")
    .select("step_index,label,url,screenshot_path,created_at")
    .eq("va_id", vaId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (!steps || steps.length === 0) return;
  const labels = steps.slice().reverse().map((s: any) => normalize(s.label)).filter(Boolean);
  const prompt = `You are documenting a repeated workflow performed by a virtual assistant.
Given this ordered sequence of UI interactions, produce a clean, imperative SOP.
Steps (raw labels): ${JSON.stringify(labels.slice(0, 20))}
URL context: ${steps[0]?.url ?? ""}
Return strict JSON: {"title": string, "description": string, "steps": [{"index": number, "instruction": string}]}.
Keep instructions short and action-oriented. Max 10 steps.`;

  let aiPayload: { title: string; description: string; steps: { index: number; instruction: string }[] } | null = null;
  try {
    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": LOVABLE_API_KEY },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You write concise SOPs. Reply with JSON only." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (aiRes.ok) {
      const j = await aiRes.json();
      aiPayload = JSON.parse(j.choices?.[0]?.message?.content ?? "{}");
    }
  } catch (e) { console.error("AI gen error", e); }

  if (!aiPayload || !aiPayload.title) {
    aiPayload = {
      title: `Repeated workflow on ${steps[0]?.url ? new URL(steps[0].url).host : "site"}`,
      description: "Auto-generated from a repeated click sequence.",
      steps: labels.slice(0, 10).map((l, i) => ({ index: i + 1, instruction: l })),
    };
  }
  const stepsWithShots = aiPayload.steps.map((st, i) => ({
    ...st, screenshot_path: steps[i]?.screenshot_path ?? null,
  }));
  const { data: sop, error: sopErr } = await admin.from("sops").insert({
    title: trim(aiPayload.title, 200),
    description: trim(aiPayload.description, 1000),
    steps: stepsWithShots,
    source: "auto",
    generated_from_signature: signature,
    generated_for_va: vaId,
    status: "auto",
  }).select("id").single();
  if (sopErr) { console.error("sop insert failed", sopErr); return; }
  await admin.from("workflow_signatures")
    .update({ generated_sop_id: sop.id })
    .eq("va_id", vaId).eq("signature", signature);
}

export type IngestResult = { status: number; body: unknown };

export async function processEvent(
  admin: Admin,
  body: any,
  ctx: IngestContext,
): Promise<IngestResult> {
  const { vaId, source, platform } = ctx;
  const tag = { source, platform };
  const kind = body?.kind;

  if (kind === "session_start") {
    const { data: prof } = await admin.from("profiles").select("status").eq("user_id", vaId).maybeSingle();
    if (prof?.status === "disabled") return { status: 403, body: { error: "account_disabled" } };
    const clientId = typeof body.client_id === "string" && UUID_RE.test(body.client_id) ? body.client_id : null;
    const { data, error } = await admin.from("work_sessions").insert({
      va_id: vaId, status: "active", source, platform, client_id: clientId,
    }).select("id").single();
    if (error) throw error;
    // Phase 2: open the first work segment for this session.
    const { error: segErr } = await admin.rpc("open_session_segment", {
      p_session_id: data.id, p_kind: "work",
      p_client_id: clientId, p_project_id: null,
    });
    if (segErr) throw segErr;
    return { status: 200, body: { session_id: data.id } };
  }

  if (kind === "session_end") {
    const sessionId = String(body.session_id ?? "");
    if (!sessionId) return { status: 400, body: { error: "missing_session" } };
    const proposedEnd = new Date().toISOString();
    // Bridge unaccounted time between last real interaction and proposed end
    // as idle (capped at LRS + session_timeout). The bridge fn also performs
    // the authoritative close (close_open_session_segment) with the clamped
    // effective end.
    const { error: bridgeErr } = await admin.rpc(
      "bridge_session_idle_and_close",
      { p_session_id: sessionId, p_proposed_ended_at: proposedEnd },
    );
    if (bridgeErr) throw bridgeErr;
    // Aggregate work_sessions totals from clamped segments (post-bridge).
    const { data: segs } = await admin
      .from("session_segments")
      .select("active_sec,idle_sec,ended_at")
      .eq("session_id", sessionId)
      .eq("va_id", vaId);
    const active_sec = (segs ?? []).reduce((a: number, r: any) => a + (r.active_sec ?? 0), 0);
    const idle_sec = (segs ?? []).reduce((a: number, r: any) => a + (r.idle_sec ?? 0), 0);
    // ended_at = max segment end if available, else proposed.
    const maxEnd = (segs ?? []).reduce((m: string, r: any) => {
      const e = r.ended_at as string | null;
      return e && e > m ? e : m;
    }, "");
    const endedAt = maxEnd || proposedEnd;
    const { error } = await admin.from("work_sessions")
      .update({ ended_at: endedAt, status: "ended", active_sec, idle_sec })
      .eq("id", sessionId).eq("va_id", vaId);
    if (error) throw error;
    return { status: 200, body: { ok: true, active_sec, idle_sec } };
  }


  if (kind === "activity") {
    // Cap per-row duration at 3x the heartbeat interval. A legitimate activity
    // row can't represent more wall time than a few heartbeat cycles — anything
    // larger is a suspended-worker artifact (OS sleep, MV3 SW pause) where
    // (Date.now() - startedAt) ballooned across the gap.
    const { data: cfg } = await admin
      .from("app_config")
      .select("heartbeat_sec")
      .eq("id", 1)
      .single();
    const heartbeatSec = Math.max(15, Math.min(600, Number(cfg?.heartbeat_sec) || 60));
    const maxDur = heartbeatSec * 3;
    const rawDur = Math.max(0, Number(body.duration_sec) || 0);
    const cappedDur = Math.min(rawDur, maxDur);

    // upsert with ignoreDuplicates: the unique constraint
    // (session_id, started_at, app, url) NULLS NOT DISTINCT is the guarantee;
    // ignoreDuplicates keeps ingest from 500-ing on a retry-induced dupe.
    const { error } = await admin.from("activity_events").upsert({
      session_id: String(body.session_id),
      va_id: vaId,
      app: trim(body.app, 200),
      title: trim(body.title, 500),
      url: trim(body.url, 1000), // null is fine for native-app activity
      started_at: body.started_at ?? new Date().toISOString(),
      duration_sec: cappedDur,
      ...tag,
    }, { onConflict: "session_id,started_at,app,url", ignoreDuplicates: true });
    if (error) throw error;
    return { status: 200, body: { ok: true, capped: cappedDur < rawDur } };
  }


  if (kind === "idle") {
    const { error } = await admin.from("idle_segments").insert({
      session_id: String(body.session_id),
      va_id: vaId,
      started_at: body.started_at ?? new Date().toISOString(),
      duration_sec: Math.max(0, Math.min(86400, Number(body.duration_sec) || 0)),
    });
    if (error) throw error;
    return { status: 200, body: { ok: true } };
  }

  if (kind === "engagement") {
    const sessionId = typeof body.session_id === "string" ? body.session_id : null;
    const { error } = await admin.from("engagement_samples").insert({
      va_id: vaId, session_id: sessionId,
      sampled_at: new Date().toISOString(),
      window_sec: Math.max(1, Math.min(600, Number(body.window_sec) || 60)),
      interacted: !!body.interacted,
      click_count: Math.max(0, Math.min(10000, Number(body.click_count) || 0)),
      key_count: Math.max(0, Math.min(10000, Number(body.key_count) || 0)),
      scroll_count: Math.max(0, Math.min(10000, Number(body.scroll_count) || 0)),
      ...tag,
    });
    if (error) throw error;
    return { status: 200, body: { ok: true } };
  }

  if (kind === "heartbeat") {
    // No-op on the server. last_activity_at is bumped ONLY by real
    // human-action signals via DB triggers (activity_events, end-of-idle,
    // interacted=true engagement, break start/end). A heartbeat fires on a
    // timer regardless of presence, so writing it here would re-introduce
    // the zombie-session bug that idle-bridging was built to fix. The
    // round-trip still surfaces transport / auth errors to the extension.
    return { status: 200, body: { ok: true } };
  }

  if (kind === "break_start" || kind === "lunch_start") {
    const sessionId = typeof body.session_id === "string" ? body.session_id : null;
    if (!sessionId) return { status: 400, body: { error: "missing_session" } };
    // short_break vs lunch are mechanically identical — same lifecycle, same
    // exclusion from active time — only the recorded type differs.
    const breakType = kind === "lunch_start" ? "lunch" : "short_break";
    const { data: breakId, error } = await admin.rpc("start_break", {
      p_session_id: sessionId,
      p_reason: trim(body.reason, 200),
      p_break_type: breakType,
    });
    if (error) throw error;
    return { status: 200, body: { ok: true, break_id: breakId, break_type: breakType } };
  }

  if (kind === "break_end" || kind === "lunch_end") {
    // end_break closes whichever break is open for this VA, regardless of type.
    const { data: dur, error } = await admin.rpc("end_break", { p_va_id: vaId });
    if (error) throw error;
    return { status: 200, body: { ok: true, duration_sec: dur ?? 0 } };
  }

  if (kind === "screenshot") {
    const dataUrl: string = body.data_url ?? "";
    const m = dataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/i);
    if (!m) return { status: 400, body: { error: "bad_data_url" } };
    const ext = m[1] === "image/png" ? "png" : "jpg";
    const bin = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    const sessionId = String(body.session_id);
    const path = `${vaId}/${sessionId}/${Date.now()}.${ext}`;
    const up = await admin.storage.from("va-screenshots").upload(path, bin, { contentType: m[1], upsert: false });
    if (up.error) throw up.error;
    const { data: ins, error } = await admin.from("screenshots").insert({
      session_id: sessionId, va_id: vaId, storage_path: path, ...tag,
    }).select("id").single();
    if (error) throw error;
    const capReqId: string | null = typeof body.capture_request_id === "string" ? body.capture_request_id : null;
    if (capReqId && ins?.id) {
      await admin.from("capture_requests")
        .update({ status: "fulfilled", fulfilled_at: new Date().toISOString(), screenshot_id: ins.id })
        .eq("id", capReqId).eq("va_id", vaId).eq("status", "pending");
    }
    return { status: 200, body: { ok: true, path, screenshot_id: ins?.id ?? null } };
  }

  if (kind === "step") {
    const sessionId = String(body.session_id);
    const label = trim(body.label, 200);
    const url = trim(body.url, 1000);
    const stepIndex = Math.max(0, Math.min(10000, Number(body.step_index) || 0));
    let screenshotPath: string | null = trim(body.screenshot_path, 500);
    const dataUrl: string | undefined = typeof body.screenshot === "string" ? body.screenshot : undefined;
    if (dataUrl) {
      const m = dataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/i);
      if (m) {
        const ext = m[1] === "image/png" ? "png" : "jpg";
        const bin = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
        const path = `${vaId}/${sessionId}/steps/${stepIndex}-${Date.now()}.${ext}`;
        const up = await admin.storage.from("va-screenshots").upload(path, bin, { contentType: m[1], upsert: false });
        if (!up.error) screenshotPath = path;
        else console.error("step screenshot upload failed", up.error);
      }
    }
    const { error } = await admin.from("workflow_steps").insert({
      session_id: sessionId, va_id: vaId, step_index: stepIndex, label,
      tag: trim(body.tag, 50), url,
      rect: body.rect ?? null,
      dpr: Number(body.dpr) || null,
      viewport: body.viewport ?? null,
      screenshot_path: screenshotPath,
      ...tag,
    });
    if (error) throw error;

    if (body.workflow_end && Array.isArray(body.workflow_labels)) {
      const normLabels = body.workflow_labels.map((l: string) => normalize(l)).filter(Boolean);
      const sig = `${normalizePath(url)}::${normLabels.join("|")}`;
      const { data: existing } = await admin.from("workflow_signatures")
        .select("id, occurrence_count, generated_sop_id")
        .eq("va_id", vaId).eq("signature", sig).maybeSingle();
      let newCount = 1; let sopAlready: string | null = null;
      if (existing) {
        newCount = (existing.occurrence_count ?? 0) + 1;
        sopAlready = existing.generated_sop_id;
        await admin.from("workflow_signatures")
          .update({ occurrence_count: newCount, last_seen_at: new Date().toISOString() })
          .eq("id", existing.id);
      } else {
        await admin.from("workflow_signatures").insert({
          va_id: vaId, signature: sig, occurrence_count: 1, last_seen_at: new Date().toISOString(),
        });
      }
      if (!sopAlready && newCount >= SOP_GENERATION_THRESHOLD) {
        await maybeGenerateSop(admin, vaId, sig);
      }
    }
    return { status: 200, body: { ok: true } };
  }

  return { status: 400, body: { error: "unknown_kind" } };
}
