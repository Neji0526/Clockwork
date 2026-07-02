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

function normalize(s: string | null | undefined) {
  return (s ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
}
function trim(s: any, n: number) {
  return String(s ?? "").slice(0, n);
}

// Admin: ask the smartest available LLM to propose an automation plan for an SOP.
export const suggestSopAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ sopId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: sop, error } = await supabaseAdmin
      .from("sops")
      .select("id, title, description, steps")
      .eq("id", data.sopId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!sop) throw new Error("SOP not found");

    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const steps = Array.isArray(sop.steps) ? sop.steps : [];
    const stepLines = steps
      .map((s: any, i: number) => `${i + 1}. ${normalize(s?.instruction) || "(no instruction)"}`)
      .join("\n");

    const system = `You are a senior automation architect. Given a Standard Operating Procedure (SOP) a virtual assistant performs manually, design the most effective way to automate it end-to-end using the most up-to-date technology available today. Be specific and pragmatic.

Your response MUST be well-formatted Markdown with these sections, in order:
1. **Summary** — one paragraph describing the recommended automation approach.
2. **Recommended stack** — bullet list of concrete tools, APIs, models, or platforms (with versions/tiers where relevant) and a one-line reason for each. Prefer current best-in-class options (e.g. modern LLMs, browser-automation frameworks, workflow platforms, RPA, MCP, official APIs). Mention alternatives only when meaningfully different.
3. **Step-by-step automation plan** — numbered steps mapping the manual SOP to automated actions. Each step should name the component responsible and the inputs/outputs.
4. **Edge cases & guardrails** — bullets covering failure modes, human-in-the-loop checkpoints, auth/secrets handling, and observability.
5. **Effort & ROI** — rough build effort (hours/days), ongoing cost signal, and what a VA gets back per run.

Be concrete. Skip filler. No disclaimers.`;

    const user = `SOP title: ${sop.title}
${sop.description ? `Description: ${sop.description}\n` : ""}
Manual steps the VA performs:
${stepLines || "(no steps recorded)"}`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": LOVABLE_API_KEY,
      },
      body: JSON.stringify({
        model: "openai/gpt-5.5-pro",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("Rate limit reached — please try again in a moment.");
      if (res.status === 402) throw new Error("AI credits exhausted. Add credits in Workspace → Usage.");
      throw new Error(`AI gateway error ${res.status}: ${text.slice(0, 200)}`);
    }

    const j: any = await res.json();
    const plan: string = j.choices?.[0]?.message?.content ?? "";
    if (!plan.trim()) throw new Error("The model returned an empty plan.");

    await supabaseAdmin.from("admin_actions").insert({
      actor_id: context.userId,
      action: "sop_automation_suggested",
      metadata: { sop_id: sop.id, model: "openai/gpt-5.5-pro" },
    });

    return { plan, model: "openai/gpt-5.5-pro", generatedAt: new Date().toISOString() };
  });

// Admin: create a draft SOP from a captured workflow signature.
// Pulls the VA's recent workflow_steps, asks Lovable AI to draft a clean SOP,
// inserts it into `sops` (status=auto, source=manual), and links the signature.
export const createSopFromSignature = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ signatureId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: sig, error: sigErr } = await supabaseAdmin
      .from("workflow_signatures")
      .select("id, va_id, signature, generated_sop_id")
      .eq("id", data.signatureId)
      .maybeSingle();
    if (sigErr) throw new Error(sigErr.message);
    if (!sig) throw new Error("Signature not found");
    if (sig.generated_sop_id) return { sopId: sig.generated_sop_id, existed: true };

    const { data: steps } = await supabaseAdmin
      .from("workflow_steps")
      .select("step_index,label,url,screenshot_path,rect,viewport,dpr,created_at")
      .eq("va_id", sig.va_id)
      .order("created_at", { ascending: false })
      .limit(50);

    const ordered = (steps ?? []).slice().reverse();
    const labels = ordered.map((s: any) => normalize(s.label)).filter(Boolean);
    const firstUrl = ordered[0]?.url ?? "";

    let aiPayload: {
      title: string;
      description: string;
      steps: { index: number; instruction: string }[];
    } | null = null;

    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    if (LOVABLE_API_KEY && labels.length) {
      const prompt = `You are documenting a repeated workflow performed by a virtual assistant.
Given this ordered sequence of UI interactions, produce a clean, imperative SOP.

Steps (raw labels): ${JSON.stringify(labels.slice(0, 20))}
URL context: ${firstUrl}

Return strict JSON: {"title": string, "description": string, "steps": [{"index": number, "instruction": string}]}.
Keep instructions short and action-oriented. Max 10 steps.`;
      try {
        const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
        if (res.ok) {
          const j: any = await res.json();
          aiPayload = JSON.parse(j.choices?.[0]?.message?.content ?? "{}");
        }
      } catch {
        /* fall through to fallback */
      }
    }

    if (!aiPayload || !aiPayload.title) {
      let host = "site";
      try { host = firstUrl ? new URL(firstUrl).host : "site"; } catch { /* ignore */ }
      aiPayload = {
        title: `Repeated workflow on ${host}`,
        description: "Draft SOP generated from a repeated click sequence.",
        steps: labels.slice(0, 10).map((l, i) => ({ index: i + 1, instruction: l })),
      };
    }

    const stepsWithShots = aiPayload.steps.map((st, i) => ({
      ...st,
      screenshot_path: ordered[i]?.screenshot_path ?? null,
      rect: (ordered[i] as any)?.rect ?? null,
      viewport: (ordered[i] as any)?.viewport ?? null,
      dpr: (ordered[i] as any)?.dpr ?? null,
    }));

    const { data: sop, error: sopErr } = await supabaseAdmin
      .from("sops")
      .insert({
        title: trim(aiPayload.title, 200),
        description: trim(aiPayload.description, 1000),
        steps: stepsWithShots,
        source: "manual",
        generated_from_signature: sig.signature,
        generated_for_va: sig.va_id,
        status: "auto",
      })
      .select("id")
      .single();
    if (sopErr) throw new Error(sopErr.message);

    await supabaseAdmin
      .from("workflow_signatures")
      .update({ generated_sop_id: sop.id })
      .eq("id", sig.id);

    await supabaseAdmin.from("admin_actions").insert({
      actor_id: context.userId,
      action: "sop_created_from_signature",
      target_user_id: sig.va_id,
      metadata: { signature_id: sig.id, sop_id: sop.id },
    });

    return { sopId: sop.id, existed: false };
  });
