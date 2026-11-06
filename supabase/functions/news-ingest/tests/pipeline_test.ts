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
  aiBudget = Infinity;
  aiUsed = 0;
  backoffs: number[] = [];
  async aiTake(n: number) { const g = Math.max(0, Math.min(n, this.aiBudget - this.aiUsed)); this.aiUsed += g; return g; }
  async aiRefund(n: number) { this.aiUsed -= n; }
  async aiBackoff(m: number) { this.backoffs.push(m); }
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
    { t: "عاجل | زلزال بقوة 6.4 درجات يضرب جنوب الأردن", l: "https://alpha.example/n/1?utm_source=rss", d: "أفاد مركز رصد الزلازل بوقوع هزة." },
    { t: "افتتاح معرض عمّان الدولي للكتاب", l: "https://alpha.example/n/2" },
    { t: "خبر قديم جداً", l: "https://alpha.example/n/3", date: "Mon, 12 Oct 2026 08:00:00 GMT" },
  ]);
  const feedB = rss([
    { t: "هزة أرضية بقوة 6.4 درجات تضرب جنوب الأردن", l: "https://beta.example/x/9" },
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
  assertEquals(quakeA.title, "زلزال بقوة 6.4 درجات يضرب جنوب الأردن"); // "عاجل" marker removed from display title
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

Deno.test("pipeline: Hebrew items are translated and reclassified, never published untranslated", async () => {
  const feed = () => new Response(rss([{ t: "דיווח: פיצוץ בבסיס צבאי בצפון", l: "https://he.example/1", d: "פרטים נוספים בהמשך" }]));
  // 1) no AI key -> nothing stored (retried next run)
  const db = new FakeDb();
  db.sources = [src(1, "he", { language: "he" })];
  await runIngest({ fetch: mockFetch({ "https://he.example/rss": feed }).f, db, ai: noAI, now: () => NOW, sleep });
  assertEquals(db.articles.length, 0);
  // 2) with AI -> Arabic title, Hebrew kept only as title_original, no Hebrew excerpt
  const ai = aiConfigFromEnv((k) => ({ AI_PROVIDER: "anthropic", AI_API_KEY: "test" } as Record<string, string>)[k]);
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ content: [{ text: '{"title":"بحسب تقارير: انفجار في قاعدة عسكرية شمالاً","summary":""}' }] }))) as typeof fetch;
  try {
    await runIngest({ fetch: mockFetch({ "https://he.example/rss": feed }).f, db, ai, now: () => NOW, sleep });
  } finally { globalThis.fetch = origFetch; }
  assertEquals(db.articles.length, 1);
  const art = db.articles[0];
  assertEquals(art.title, "بحسب تقارير: انفجار في قاعدة عسكرية شمالاً");
  assertEquals(art.title_original, "דיווח: פיצוץ בבסיס צבאי בצפון");
  assertEquals(art.language, "ar");
  assertEquals(art.summary, null);
});

Deno.test("pipeline: foreign items are translated in ONE batched request; unused quota is refunded", async () => {
  const db = new FakeDb();
  db.sources = [src(1, "he", { language: "he", poll_interval_minutes: 2 })];
  const feed = () => new Response(rss([
    { t: "פיצוץ בבסיס צבאי", l: "https://he.example/1" },
    { t: "גשם כבד בצפון", l: "https://he.example/2" },
    { t: "Old news item", l: "https://he.example/3", date: "Sat, 17 Oct 2026 01:00:00 GMT" }, // 8h old: not worth a request
  ]), { headers: { etag: '"h1"' } });
  const ai = aiConfigFromEnv((k) => ({ AI_PROVIDER: "anthropic", AI_API_KEY: "test" } as Record<string, string>)[k]);
  const origFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async () => {
    requests++;
    return new Response(JSON.stringify({ content: [{ text: '{"items":[{"i":2,"title":"أمطار غزيرة في الشمال","summary":""},{"i":1,"title":"انفجار في قاعدة عسكرية","summary":""}]}' }] }));
  }) as typeof fetch;
  try {
    await runIngest({ fetch: mockFetch({ "https://he.example/rss": feed }).f, db, ai, now: () => NOW, sleep });
  } finally { globalThis.fetch = origFetch; }
  assertEquals(requests, 1);
  assertEquals(db.aiUsed, 1);
  assertEquals(db.articles.map((a) => a.title).sort(), ["أمطار غزيرة في الشمال", "انفجار في قاعدة عسكرية"].sort());
  assertEquals(db.fetches[0].etag, '"h1"'); // everything fresh was translated: keep the ETag
});

Deno.test("pipeline: provider 429 refunds the quota, pauses AI, and forces a full re-fetch next time", async () => {
  const db = new FakeDb();
  db.sources = [src(1, "he", { language: "he" })];
  const feed = () => new Response(rss([{ t: "פיצוץ בבסיס צבאי", l: "https://he.example/1" }]), { headers: { etag: '"h1"' } });
  const ai = aiConfigFromEnv((k) => ({ AI_PROVIDER: "anthropic", AI_API_KEY: "test" } as Record<string, string>)[k]);
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('{"error":"quota"}', { status: 429 })) as typeof fetch;
  try {
    await runIngest({ fetch: mockFetch({ "https://he.example/rss": feed }).f, db, ai, now: () => NOW, sleep });
  } finally { globalThis.fetch = origFetch; }
  assertEquals(db.articles.length, 0);
  assertEquals(db.aiUsed, 0); // refused request is not counted against the daily budget
  assertEquals(db.backoffs.length, 1);
  assertEquals(db.fetches[0].etag, null); // a 304 must not hide the untranslated item
  assertEquals(db.finished[0].ai_calls, 0);
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

Deno.test("pipeline: a fresh major event is breaking in ANY country; old, alleged or routine ones are not", async () => {
  const db = new FakeDb();
  db.sources = [src(1, "alpha", { default_category: "jordan" })];
  const iso = (m: number) => new Date(NOW.getTime() - m * 60000).toUTCString();
  const { f } = mockFetch({ "https://alpha.example/rss": () => new Response(rss([
    { t: "انفجار يقتل 12 شخصا في مصنع بمدينة الزرقاء الأردنية", l: "https://alpha.example/a", date: iso(10) },
    { t: "انفجار يقتل 12 شخصا في مصنع بمدينة ساو باولو البرازيلية", l: "https://alpha.example/a2", date: iso(10) },
    { t: "انفجار يقتل 12 شخصا في مستودع بإربد الأردنية قبل ساعات", l: "https://alpha.example/b", date: iso(120) },
    { t: "أنباء عن انفجار في العقبة الأردنية", l: "https://alpha.example/c", date: iso(5) },
    { t: "عاجل | حريق محدود في مصنع بمدينة الزرقاء الأردنية", l: "https://alpha.example/d", date: iso(5) },
  ])) });
  await runIngest({ fetch: f, db, ai: noAI, now: () => NOW, sleep });
  const by = (u: string) => db.articles.find((a) => String(a.url).endsWith(u))!;
  assertEquals(by("/a").is_breaking, true);
  assertEquals(by("/a2").is_breaking, true, "the same event in Brazil is treated exactly like in Jordan");
  assertEquals(by("/a").importance, by("/a2").importance);
  assertEquals(by("/a").countries, ["JO"]);
  assertEquals(by("/a2").countries, ["BR"]);
  assertEquals(by("/b").is_breaking, false);
  assertEquals(by("/c").is_breaking, false);
  assertEquals(by("/d").is_breaking, false, "a publisher's «عاجل» label on a minor story is not enough");
});

/* ---------- 2026-11-06: global edition ---------- */
class GlobalDb extends FakeDb {
  saved: Record<string, unknown>[] = [];
  async recentSignatures() {
    return this.articles.filter((a) => !a.dup_of && a.event_type && !["general", "routine", "government"].includes(a.event_type as string))
      .map((a) => ({ article_id: a.id as number, cluster_id: (a.cluster_id as number) ?? null, source_id: a.source_id as number, language: a.language as string,
        countries: a.countries as string[], event_type: a.event_type as string, title: (a.title_en as string) ?? (a.title as string), published_at: a.published_at as string }));
  }
  async rankInput() {
    return this.articles.filter((a) => !a.dup_of).map((a) => ({
      id: a.id as number, cluster_id: (a.match_id as number) ?? (a.group_key ? Number(String(a.group_key).replace(/\D/g, "")) + 1000 : null),
      source_id: a.source_id as number, publisher: `p${a.source_id}`, reliability: 4, official: false, published_at: a.published_at as string,
      language: a.language as string, title: a.title as string, title_en: (a.title_en as string) ?? null, summary: null,
      countries: a.countries as string[], event_type: a.event_type as string, impact: a.impact as number, wire: (a.wire as string) ?? null,
      verification: a.verification as string, title_tokens: a.title_tokens as string[],
    }));
  }
  async saveRanking(events: Record<string, unknown>[]) { this.saved = events; return events.length; }
}

Deno.test("pipeline: English reports are kept in English, tagged with country/region/event, and ranked globally", async () => {
  const db = new GlobalDb();
  db.sources = [src(1, "bbc", { language: "en", reliability: 5 }), src(2, "jo", { country: "JO", national: true, reliability: 3 })];
  const iso = (m: number) => new Date(NOW.getTime() - m * 60000).toUTCString();
  const { f } = mockFetch({
    "https://bbc.example/rss": () => new Response(rss([{ t: "Magnitude 7.4 earthquake strikes northern Japan", l: "https://bbc.example/q", date: iso(8) }])),
    "https://jo.example/rss": () => new Response(rss([
      { t: "زلزال بقوة 7.4 درجات يضرب شمال اليابان", l: "https://jo.example/q", date: iso(5) },
      { t: "البلدية تعلن إغلاق طريق للصيانة", l: "https://jo.example/r", date: iso(2) },
    ])),
  });
  const r = await runIngest({ fetch: f, db, ai: noAI, now: () => NOW, sleep });
  const en = db.articles.find((a) => a.url === "https://bbc.example/q")!;
  assertEquals(en.language, "en");
  assertEquals(en.title_en, "Magnitude 7.4 earthquake strikes northern Japan");
  assertEquals(en.countries, ["JP"]);
  assertEquals(en.region, "east_asia");
  assertEquals(en.event_type, "earthquake");
  const ar = db.articles.find((a) => a.url === "https://jo.example/q")!;
  assert(ar.group_key && ar.group_key === en.group_key, "Arabic and English reports of the quake are one event");
  const road = db.articles.find((a) => a.url === "https://jo.example/r")!;
  assertEquals(road.countries, ["JO"], "national outlet: an untagged local story is about its own country");
  assertEquals(road.is_breaking, false);
  assert((r as Record<string, unknown>).events_ranked as number >= 2);
  assertEquals(db.saved[0].countries, ["JP"], "the quake ranks first, above the fresher local story");
  assertEquals(db.saved[0].is_breaking, true);
  assert(!db.saved.find((e) => (e.countries as string[])[0] === "JO")!.is_breaking);
});

Deno.test("pipeline: an English report joins an earlier Arabic report of the same event (cross-language match)", async () => {
  const db = new GlobalDb();
  db.sources = [src(2, "aj", { reliability: 4 })];
  const iso = (m: number) => new Date(NOW.getTime() - m * 60000).toUTCString();
  const { f } = mockFetch({ "https://aj.example/rss": () => new Response(rss([{ t: "انقلاب عسكري في الغابون والجيش يعلن السيطرة على السلطة", l: "https://aj.example/1", date: iso(20) }])) });
  await runIngest({ fetch: f, db, ai: noAI, now: () => NOW, sleep });
  db.sources = [src(3, "dw", { language: "en", reliability: 4 })];
  const { f: f2 } = mockFetch({ "https://dw.example/rss": () => new Response(rss([{ t: "Gabon army officers announce coup, seize power", l: "https://dw.example/1", date: iso(10) }])) });
  await runIngest({ fetch: f2, db, ai: noAI, now: () => NOW, sleep });
  const en = db.articles.find((a) => a.url === "https://dw.example/1")!;
  assertEquals(en.match_id, 1, "matched to the Arabic report");
});
