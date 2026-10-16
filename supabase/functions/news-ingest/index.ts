// Edge Function: ingest
// Invoked every 2 minutes by pg_cron (see migrations/..._scheduler.sql). Protected by a
// shared secret stored in Supabase Vault; overlapping calls are rejected by a DB lease.
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Db, runIngest, Settings, SimilarRow, SourceRow } from "./lib/pipeline.ts";
import { aiConfigFromEnv } from "./lib/ai.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function supabaseDb(sb: SupabaseClient): Db {
  const rpc = async <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as T;
  };
  return {
    beginRun: () => rpc<number | null>("news_begin_ingest_run"),
    async settings() {
      const { data, error } = await sb.from("news_settings").select("key,value");
      if (error) throw new Error("settings: " + error.message);
      const m = Object.fromEntries((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
      const num = (k: string, d: number) => (Number.isFinite(Number(m[k])) ? Number(m[k]) : d);
      return {
        max_sources_per_run: Math.min(25, Math.max(1, num("max_sources_per_run", 8))),
        max_item_age_hours: num("max_item_age_hours", 48),
        auto_publish: m.auto_publish !== false,
        breaking_hours: num("breaking_hours", 6),
        ai_summarize: m.ai_summarize === true,
      } satisfies Settings;
    },
    claimSources: (runId, limit) => rpc<SourceRow[]>("news_claim_due_sources", { p_run: runId, p_limit: limit }),
    recordFetch: (r) => rpc<void>("news_record_fetch", { p: r }),
    existingHashes: async (h) => new Set(await rpc<string[]>("news_existing_hashes", { p_hashes: h })),
    similar: (titles) => rpc<SimilarRow[]>("news_similar_articles", { p_titles: titles, p_hours: 36 }),
    insertArticles: async (rows) => (await rpc<unknown[]>("news_insert_articles", { p_rows: rows })).length,
    aiTake: (n) => rpc<number>("news_ai_take", { p_n: n }),
    backfillImages: (rows) => rpc<number>("news_backfill_articles", { p_rows: rows }),
    finishRun: (id, stats) => rpc<void>("news_finish_ingest_run", { p_run: id, p: stats }),
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const token = req.headers.get("x-ingest-token") ?? "";
  const { data: ok, error } = await sb.rpc("news_check_ingest_token", { p_token: token });
  if (error || ok !== true) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });

  const result = await runIngest({
    fetch,
    db: supabaseDb(sb),
    ai: aiConfigFromEnv((k) => Deno.env.get(k)),
    log: (...a) => console.error(...a),
  });
  console.log(JSON.stringify(result));
  return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
});
