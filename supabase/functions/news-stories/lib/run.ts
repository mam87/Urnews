// Orchestration for the full-article generator. Injectable db + model so it runs offline in tests.
// Output is ALWAYS a draft (or a proposed update to an approved story); the database refuses anything else.
import {
  checkSufficiency, DEFAULT_THRESHOLDS, extractJson, heroImage, Lang, majorityCategory, MaterialRow, selectRefs, sourcePayload,
  systemPrompt, Thresholds, userPrompt, validateDraft,
} from "./compose.ts";

export interface StorySettings { enabled: boolean; languages: Lang[]; maxEvents: number; thresholds: Thresholds }

export interface ExistingStory { id: number; language: Lang; status: string; event_id: string; source_count: number; has_pending: boolean; article_ids: number[] }
export interface Attempt { outcome: string; report_count: number | null; created_at: string }
export interface Candidate {
  event_key: string; cluster_id: number; lead_article_id: number; score: number; report_count: number; publisher_count: number;
  independent_count: number; countries: string[]; region: string | null; event_type: string | null; allegation: boolean;
  stories: ExistingStory[]; last_attempts: Record<string, Attempt>;
}
export interface Target { id: number; cluster_id: number | null; event_key: string | null; language: Lang; status: string; has_pending: boolean; countries: string[]; region: string | null; article_ids: number[] }

export interface StoryDb {
  settings(): Promise<StorySettings>;
  candidates(limit: number): Promise<Candidate[]>;
  material(clusterId: number): Promise<MaterialRow[]>;
  target(storyId: number): Promise<Target | null>;
  aiTake(n: number): Promise<number>;
  aiRefund(n: number): Promise<void>;
  aiBackoff(minutes: number): Promise<void>;
  saveDraft(p: Record<string, unknown>): Promise<number>;
  logAttempt(p: Record<string, unknown>): Promise<void>;
}

export type Model = (system: string, user: string, maxTokens: number) => Promise<string>;
export class ModelRateLimited extends Error {}

export interface StoryDeps {
  db: StoryDb;
  model: Model | null;          // null = AI not configured
  modelName: string;
  now?: () => Date;
  log?: (...a: unknown[]) => void;
  /** stop starting new generations after this many ms (Edge wall-clock limit is 150 s) */
  budgetMs?: number;
}

export type Request =
  | { kind: "auto" }
  | { kind: "event"; cluster_id: number; languages?: Lang[] }
  | { kind: "story"; story_id: number };

export const MAX_OUTPUT_TOKENS = 3500;
export const NEW_REPORTS_FOR_UPDATE = 2;
export const RETRY_UNCHANGED_HOURS = 6;
export const RETRY_ERROR_MINUTES = 30;

type Mode = "new" | "redraft" | "propose";
export interface Job { cluster_id: number; event_key: string | null; language: Lang; mode: Mode; story_id?: number; countries: string[]; region: string | null; report_count: number }

/** Decide what (if anything) to write for one event in one language. */
export function planJob(c: Candidate, lang: Lang, materialIds: number[], now: Date, forced = false): Job | { skip: string } {
  const base = { cluster_id: c.cluster_id, event_key: c.event_key, language: lang, countries: c.countries, region: c.region, report_count: materialIds.length };
  const existing = c.stories.find((s) => s.language === lang);
  if (!existing) {
    const last = c.last_attempts?.[lang];
    if (!forced && last) {
      const ageH = (now.getTime() - Date.parse(last.created_at)) / 3600_000;
      if (["insufficient", "rejected_output"].includes(last.outcome) && (last.report_count ?? 0) >= materialIds.length && ageH < RETRY_UNCHANGED_HOURS) {
        return { skip: "unchanged since the last unsuccessful attempt" };
      }
      if (last.outcome === "error" && ageH * 60 < RETRY_ERROR_MINUTES) return { skip: "recent error, retrying later" };
    }
    return { ...base, mode: "new" };
  }
  if (existing.status === "rejected") return { skip: "rejected by an editor" };
  const fresh = materialIds.filter((id) => !existing.article_ids.includes(id)).length;
  if (existing.status === "draft") {
    return forced || fresh >= NEW_REPORTS_FOR_UPDATE ? { ...base, mode: "redraft", story_id: existing.id } : { skip: "draft is up to date" };
  }
  if (existing.has_pending && !forced) return { skip: "a proposed update is already waiting for an editor" };
  return forced || fresh >= NEW_REPORTS_FOR_UPDATE ? { ...base, mode: "propose", story_id: existing.id } : { skip: "no new reports" };
}

export interface RunResult { jobs: number; drafted: number; proposed: number; insufficient: number; rejected: number; skipped: number; errors: number; no_budget: boolean; ai_calls: number; details: string[] }

export async function runStories(deps: StoryDeps, req: Request = { kind: "auto" }): Promise<RunResult> {
  const now = deps.now ?? (() => new Date());
  const start = Date.now();
  const log = deps.log ?? (() => {});
  const res: RunResult = { jobs: 0, drafted: 0, proposed: 0, insufficient: 0, rejected: 0, skipped: 0, errors: 0, no_budget: false, ai_calls: 0, details: [] };
  const st = await deps.db.settings();
  if (!st.enabled && req.kind === "auto") { res.details.push("story_enabled = false"); return res; }
  if (!deps.model) { res.details.push("AI is not configured (AI_API_KEY)"); return res; }
  const th = st.thresholds ?? DEFAULT_THRESHOLDS;
  const outOfTime = () => Date.now() - start > (deps.budgetMs ?? 100_000);

  // Build the job list.
  const work: { job: Job; rows: MaterialRow[] }[] = [];
  if (req.kind === "story") {
    const t = await deps.db.target(req.story_id);
    if (!t || !t.cluster_id) { res.details.push("story not found or has no event"); return res; }
    if (t.status === "rejected") { res.details.push("story was rejected by an editor"); return res; }
    const rows = await deps.db.material(t.cluster_id);
    work.push({ rows, job: { cluster_id: t.cluster_id, event_key: t.event_key, language: t.language, countries: t.countries, region: t.region,
      report_count: rows.length, mode: t.status === "draft" ? "redraft" : "propose", story_id: t.id } });
  } else {
    const cands = await deps.db.candidates(10);
    const wanted = req.kind === "event" ? cands.filter((c) => c.cluster_id === req.cluster_id) : cands;
    if (req.kind === "event" && !wanted.length) { res.details.push("event is not among the current ranked events that meet the thresholds"); return res; }
    let events = 0;
    for (const c of wanted) {
      if (events >= Math.max(1, st.maxEvents)) break;
      const rows = await deps.db.material(c.cluster_id);
      const ids = rows.map((r) => r.article_id);
      let any = false;
      for (const lang of (req.kind === "event" && req.languages?.length ? req.languages : st.languages)) {
        const p = planJob(c, lang, ids, now(), req.kind === "event");
        if ("skip" in p) { res.skipped++; res.details.push(`${c.event_key}/${lang}: ${p.skip}`); continue; }
        work.push({ job: p, rows });
        any = true;
      }
      if (any) events++;
    }
  }

  // Events in sequence, languages of one event in parallel.
  const byCluster = new Map<number, { job: Job; rows: MaterialRow[] }[]>();
  for (const w of work) byCluster.set(w.job.cluster_id, [...(byCluster.get(w.job.cluster_id) ?? []), w]);
  let stop = false;
  for (const group of byCluster.values()) {
    if (stop || outOfTime()) { res.details.push("time or budget exhausted; remaining events wait for the next run"); break; }
    // A new story's sibling language must be created one after the other so both share one event_id.
    const sequential = group.filter((g) => g.job.mode === "new");
    const parallel = group.filter((g) => g.job.mode !== "new");
    const outcomes = [
      ...(await Promise.all(parallel.map((g) => one(deps, g.job, g.rows, th, now(), res, log)))),
    ];
    for (const g of sequential) { if (stop) break; outcomes.push(await one(deps, g.job, g.rows, th, now(), res, log)); if (outcomes.includes("stop")) stop = true; }
    if (outcomes.includes("stop")) stop = true;
  }
  return res;
}

async function one(deps: StoryDeps, job: Job, rows: MaterialRow[], th: Thresholds, now: Date, res: RunResult, log: (...a: unknown[]) => void): Promise<"ok" | "stop" | "skip"> {
  res.jobs++;
  const attempt = (outcome: string, reason = "", story_id: number | null = job.story_id ?? null) =>
    deps.db.logAttempt({ cluster_id: job.cluster_id, event_key: job.event_key, language: job.language, story_id, outcome, reason, report_count: rows.length })
      .catch((e) => log("logAttempt", e));
  const refs = selectRefs(rows, job.language);
  const suff = checkSufficiency(refs, th);
  if (!suff.ok) { res.insufficient++; await attempt("insufficient", suff.reason); return "skip"; }
  const granted = await deps.db.aiTake(1);
  if (granted < 1) { res.no_budget = true; await attempt("no_budget", "daily or monthly AI limit reached, or AI paused after a provider refusal"); return "stop"; }
  res.ai_calls++;
  let text: string;
  try {
    text = await deps.model!(systemPrompt(job.language), userPrompt(refs, job.language, { countries: job.countries, now }), MAX_OUTPUT_TOKENS);
  } catch (e) {
    res.errors++;
    if (e instanceof ModelRateLimited) {
      await deps.db.aiRefund(1).catch(() => {});
      await deps.db.aiBackoff(15).catch(() => {});
      await attempt("error", String((e as Error).message).slice(0, 500));
      return "stop";
    }
    await attempt("error", String((e as Error)?.message ?? e).slice(0, 500));
    return "skip";
  }
  const out = validateDraft(extractJson(text), refs, job.language);
  if (!out.ok) {
    const insufficient = out.reason.startsWith("model: insufficient") || out.reason.startsWith("not enough verifiable");
    if (insufficient) res.insufficient++; else res.rejected++;
    await attempt(insufficient ? "insufficient" : "rejected_output",
      out.reason + (out.rejected.length ? " · " + out.rejected.slice(0, 5).map((r) => `${r.where}:${r.code}`).join(", ") : ""));
    return "skip";
  }
  const hero = heroImage(out.refs);
  const payload = {
    mode: job.mode, story_id: job.story_id ?? null, language: job.language, cluster_id: job.cluster_id, event_key: job.event_key,
    category: majorityCategory(rows), countries: job.countries, region: job.region, title: out.title, dek: out.dek, body: out.body,
    sources: out.refs.map((r) => sourcePayload(r, job.language)),
    hero_image_url: hero?.url ?? null, hero_image_credit: hero?.credit ?? null, hero_source_id: hero?.source_id ?? null,
    ai_model: deps.modelName.slice(0, 80),
    generation: {
      warnings: [...out.warnings, ...out.relabelled.map((r) => ({ ...r, code: "relabelled:" + r.code }))],
      rejected: out.rejected, stats: out.stats, material_reports: rows.length, generated_at: now.toISOString(),
    },
  };
  try {
    const id = await deps.db.saveDraft(payload);
    if (job.mode === "propose") res.proposed++; else res.drafted++;
    await attempt(job.mode === "new" ? "drafted" : job.mode === "redraft" ? "redrafted" : "update_proposed",
      `${out.stats.paras_kept}/${out.stats.paras_in} paragraphs kept, ${out.refs.length} sources`, id);
    res.details.push(`${job.event_key}/${job.language}: ${job.mode} → story ${id}`);
    return "ok";
  } catch (e) {
    res.errors++;
    await attempt("error", "save: " + String((e as Error)?.message ?? e).slice(0, 400));
    return "skip";
  }
}
