// Edge Function: news-stories — writes DRAFT full articles for important events.
// Called by pg_cron every 10 minutes (only while story_enabled = true), or by a signed-in editor from the admin
// dashboard ("write / refresh this story"). Nothing it writes is public until an editor approves it.
//
// Auth: the Vault shared secret (x-ingest-token, from pg_cron) OR a user JWT whose owner is in news_admins.
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { aiConfigFromEnv, AIRateLimited, callModel } from "../news-ingest/lib/ai.ts";
import { Lang, MaterialRow } from "./lib/compose.ts";
import { Candidate, ModelRateLimited, Request, runStories, StoryDb, StorySettings, Target } from "./lib/run.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, apikey, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};

function storyDb(sb: SupabaseClient): StoryDb {
  const rpc = async <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as T;
  };
  return {
    async settings(): Promise<StorySettings> {
      const { data, error } = await sb.from("news_settings").select("key,value").like("key", "story_%");
      if (error) throw new Error("settings: " + error.message);
      const m = Object.fromEntries((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
      const num = (k: string, d: number) => (Number.isFinite(Number(m[k])) && m[k] !== null ? Number(m[k]) : d);
      const langs = Array.isArray(m.story_languages) ? (m.story_languages as string[]).filter((l): l is Lang => l === "ar" || l === "en") : ["ar", "en"] as Lang[];
      return {
        enabled: m.story_enabled === true,
        languages: langs.length ? langs : ["ar"],
        maxEvents: Math.min(5, Math.max(1, num("story_max_events_per_run", 2))),
        thresholds: { minReports: num("story_min_reports", 3), minPublishers: num("story_min_publishers", 2), minChars: num("story_min_material_chars", 600) },
      };
    },
    candidates: (limit) => rpc<Candidate[]>("news_story_candidates", { p_limit: limit }),
    material: (cluster) => rpc<MaterialRow[]>("news_story_material", { p_cluster: cluster, p_limit: 24 }),
    target: (id) => rpc<Target | null>("news_story_target", { p_id: id }),
    aiTake: (n) => rpc<number>("news_story_ai_take", { p_n: n }),
    aiRefund: (n) => rpc<void>("news_story_ai_refund", { p_n: n }),
    aiBackoff: (m) => rpc<void>("news_ai_backoff", { p_minutes: m }),
    saveDraft: (p) => rpc<number>("news_story_save_draft", { p }),
    logAttempt: (p) => rpc<void>("news_story_log_attempt", { p }),
  };
}

async function authorised(req: Request_, sb: SupabaseClient): Promise<"cron" | "editor" | null> {
  const token = req.headers.get("x-ingest-token");
  if (token) {
    const { data } = await sb.rpc("news_check_ingest_token", { p_token: token });
    return data === true ? "cron" : null;
  }
  const auth = req.headers.get("authorization") ?? "";
  if (!/^Bearer\s+\S+/.test(auth) || !ANON_KEY) return null;
  const user = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data } = await user.rpc("news_is_admin");
  return data === true ? "editor" : null;
}
type Request_ = globalThis.Request;

function parseRequest(body: Record<string, unknown>): Request {
  if (Number.isInteger(body.story_id)) return { kind: "story", story_id: body.story_id as number };
  if (Number.isInteger(body.cluster_id)) {
    const langs = Array.isArray(body.languages) ? (body.languages as unknown[]).filter((l): l is Lang => l === "ar" || l === "en") : undefined;
    return { kind: "event", cluster_id: body.cluster_id as number, languages: langs };
  }
  return { kind: "auto" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: CORS });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const who = await authorised(req, sb);
  if (!who) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...CORS, "content-type": "application/json" } });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const request = who === "editor" ? parseRequest(body) : { kind: "auto" as const };
  const cfg = { ...aiConfigFromEnv((k) => Deno.env.get(k)), timeoutMs: 55_000 };
  const model = cfg.provider === "none" ? null : async (system: string, user: string, maxTokens: number) => {
    try { return await callModel(cfg, system, user, maxTokens); }
    catch (e) { if (e instanceof AIRateLimited) throw new ModelRateLimited((e as Error).message); throw e; }
  };
  const result = await runStories({ db: storyDb(sb), model, modelName: cfg.model, log: (...a) => console.error(...a), budgetMs: 85_000 }, request);
  console.log(JSON.stringify({ who, request, ...result }));
  return new Response(JSON.stringify(result), { headers: { ...CORS, "content-type": "application/json" } });
});
