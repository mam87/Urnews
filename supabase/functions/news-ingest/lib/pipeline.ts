// Ingestion pipeline. Pure orchestration over injectable `fetch` and `db` so it can be tested offline.
import { FeedItem, FeedParseError, parseFeed } from "./feed.ts";
import { canonicalUrl, safeUrl, sha256Hex } from "./url.ts";
import { detectLanguage, jaccard, titleTokens, truncate } from "./text.ts";
import { Category, classify, cleanHeadline, SourceInfo } from "./classify.ts";
import { backoffMinutes, isTransientStatus, retryAfterSeconds, robotsAllows } from "./robots.ts";
import { AIConfig, aiProcess, digitsIn } from "./ai.ts";

export const USER_AGENT = "LahzaNewsBot/1.0 (+https://github.com/; RSS reader; respects robots.txt)";

export interface SourceRow {
  id: number; slug: string; name_ar: string; feed_url: string; homepage: string; language: string;
  kind: SourceInfo["kind"]; reliability: number; default_category: Category | null; topical: boolean;
  tz_offset_minutes: number; tz_force_minutes?: number | null; poll_interval_minutes: number; max_items: number; allow_images: boolean;
  allow_excerpt: boolean; consecutive_failures: number; etag: string | null; last_modified: string | null;
  robots_checked_at: string | null; robots_allowed: boolean | null;
}

export interface Settings {
  max_sources_per_run: number; max_item_age_hours: number; auto_publish: boolean; breaking_hours: number;
  ai_summarize: boolean;
}

export interface SimilarRow { idx: number; article_id: number; cluster_id: number | null; source_id: number; sim: number; title_tokens: string[]; language: string }

export interface Db {
  beginRun(): Promise<number | null>;
  settings(): Promise<Settings>;
  claimSources(runId: number, limit: number): Promise<SourceRow[]>;
  recordFetch(r: Record<string, unknown>): Promise<void>;
  existingHashes(hashes: string[]): Promise<Set<string>>;
  similar(titles: string[]): Promise<SimilarRow[]>;
  insertArticles(rows: Record<string, unknown>[]): Promise<number>;
  aiTake(n: number): Promise<number>;
  backfillImages?(rows: { url_hash: string; image_url: string | null; summary: string | null }[]): Promise<number>;
  finishRun(runId: number, stats: Record<string, unknown>): Promise<void>;
}

export interface Deps {
  fetch: typeof fetch;
  db: Db;
  ai: AIConfig;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  log?: (...a: unknown[]) => void;
}

interface Candidate {
  source: SourceRow;
  item: FeedItem;
  url: string;
  hash: string;
  title: string;
  titleOriginal: string | null;
  summary: string | null;
  summaryKind: "feed" | "ai" | "none";
  language: string;
  translated: boolean;
  tokens: string[];
  digits: Set<string>;
  publishedAt: Date;
  estimated: boolean;
  cls: ReturnType<typeof classify>;
  matchId?: number;
  dupOf?: number;
  groupKey?: string;
  groupSize?: number;
  drop?: boolean;
}

const FETCH_TIMEOUT_MS = 15_000;
/** Longest excerpt we republish. The full article always stays on the publisher's site. */
export const EXCERPT_MAX = 600;

/** Pick the most useful publisher-provided text, as a limited excerpt (never the full article). */
export function bestExcerpt(item: FeedItem): string {
  const clean = (t: string) => (t || "").replace(/\s+/g, " ").trim();
  let desc = clean(item.description);
  const content = clean(item.content);
  if (desc === clean(item.title)) desc = "";
  let text = content.length > desc.length + 40 ? content : desc;
  // drop a repeated headline at the start of the text
  const t = clean(item.title);
  if (t && text.startsWith(t)) text = text.slice(t.length).replace(/^[\s:\-\u2013\u2014|.]+/, "");
  return text ? truncate(text, EXCERPT_MAX) : "";
}
const MAX_BODY = 5_000_000;

async function timedFetch(f: typeof fetch, url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await f(url, { ...init, signal: ctrl.signal, redirect: "follow" }); }
  finally { clearTimeout(t); }
}

export function decodeBody(buf: Uint8Array, contentType: string | null): string {
  let charset = (contentType || "").match(/charset=["']?([\w-]+)/i)?.[1];
  if (!charset) {
    const head = new TextDecoder("latin1").decode(buf.slice(0, 300));
    charset = head.match(/<\?xml[^>]*encoding=["']([\w-]+)["']/i)?.[1];
  }
  try { return new TextDecoder((charset || "utf-8").toLowerCase()).decode(buf); }
  catch { return new TextDecoder("utf-8").decode(buf); }
}

async function readLimited(res: Response): Promise<Uint8Array> {
  const len = Number(res.headers.get("content-length") || 0);
  if (len > MAX_BODY) throw new Error("feed too large");
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY) { await reader.cancel(); throw new Error("feed too large"); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}

/** Fetch with one retry on transient failures. */
async function fetchFeed(deps: Deps, src: SourceRow) {
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const headers: Record<string, string> = {
    "user-agent": USER_AGENT,
    accept: "application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5",
  };
  if (src.etag) headers["if-none-match"] = src.etag;
  if (src.last_modified) headers["if-modified-since"] = src.last_modified;
  let lastErr = "";
  let lastStatus: number | null = null;
  let retryAfter: number | null = null;
  let attempt = 1;
  for (; attempt <= 2; attempt++) {
    try {
      const res = await timedFetch(deps.fetch, src.feed_url, { headers }, FETCH_TIMEOUT_MS);
      lastStatus = res.status;
      if (res.status === 304) { await res.body?.cancel(); return { kind: "not_modified" as const, status: 304, attempts: attempt }; }
      if (res.ok) {
        const buf = await readLimited(res);
        return {
          kind: "ok" as const, status: res.status, attempts: attempt,
          body: decodeBody(buf, res.headers.get("content-type")),
          etag: res.headers.get("etag"), lastModified: res.headers.get("last-modified"),
        };
      }
      await res.body?.cancel();
      lastErr = `HTTP ${res.status}`;
      retryAfter = retryAfterSeconds(res.headers.get("retry-after"));
      if (!isTransientStatus(res.status) || attempt === 2) break;
      if (retryAfter !== null && retryAfter > 5) break; // don't hammer; wait for next scheduled run
      await sleep(1500 * attempt);
    } catch (e) {
      lastErr = (e as Error).name === "AbortError" ? `timeout after ${FETCH_TIMEOUT_MS / 1000}s` : String((e as Error).message || e);
      if (lastErr === "feed too large" || attempt === 2) break;
      await sleep(1500 * attempt);
    }
  }
  return { kind: "error" as const, status: lastStatus, attempts: Math.min(attempt, 2), error: lastErr, retryAfter };
}

async function checkRobots(deps: Deps, src: SourceRow, now: Date): Promise<boolean | undefined> {
  const fresh = src.robots_checked_at && now.getTime() - Date.parse(src.robots_checked_at) < 24 * 3600_000;
  if (fresh && src.robots_allowed !== null) return undefined; // use cached value
  const u = new URL(src.feed_url);
  try {
    const res = await timedFetch(deps.fetch, `${u.origin}/robots.txt`, { headers: { "user-agent": USER_AGENT } }, 8000);
    if (res.status >= 400 && res.status < 500) { await res.body?.cancel(); return true; } // no robots.txt => allowed
    if (!res.ok) { await res.body?.cancel(); return src.robots_allowed ?? true; }
    const txt = new TextDecoder().decode((await readLimited(res)).slice(0, 500_000));
    return robotsAllows(txt, USER_AGENT, u.pathname + u.search);
  } catch {
    return src.robots_allowed ?? true; // network trouble: keep previous decision
  }
}

export function sourceInfo(s: SourceRow): SourceInfo {
  return { kind: s.kind, reliability: s.reliability, default_category: s.default_category, topical: s.topical };
}

async function buildCandidates(deps: Deps, src: SourceRow, items: FeedItem[], st: Settings, now: Date): Promise<Candidate[]> {
  const maxAge = st.max_item_age_hours * 3600_000;
  const out: Candidate[] = [];
  const sorted = [...items].sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
  for (const item of sorted.slice(0, src.max_items)) {
    const safe = safeUrl(item.url, src.feed_url);
    if (!safe) continue;
    let pub = item.publishedAt;
    let estimated = false;
    if (!pub) { pub = now; estimated = true; }
    if (pub.getTime() > now.getTime() + 15 * 60_000) { pub = now; estimated = true; } // future date = bad feed clock/zone
    if (now.getTime() - pub.getTime() > maxAge) continue;
    const title = truncate(cleanHeadline(item.title), 300);
    if (title.length < 3) continue;
    const url = canonicalUrl(safe);
    const desc = bestExcerpt(item);
    const lang = detectLanguage(title) === "ar" ? "ar" : (src.language || detectLanguage(title));
    const cls = classify(item.title, desc, item.categories, sourceInfo(src));
    out.push({
      source: src, item, url: safe, hash: await sha256Hex(url), title, titleOriginal: null,
      summary: src.allow_excerpt && desc ? desc : null,
      summaryKind: src.allow_excerpt && desc ? "feed" : "none",
      language: lang, translated: false, tokens: titleTokens(title), digits: digitsIn(title),
      publishedAt: pub, estimated, cls,
    });
  }
  return out;
}

function digitsConflict(a: Set<string>, b: Set<string>): boolean {
  if (!a.size || !b.size) return false;
  for (const d of a) if (b.has(d)) return false;
  return true;
}

/** Decide duplicates / same-event matches. Conservative to avoid merging unrelated stories. */
export function sameEvent(aTokens: string[], bTokens: string[], aDigits: Set<string>, bDigits: Set<string>, trigramSim = 0) {
  const { score, shared } = jaccard(aTokens, bTokens);
  if (digitsConflict(aDigits, bDigits)) return { dup: false, related: false, score };
  const dup = score >= 0.7 && shared >= 3;
  const related = shared >= 3 && (score >= 0.4 || (trigramSim >= 0.55 && score >= 0.3));
  return { dup, related, score };
}

export function dedupe(cands: Candidate[], similar: SimilarRow[]) {
  const byIdx = new Map<number, SimilarRow[]>();
  for (const r of similar) {
    const list = byIdx.get(r.idx) ?? [];
    list.push(r);
    byIdx.set(r.idx, list);
  }
  cands.forEach((c, i) => {
    let bestRelated: { id: number; score: number } | null = null;
    for (const r of byIdx.get(i + 1) ?? []) { // SQL ordinality is 1-based
      const v = sameEvent(c.tokens, r.title_tokens || [], c.digits, digitsIn((r.title_tokens || []).join(" ")), r.sim);
      if (r.source_id === c.source.id && v.dup) { c.dupOf = r.article_id; break; }
      if (r.source_id !== c.source.id && v.related && (!bestRelated || v.score > bestRelated.score)) bestRelated = { id: r.article_id, score: v.score };
    }
    if (!c.dupOf && bestRelated) c.matchId = bestRelated.id;
  });
  // Within-batch: same source near-identical => drop later; different sources => group.
  const parent = cands.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < cands.length; i++) {
    if (cands[i].dupOf || cands[i].drop) continue;
    for (let j = i + 1; j < cands.length; j++) {
      if (cands[j].dupOf || cands[j].drop) continue;
      const v = sameEvent(cands[i].tokens, cands[j].tokens, cands[i].digits, cands[j].digits);
      if (cands[i].source.id === cands[j].source.id) { if (v.dup) cands[j].drop = true; }
      else if (v.related) parent[find(j)] = find(i);
    }
  }
  const sizes = new Map<number, number>();
  cands.forEach((c, i) => { if (!c.drop && !c.dupOf) sizes.set(find(i), (sizes.get(find(i)) ?? 0) + 1); });
  cands.forEach((c, i) => {
    const root = find(i);
    if ((sizes.get(root) ?? 0) > 1) { c.groupKey = `g${root}`; c.groupSize = sizes.get(root); }
  });
  // If any member of a batch group matched an existing article, share that match.
  const groupMatch = new Map<string, number>();
  for (const c of cands) if (c.groupKey && c.matchId && !groupMatch.has(c.groupKey)) groupMatch.set(c.groupKey, c.matchId);
  for (const c of cands) if (c.groupKey && !c.matchId && groupMatch.has(c.groupKey)) c.matchId = groupMatch.get(c.groupKey);
  return cands;
}

export async function runIngest(deps: Deps) {
  const now = (deps.now ?? (() => new Date()))();
  const log = deps.log ?? (() => {});
  const runId = await deps.db.beginRun();
  if (runId === null) return { skipped: true, status: "skipped", items_new: 0, reason: "another run is active or ingestion is disabled" };
  const stats = { status: "ok", sources_attempted: 0, sources_ok: 0, sources_failed: 0, items_seen: 0, items_new: 0, ai_calls: 0, error: null as string | null };
  try {
    const st = await deps.db.settings();
    const sources = await deps.db.claimSources(runId, st.max_sources_per_run);
    stats.sources_attempted = sources.length;
    const all: Candidate[] = [];
    const perSource = new Map<number, { rec: Record<string, unknown>; cands: Candidate[] }>();

    // Fetch with bounded concurrency
    const queue = [...sources];
    const worker = async () => {
      for (let src = queue.shift(); src; src = queue.shift()) {
        const t0 = Date.now();
        const rec: Record<string, unknown> = { run_id: runId, source_id: src.id };
        let cands: Candidate[] = [];
        const robots = await checkRobots(deps, src, now);
        if (robots !== undefined) rec.robots_allowed = robots;
        const allowed = robots ?? src.robots_allowed ?? true;
        if (!allowed) {
          Object.assign(rec, { status: "blocked", error: "robots.txt disallows this feed", next_fetch_at: new Date(now.getTime() + 24 * 3600_000).toISOString() });
        } else {
          const r = await fetchFeed(deps, src);
          rec.http_status = r.status;
          rec.attempts = r.attempts;
          if (r.kind === "ok") {
            try {
              const items = parseFeed(r.body, src.feed_url, src.tz_offset_minutes, src.tz_force_minutes ?? null);
              cands = await buildCandidates(deps, src, items, st, now);
              Object.assign(rec, { status: "ok", items_found: items.length, etag: r.etag ?? null, last_modified: r.lastModified ?? null });
            } catch (e) {
              const msg = e instanceof FeedParseError ? `parse error: ${e.message}` : `processing error: ${(e as Error).message}`;
              Object.assign(rec, { status: "error", error: msg, etag: null, last_modified: null });
            }
          } else if (r.kind === "not_modified") {
            rec.status = "not_modified";
          } else {
            Object.assign(rec, { status: "error", error: r.error });
            if (r.retryAfter) rec.retry_after = r.retryAfter;
          }
          const failures = rec.status === "error" ? src.consecutive_failures + 1 : 0;
          let mins = backoffMinutes(src.poll_interval_minutes, failures);
          if (typeof rec.retry_after === "number") mins = Math.max(mins, Math.ceil((rec.retry_after as number) / 60));
          const jitter = Math.floor(Math.random() * 20) * 1000; // spread load
          rec.next_fetch_at = new Date(now.getTime() + mins * 60_000 + jitter).toISOString();
          delete rec.retry_after;
        }
        rec.duration_ms = Date.now() - t0;
        if (rec.status === "ok" || rec.status === "not_modified") stats.sources_ok++; else stats.sources_failed++;
        perSource.set(src.id, { rec, cands });
        all.push(...cands);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, sources.length) }, worker));
    stats.items_seen = all.length;

    // Exact duplicates (by canonical URL hash)
    const existing = all.length ? await deps.db.existingHashes([...new Set(all.map((c) => c.hash))]) : new Set<string>();
    // Articles we already have: fill in a missing thumbnail / a longer feed excerpt (never overwrite editor work).
    if (deps.db.backfillImages) {
      const imgs = all.filter((c) => existing.has(c.hash) && (c.item.image?.startsWith("https://") || c.summary))
        .map((c) => ({ url_hash: c.hash, image_url: c.item.image?.startsWith("https://") ? c.item.image : null, summary: c.summary }));
      if (imgs.length) await deps.db.backfillImages(imgs.slice(0, 200)).catch((e) => log("backfill failed", (e as Error).message));
    }
    const seen = new Set<string>();
    let fresh = all.filter((c) => {
      if (existing.has(c.hash) || seen.has(c.hash)) return false;
      seen.add(c.hash);
      return true;
    });

    // Optional AI: translation of non-Arabic items first, then summaries if enabled.
    if (deps.ai.provider !== "none" && fresh.length) {
      const needTranslate = fresh.filter((c) => c.language !== "ar");
      const needSummary = st.ai_summarize ? fresh.filter((c) => c.language === "ar" && (c.item.description?.length ?? 0) > 400 && c.source.allow_excerpt) : [];
      const wanted = [...needTranslate, ...needSummary.slice(0, 10)];
      const granted = wanted.length ? await deps.db.aiTake(wanted.length) : 0;
      for (const c of wanted.slice(0, granted)) {
        try {
          stats.ai_calls++;
          const mode = c.language !== "ar" ? "translate" : "summarize";
          const res = await aiProcess(deps.ai, c.item.title, c.item.description || "", mode, { lang: c.language, sourceName: c.source.name_ar });
          if (res) {
            if (mode === "translate") {
              c.titleOriginal = c.title; c.title = res.title; c.translated = true; c.tokens = titleTokens(res.title); c.digits = digitsIn(res.title);
              // Keyword rules are Arabic, so classify again on the translation (category, breaking, attribution).
              c.cls = classify(res.title, res.summary || "", c.item.categories, sourceInfo(c.source));
              c.summary = null; c.summaryKind = "none"; // never keep the foreign-language excerpt
            }
            if (res.summary && c.source.allow_excerpt) { c.summary = res.summary; c.summaryKind = "ai"; }
          }
        } catch (e) { log("ai error", (e as Error).message); }
      }
    }

    // Hebrew is never shown untranslated: items without a translation (no AI key, daily cap reached or
    // rejected output) are skipped now and retried on the next run while still in the feed.
    fresh = fresh.filter((c) => c.language !== "he" || c.translated);

    // Near-duplicates and event clustering
    if (fresh.length) {
      const similar = await deps.db.similar(fresh.map((c) => c.title));
      fresh = dedupe(fresh, similar).filter((c) => !c.drop);
    }

    const breakingMs = st.breaking_hours * 3600_000;
    const rows = fresh.map((c) => {
      const recentEnough = now.getTime() - c.publishedAt.getTime() < 3 * 3600_000;
      const ageMin = (now.getTime() - c.publishedAt.getTime()) / 60_000;
      // Breaking = the publisher says so ("عاجل"), or a fresh high-impact local (Jordan) event.
      // Corroborated multi-source events are promoted later in SQL. Allegations are never auto-breaking.
      const localUrgent = c.cls.highImpact && c.cls.categories.includes("jordan") && ageMin < 60 && c.cls.verification !== "allegation";
      const breaking = (c.cls.isBreakingKeyword && recentEnough || localUrgent) && !c.dupOf && !c.estimated;
      return {
        source_id: c.source.id,
        guid: (c.item.guid || c.url).slice(0, 1000),
        url: c.url,
        url_hash: c.hash,
        title: c.title,
        title_original: c.titleOriginal,
        summary: c.summary,
        summary_kind: c.summary ? c.summaryKind : "none",
        language: c.translated ? "ar" : c.language,
        translated: c.translated,
        category: c.cls.category,
        categories: c.cls.categories,
        image_url: c.item.image?.startsWith("https://") ? c.item.image : null, // display is gated per source (allow_images)
        published_at: c.publishedAt.toISOString(),
        published_estimated: c.estimated,
        title_tokens: c.tokens,
        match_id: c.matchId ?? null,
        dup_of: c.dupOf ?? null,
        group_key: c.groupKey ?? null,
        group_size: c.groupSize ?? null,
        verification: c.cls.verification,
        is_breaking: breaking,
        breaking_until: breaking ? new Date(c.publishedAt.getTime() + breakingMs).toISOString() : null,
        importance: Math.min(100, c.cls.importance),
        status: st.auto_publish ? "published" : "pending",
      };
    });
    const inserted = rows.length ? await deps.db.insertArticles(rows) : 0;
    stats.items_new = inserted;

    // attribute new counts back to sources, then persist per-source results
    const newBySource = new Map<number, number>();
    for (const r of rows) newBySource.set(r.source_id, (newBySource.get(r.source_id) ?? 0) + 1);
    for (const [sid, { rec }] of perSource) {
      rec.items_new = Math.min(newBySource.get(sid) ?? 0, inserted);
      await deps.db.recordFetch(rec);
    }
    if (stats.sources_failed > 0) stats.status = stats.sources_ok > 0 ? "partial" : (sources.length ? "error" : "ok");
  } catch (e) {
    stats.status = "error";
    stats.error = String((e as Error).stack || e).slice(0, 2000);
    log("run failed", stats.error);
  } finally {
    await deps.db.finishRun(runId, stats).catch((e) => log("finishRun failed", e));
  }
  return { runId, ...stats };
}
