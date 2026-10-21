/**
 * Script-writing bake-off (docs/AI_VIDEO_PLAN.md AI-2): the same whole-script prompt for one of
 * your storyboards, sent to several text models through OpenRouter. Writes a Markdown report to
 * storage/ai-bakeoff/ to read side by side, and logs every call (with its real cost) in
 * ai_requests under the product's owner, so it counts toward your spending caps.
 *
 *   npx tsx scripts/ai-bakeoff.ts <storyboard-id> [model ...]
 *
 * Costs money (≈ ฿1–2 for the default four models). Nothing in the storyboard is changed.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { parseJsonReply } from "../src/features/ai/json";
import { usdToThb } from "../src/features/ai/models";
import { chat, OpenRouterError } from "../src/features/ai/openrouter";
import { buildScriptPrompt, parseScriptJson, SCRIPT_JSON_SCHEMA } from "../src/features/content/ai-script";
import { promptFacts } from "../src/features/content/ai-prompt";
import { buildFacts } from "../src/features/content/facts";
import { getTemplate, type Platform, PLATFORM_LABEL, SCENE_KIND_LABEL } from "../src/features/content/templates";
import type { Provenance } from "../src/features/products/schema";
import type { Database } from "../src/lib/supabase/database.types";

const DEFAULT_MODELS = ["deepseek/deepseek-v4.1-flash", "anthropic/claude-haiku-5.5", "qwen/qwen3.8-flash", "anthropic/claude-sonnet-5.5"];

function env(name: string): string {
  if (process.env[name]) return process.env[name]!;
  const m = new RegExp(`^${name}=(.*)$`, "m").exec(readFileSync(".env.local", "utf8"));
  if (!m) throw new Error(`${name} missing in .env.local`);
  return (process.env[name] = m[1].trim());
}

async function main() {
  const [storyboardId, ...models] = process.argv.slice(2);
  if (!storyboardId) throw new Error("usage: npx tsx scripts/ai-bakeoff.ts <storyboard-id> [model ...]");
  env("OPENROUTER_API_KEY");
  const db = createClient<Database>(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

  const { data: sb } = await db.from("storyboards").select("*, project:content_projects(*)").eq("id", storyboardId).single();
  if (!sb?.project) throw new Error("storyboard not found");
  const project = sb.project;
  const { data: product } = await db.from("products").select("*").eq("id", project.product_id).single();
  const { data: rows } = await db.from("product_facts").select("*").eq("product_id", project.product_id).order("position");
  const { data: scenes } = await db.from("storyboard_scenes").select("*").eq("storyboard_id", storyboardId).order("position");
  if (!product || !scenes?.length) throw new Error("product or scenes missing");

  const facts = buildFacts({ ...product, provenance: product.provenance as Provenance }, rows ?? []);
  const codes = new Map(promptFacts(facts).map(({ code, fact }) => [code, fact.key]));
  const labelOf = new Map(facts.map((f) => [f.key, f.label]));
  const prompt = buildScriptPrompt(
    {
      productName: product.name,
      templateName: getTemplate(sb.template_id)?.name ?? sb.template_id,
      platformLabel: PLATFORM_LABEL[project.platform as Platform],
      targetSeconds: project.target_duration_s,
      instruction: "",
    },
    scenes.map((s) => ({ kindLabel: SCENE_KIND_LABEL[s.kind] ?? s.kind, narration: s.narration, on_screen_text: s.on_screen_text, visual_note: s.visual_note })),
    facts,
  );

  const out: string[] = [`# เทียบโมเดลเขียนสคริปต์ — ${product.name}`, "", `สคริปต์ ${storyboardId} · ${scenes.length} ฉาก · ${project.target_duration_s} วินาที · ${new Date().toLocaleString("th-TH")}`, ""];
  let total = 0;
  for (const model of models.length ? models : DEFAULT_MODELS) {
    process.stdout.write(`${model} … `);
    const started = Date.now();
    try {
      const r = await chat({ model, messages: [{ role: "user", content: prompt }], schema: SCRIPT_JSON_SCHEMA, maxTokens: 6000, temperature: 0.7, reasoningEffort: "low", timeoutMs: 120_000 });
      const thb = usdToThb(r.costUsd);
      total += thb;
      await db.from("ai_requests").insert({ owner_id: product.owner_id, task: "script", model: r.model, status: "succeeded", generation_id: r.generationId, input_tokens: r.inputTokens, output_tokens: r.outputTokens, cost_usd: r.costUsd, cost_thb: thb, product_id: product.id, storyboard_id: storyboardId });
      const parsed = parseScriptJson(parseJsonReply(r.text), codes, scenes.length);
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`฿${thb.toFixed(4)} ${secs}s ${parsed.ok ? "ok" : "INVALID"}`);
      out.push(`## ${model}`, "", `฿${thb.toFixed(4)} · ${r.inputTokens} / ${r.outputTokens} token · ${secs} วิ · ${parsed.ok ? "ผ่านการตรวจรูปแบบ" : "**ไม่ผ่านการตรวจ**"}`, "");
      if (!parsed.ok) {
        out.push(...parsed.errors.map((e) => `- ${e}`), "", "```", r.text.slice(0, 3000), "```", "");
        continue;
      }
      const d = parsed.value;
      out.push(`**Hook:** ${d.hook}`, "");
      d.scenes.forEach((s, i) => {
        out.push(`${i + 1}. ${s.narration}`);
        if (s.on_screen_text) out.push(`   - บนจอ: ${s.on_screen_text}`);
        for (const c of s.claims) out.push(`   - claim: ${c.text} → ${c.factKey ? labelOf.get(c.factKey) : "(ไม่อ้างอิง)"}`);
      });
      out.push("", `**CTA:** ${d.cta}`, "", `**แคปชัน:** ${d.caption}`, "", ...parsed.warnings.map((w) => `- ⚠ ${w}`), "");
    } catch (e) {
      const msg = e instanceof OpenRouterError ? e.message : String(e);
      console.log(`failed: ${msg}`);
      await db.from("ai_requests").insert({ owner_id: product.owner_id, task: "script", model, status: "failed", error: msg.slice(0, 1000), product_id: product.id, storyboard_id: storyboardId });
      out.push(`## ${model}`, "", `ล้มเหลว: ${msg}`, "");
    }
  }
  out.push(`---`, `รวม ฿${total.toFixed(4)}`);
  const dir = path.join("storage", "ai-bakeoff");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
  writeFileSync(file, out.join("\n"), "utf8");
  console.log(`total ฿${total.toFixed(4)} → ${file}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
