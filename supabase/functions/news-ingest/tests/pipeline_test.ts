// End-to-end pipeline tests with a mocked network and an in-memory database.
import { assert, assertEquals } from "./assert.ts";
import { Db, runIngest, Settings, SimilarRow, SourceRow } from "../lib/pipeline.ts";
import { aiConfigFromEnv } from "../lib/ai.ts";

const NOW = new Date("2026-10-17T09:00:00Z");

function src(id: number, slug: string, extra: Partial<SourceRow> = {}): SourceRow {
  return {
    id, slug, name_ar: slug, feed_url: `https://${slug}.example/rss`, homepage: `https://${slug}.example/`, language: "ar",
    kind: "media", reliability: 4, default_category: null, topical: false, tz_offset_minutes: 0, poll_interval_minutes: 5,
    max_items: 30, allow_images: false, allow_excerpt: true, consecutive_failures: 0, etag: null, last_modified: null,
    robots_checked_at: null, robots_allowed: null, ...extra,
  };
}

function rss(items: { t: string; l: string; d?: string; date?: string }[]) {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>x</title>${items.map((i) =>
    `<item><title>${i.t}</title><link>${i.l}</link><description>${i.d ?? ""}</description><pubDate>${i.date ?? "Sat, 17 Oct 2026 08:30:00 GMT"}</pubDate></item>`).join("")}</channel></rss>`;
}

class FakeDb implements Db {
  runs = 0;
  active = false;
  sources: SourceRow[] = [];
  articles: Record<string, unknown>[] = [];
  fetches: Record<string, unknown>[] = [];
  finished: Record<string, unknown>[] = [];
  failInsert = false;
  settingsVal: Settings = { max_sources_per_run: 10, max_item_age_hours: 48, auto_publish: true, breaking_hours: 6, ai_summarize: false };
  async beginRun() { if (this.active) return null; this.runs++; return this.runs; }
  async settings() { return this.settingsVal; }
  async claimSources() { return this.sources; }
  async recordFetch(r: Record<string, unknown>) { this.fetches.push(r); }
  async existingHashes(h: string[]) { return new Set(this.articles.map((a) => a.url_hash as string).filter((x) => h.includes(x))); }
  async similar(titles: string[]): Promise<SimilarRow[]> {
    const out: SimilarRow[] = [];
    titles.forEach((_, i) => this.articles.filter((a) => !a.dup_of).forEach((a) => out.push({
      idx: i + 1, article_id: a.id as number, cluster_id: (a.cluster_id as number) ?? null, source_id: a.source_id as number,
      sim: 0.5, title_tokens: a.title_tokens as string[], language: "ar",
    })));
    return out;
  }
  async insertArticles(rows: Record<string, unknown>[]) {
    if (this.failInsert) throw new Error("db down");
    let n = 0;
    for (const r of rows) {
      if (this.articles.some((a) => a.url_hash === r.url_hash)) continue;
      this.articles.push({ ...r, id: this.articles.length + 1 });
      n++;
    }
    return n;
  }
  async aiTake(n: number) { return n; }
  async backfillImages(rows: { url_hash: string; image_url: string | null; summary: string | null }[]) {
    let n = 0;
    for (const r of rows) {
      const a = this.articles.find((x) => x.url_hash === r.url_hash);
      if (!a) continue;
      if (!a.image_url && r.image_url) { a.image_url = r.image_url; n++; }
      if (r.summary && r.summary.length > String(a.summary ?? "").length + 40) a.summary = r.summary;
    }
    return n;
  }
  async finishRun(_id: number, s: Record<string, unknown>) { this.finished.push(s); }
}

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function mockFetch(routes: Record<string, Handler | Handler[]>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const counters: Record<string, number> = {};
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const h = routes[url];
    if (!h) return new Response("not found", { status: 404 });
    if (Array.isArray(h)) { counters[url] = (counters[url] ?? 0); return h[Math.min(counters[url]++, h.length - 1)](url, init); }
    return h(url, init);
  }) as typeof fetch;
  return { f, calls };
}

const noAI = aiConfigFromEnv(() => undefined);
const sleep = () => Promise.resolve();

Deno.test("pipeline: ingest, cluster same event across outlets, flag breaking, then dedupe on next run", async () => {
  const db = new FakeDb();
  db.sources = [src(1, "alpha"), src(2, "beta")];
  const feedA = rss([
    { t: "عاجل | زلزال بقوة 5 درجات يضرب جنوب الأردن", l: "https://alpha.example/n/1?utm_source=rss", d: "أفاد مركز رصد الزلازل بوقوع هزة." },
    { t: "افتتاح معرض عمّان الدولي للكتاب", l: "https://alpha.example/n/2" },
    { t: "خبر قديم جداً", l: "https://alpha.example/n/3", date: "Mon, 12 Oct 2026 08:00:00 GMT" },
  ]);
  const feedB = rss([
    { t: "هزة أرضية بقوة 5 درجات تضرب جنوب الأردن", l: "https://beta.example/x/9" },
    { t: "ارتفاع أسعار الذهب في السوق المحلية", l: "https://beta.example/x/10" },
  ]);
  const { f } = mockFetch({
    "https://alpha.example/rss": () => new Response(feedA, { headers: { "content-type": "application/rss+xml", etag: '"v1"' } }),
    "https://beta.example/rss": () => new Response(feedB),
  });
  const r1 = await runIngest({ fetch: f, db, ai: noAI, now: () => NOW, sleep });
  assertEquals(r1.status, "ok");
  assertEquals(db.articles.length, 4); // old item skipped
  const quakeA = db.articles.find((a) => (a.url as string).includes("alpha.example/n/1"))!;
  const quakeB = db.articles.find((a) => (a.url as string).includes("beta.example/x/9"))!;
  assertEquals(quakeA.title, "زلزال بقوة 5 درجات يضرب جنوب الأردن"); // "عاجل" marker removed from display title
  assertEquals(quakeA.is_breaking, true);
  assertEquals(quakeA.verification, "developing");
  assert(quakeA.group_key && quakeA.group_key === quakeB.group_key, "same event should be grouped");
  const book = db.articles.find((a) => (a.url as string).endsWith("/n/2"))!;
  assertEquals(book.group_key, null);
  assertEquals(db.fetches.find((x) => x.source_id === 1)?.etag, '"v1"');

  // Run 2: same feeds => zero new rows (exact URL duplicate prevention incl. tracking params)
  const r2 = await runIngest({ fetch: f, db, ai: noAI, now: () => NOW, sleep });
  assertEquals(r2.items_new, 0);
  assertEquals(db.articles.length, 4);
});

Deno.test("pipeline: near-duplicate from same source is stored as duplicate, new outlet joins cluster", async () => {
  const db = new FakeDb();
  db.sources = [src(1, "alpha")];
  const { f } = mockFetch({ "https://alpha.example/rss": () => new Response(rss([{ t: "الحكومة تقر نظام الخدمة المدنية الجديد", l: "https://alpha.example/1" }])) });
  await runIngest({ fetch: f, db, ai: noAI, now: () => NOW, sleep });
  const { f: f2 } = mockFetch({ "https://alpha.example/rss": () => new Response(rss([{ t: "الحكومة تقر نظام الخدمة المدنية الجديد رسمياً", l: "https://alpha.example/1-updated" }])) });
  await runIngest({ fetch: f2, db, ai: noAI, now: () => NOW, sleep });
  assertEquals(db.articles.length, 2);
  assertEquals(db.articles[1].dup_of, 1);
  db.sources = [src(2, "beta")];
  const { f: f3 } = mockFetch({ "https://beta.example/rss": () => new Response(rss([{ t: "الحكومة الأردنية تقر نظام الخدمة المدنية", l: "https://beta.example/z" }])) });
  await runIngest({ fetch: f3, db, ai: noAI, now: () => NOW, sleep });
  assertEquals(db.articles[2].match_id, 1);
  assertEquals(db.articles[2].dup_of, null);
});

Deno.test("pipeline: failures — timeout, 503 retry, 304, robots block, malformed feed — are isolated", async () => {
  const db = new FakeDb();
  db.sources = [
    src(1, "slow"), src(2, "flaky"), src(3, "same", { etag: '"e"' }), src(4, "blocked"), src(5, "broken"), src(6, "gone", { consecutive_failures: 2 }),
  ];
  const good = rss([{ t: "خبر من مصدر متقطع", l: "https://flaky.example/1" }]);
  const { f, calls } = mockFetch({
    "https://slow.example/rss": (_u, init) => new Promise((_, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))),
    "https://flaky.example/rss": [() => new Response("busy", { status: 503 }), () => new Response(good)],
    "https://same.example/rss": () => new Response(null, { status: 304 }),
    "https://blocked.example/robots.txt": () => new Response("User-agent: *\nDisallow: /"),
    "https://broken.example/rss": () => new Response("<html>Maintenance</html>"),
    "https://gone.example/rss": () => new Response("gone", { status: 410 }),
  });
  // Speed up the timeout path by using fake timers: replace setTimeout-based abort with immediate abort
  const origSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((fn: () => void, ms?: number) => origSetTimeout(fn, ms && ms > 5000 ? 5 : ms)) as typeof setTimeout;
  try {
    const r = await runIngest({ fetch: f, db, ai: noAI, now: () => NOW, sleep });
    const rec = (id: number) => db.fetches.find((x) => x.source_id === id)!;
    assert(String(rec(1).error).startsWith("timeout"), "timeout recorded");
    assertEquals(rec(1).status, "error");
    assertEquals(rec(2).status, "ok");
    assertEquals(rec(2).attempts, 2);
    assertEquals(rec(3).status, "not_modified");
    assertEquals(calls.find((c) => c.url === "https://same.example/rss")?.headers["if-none-match"], '"e"');
    assertEquals(rec(4).status, "blocked");
    assertEquals(calls.some((c) => c.url === "https://blocked.example/rss"), false); // never fetched
    assert(String(rec(5).error).startsWith("parse error"));
    assertEquals(rec(6).attempts, 1); // 410 is not transient: no retry
    // backoff: 3rd consecutive failure of a 5-minute source => 40 minutes (+ <20s jitter)
    const delayMin = (Date.parse(rec(6).next_fetch_at as string) - NOW.getTime()) / 60000;
    assert(delayMin >= 40 && delayMin < 40.4, `backoff ${delayMin}`);
    assertEquals(r.status, "partial");
    assertEquals(db.articles.length, 1);
  } finally {
    globalThis.setTimeout = origSetTimeout;
  }
});

Deno.test("pipeline: overlapping run is skipped; DB failure is recorded and run is closed", async () => {
  const db = new FakeDb();
  db.active = true;
  const r = await runIngest({ fetch: fetch, db, ai: noAI, now: () => NOW, sleep });
  assertEquals((r as { skipped?: boolean }).skipped, true);
  db.active = false;
  db.failInsert = true;
  db.sources = [src(1, "alpha")];
  const { f } = mockFetch({ "https://alpha.example/rss": () => new Response(rss([{ t: "خبر تجريبي للاختبار", l: "https://alpha.example/1" }])) });
  const r2 = await runIngest({ fetch: f, db, ai: noAI, now: () => NOW, sleep });
  assertEquals(r2.status, "error");
  assertEquals(db.finished.at(-1)?.status, "error");
});

Deno.test("pipeline: future-dated items are clamped; https thumbnails are stored (display gated per source)", async () => {
  const db = new FakeDb();
  db.sources = [src(1, "alpha", { allow_images: false }), src(2, "beta", { allow_images: true })];
  const withImg = (host: string) => `<rss xmlns:media="http://search.yahoo.com/mrss/"><channel><item><title>خبر بصورة من ${host}</title><link>https://${host}.example/p</link><pubDate>Sun, 18 Oct 2026 09:00:00 GMT</pubDate><media:content url="https://img.example/${host}.jpg" medium="image"/></item></channel></rss>`;
  const { f } = mockFetch({ "https://alpha.example/rss": () => new Response(withImg("alpha")), "https://beta.example/rss": () => new Response(withImg("beta")) });
  await runIngest({ fetch: f, db, ai: noAI, now: () => NOW, sleep });
  const a = db.articles.find((x) => x.source_id === 1)!;
  const b = db.articles.find((x) => x.source_id === 2)!;
  assertEquals(a.image_url, "https://img.example/alpha.jpg");
  assertEquals(b.image_url, "https://img.example/beta.jpg");
  assertEquals(a.published_at, NOW.toISOString());
  assertEquals(a.published_estimated, true);
});

Deno.test("pipeline: AI translation path with validation (mocked provider)", async () => {
  const db = new FakeDb();
  db.sources = [src(1, "en", { language: "en" })];
  const ai = aiConfigFromEnv((k) => ({ AI_PROVIDER: "anthropic", AI_API_KEY: "test" } as Record<string, string>)[k]);
  const { f } = mockFetch({
    "https://en.example/rss": () => new Response(rss([{ t: "Jordan opens new solar plant", l: "https://en.example/1", d: "The plant produces power." }])),
  });
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ content: [{ text: '{"title":"الأردن يفتتح محطة طاقة شمسية جديدة","summary":"المحطة تنتج الكهرباء."}' }] }))) as typeof fetch;
  try {
    await runIngest({ fetch: f, db, ai, now: () => NOW, sleep });
  } finally { globalThis.fetch = origFetch; }
  const art = db.articles[0];
  assertEquals(art.title, "الأردن يفتتح محطة طاقة شمسية جديدة");
  assertEquals(art.title_original, "Jordan opens new solar plant");
  assertEquals(art.translated, true);
  assertEquals(art.summary_kind, "ai");
});

Deno.test("pipeline: existing articles get a thumbnail later, never overwritten", async () => {
  const db = new FakeDb();
  db.sources = [src(1, "alpha")];
  const item = (img?: string) => `<rss xmlns:media="http://search.yahoo.com/mrss/"><channel><item><title>خبر يحصل على صورة لاحقاً</title><link>https://alpha.example/p</link>${img ? `<media:content url="${img}" medium="image"/>` : ""}</item></channel></rss>`;
  const run = async (body: string) => { const { f } = mockFetch({ "https://alpha.example/rss": () => new Response(body) }); await runIngest({ fetch: f, db, ai: noAI, now: () => NOW, sleep }); };
  await run(item());
  assertEquals(db.articles[0].image_url, null);
  await run(item("https://img.example/1.jpg"));
  assertEquals(db.articles[0].image_url, "https://img.example/1.jpg");
  await run(item("https://img.example/2.jpg"));
  assertEquals(db.articles[0].image_url, "https://img.example/1.jpg");
  assertEquals(db.articles.length, 1);
});

Deno.test("bestExcerpt: prefers longer publisher content, strips repeated headline, caps length", async () => {
  const { bestExcerpt, EXCERPT_MAX } = await import("../lib/pipeline.ts");
  const base = { guid: "g", url: "https://x/1", publishedAt: null, image: null, categories: [] };
  const long = "الفقرة الأولى من الخبر. ".repeat(60);
  const e1 = bestExcerpt({ ...base, title: "عنوان الخبر", description: "وصف قصير", content: "عنوان الخبر: " + long });
  assert(e1.startsWith("الفقرة الأولى"), "headline removed");
  assert(e1.length <= EXCERPT_MAX + 1 && e1.endsWith("…"), "capped at excerpt length");
  assertEquals(bestExcerpt({ ...base, title: "ع", description: "وصف جيد كاف", content: "" }), "وصف جيد كاف");
  assertEquals(bestExcerpt({ ...base, title: "نفس", description: "نفس", content: "" }), "");
});

Deno.test("pipeline: existing article gets a longer excerpt later", async () => {
  const db = new FakeDb();
  db.sources = [src(1, "alpha")];
  const feed = (d: string, c = "") => `<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><title>خبر يتوسع لاحقاً</title><link>https://alpha.example/q</link><description>${d}</description>${c ? `<content:encoded><![CDATA[<p>${c}</p>]]></content:encoded>` : ""}</item></channel></rss>`;
  const run = async (body: string) => { const { f } = mockFetch({ "https://alpha.example/rss": () => new Response(body) }); await runIngest({ fetch: f, db, ai: noAI, now: () => NOW, sleep }); };
  await run(feed("وصف قصير جداً"));
  assertEquals(db.articles[0].summary, "وصف قصير جداً");
  await run(feed("وصف قصير جداً", "نص أطول بكثير يوفره الناشر في خلاصته ويضم تفاصيل إضافية مفيدة للقارئ حول الحدث."));
  assert(String(db.articles[0].summary).startsWith("نص أطول"), "longer excerpt applied");
});
