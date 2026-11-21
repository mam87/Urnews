// Edge Function: intel-translate
// Translates the titles of the top YouTube analysis videos and the non-Arabic trend keywords of the Global
// Intelligence centre (migration 29) into Arabic, in one batched AI request per call. Invoked by pg_cron every
// 10 minutes only when something is waiting (public.intel_translate_tick). Same daily AI budget, cool-down and
// guard rails as news-translate: Arabic output only, no numbers or quotations that are not in the input.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BATCH = 8;
const BACKOFF_MINUTES = 15;

import { inputOf, Item, parseBatch, SYSTEM, validate } from "./lib.ts";

class RateLimited extends Error {}

/** One chat request. Provider is inferred from the key exactly as in news-ingest (lib/ai.ts). */
async function callModel(user: string, maxTokens: number): Promise<string> {
  const key = (Deno.env.get("AI_API_KEY") || "").trim();
  if (!key) throw new Error("AI_API_KEY is not set");
  const guess = key.startsWith("sk-ant-") ? "anthropic" : key.startsWith("AIza") || key.startsWith("AQ.") ? "gemini" : key.startsWith("gsk_") ? "groq" : "openai";
  const declared = (Deno.env.get("AI_PROVIDER") || "").toLowerCase();
  const kind = declared === "anthropic" || declared === "openai" ? declared : guess;
  const defaults: Record<string, [string, string]> = {
    anthropic: ["claude-haiku-5-5", ""],
    gemini: ["gemini-flash-lite-latest", "https://generativelanguage.googleapis.com/v1beta/openai"],
    groq: ["llama-3.3-70b-versatile", "https://api.groq.com/openai/v1"],
    openai: ["gpt-4o-mini", "https://api.openai.com/v1"],
  };
  const profile = kind === "anthropic" ? "anthropic" : guess === "anthropic" ? "openai" : guess;
  const model = Deno.env.get("AI_MODEL") || defaults[profile][0];
  const base = (Deno.env.get("AI_BASE_URL") || defaults[profile][1] || "https://api.openai.com/v1").replace(/\/+$/, "");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 40_000);
  try {
    const r = kind === "anthropic"
      ? await fetch("https://api.anthropic.com/v1/messages", { method: "POST", signal: ctrl.signal,
          headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0, system: SYSTEM, messages: [{ role: "user", content: user }] }) })
      : await fetch(`${base}/chat/completions`, { method: "POST", signal: ctrl.signal,
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, temperature: 0, max_tokens: maxTokens, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }] }) });
    if (!r.ok) {
      const msg = `AI HTTP ${r.status}: ${(await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200)}`;
      throw [401, 403, 429].includes(r.status) ? new RateLimited(msg) : new Error(msg);
    }
    const j = await r.json();
    return kind === "anthropic" ? (j.content || []).map((c: { text?: string }) => c.text || "").join("") : j.choices?.[0]?.message?.content || "";
  } finally { clearTimeout(timer); }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: ok, error } = await sb.rpc("news_check_ingest_token", { p_token: req.headers.get("x-ingest-token") ?? "" });
  if (error || ok !== true) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json" } });

  const { data: granted } = await sb.rpc("news_ai_take", { p_n: 1 });
  if (!granted) return json({ translated: 0, reason: "no AI budget or cooling down" });
  const { data: items, error: e1 } = await sb.rpc("intel_translate_take", { p_limit: BATCH });
  if (e1 || !items?.length) { await sb.rpc("news_ai_refund", { p_n: 1 }); return json({ translated: 0, reason: e1?.message || "nothing waiting" }); }

  const list = items as Item[];
  const inputs = list.map(inputOf);
  const user = "ترجم المواد التالية إلى العربية. لكل مادة: عنوان مترجم، وملخص هو ترجمة مختصرة لنصها.\n\n" +
    list.map((it, k) => `### مادة ${k + 1} — المصدر: ${it.source_name}\n${inputs[k]}`).join("\n\n");
  try {
    const text = await callModel(user, Math.min(4000, 260 * list.length + 200));
    const rows: { kind: string; id: number; title: string; summary: string | null }[] = [];
    for (const raw of parseBatch(text)) {
      const i = Number((raw as { i?: unknown })?.i);
      if (!Number.isInteger(i) || i < 1 || i > list.length) continue;
      const it = list[i - 1];
      if (rows.some((r) => r.id === it.id && r.kind === it.kind)) continue;
      const v = validate(inputs[i - 1], raw);
      if (v) rows.push({ kind: it.kind ?? "video", id: it.id, title: v.title, summary: v.summary && it.summary ? v.summary : null });
    }
    const { data: n, error: e2 } = rows.length ? await sb.rpc("intel_set_translations", { p: rows }) : { data: 0, error: null };
    if (e2) throw new Error(e2.message);
    return json({ asked: list.length, translated: n });
  } catch (e) {
    if (e instanceof RateLimited) { await sb.rpc("news_ai_refund", { p_n: 1 }); await sb.rpc("news_ai_backoff", { p_minutes: BACKOFF_MINUTES }); }
    console.error("intel-translate", (e as Error).message);
    return json({ translated: 0, error: (e as Error).message });
  }
});
