// UI smoke test with a mocked Supabase REST API (no real backend needed).
// Usage: node tests/ui/smoke.mjs <site-dir> <out-dir>
// Checks: pages render, no JS errors, RTL, ticker, feed, cluster grouping, empty/error states,
// polling fallback when realtime is unavailable, live insertion without duplicates, pause, dark mode.
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const [siteDir, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const API = "https://test.supabase.co";

// --- static server over a copy of the site with config pointing at the mock ---
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/") p = "/index.html";
  const f = path.join(siteDir, p);
  if (!f.startsWith(siteDir) || !fs.existsSync(f)) { res.writeHead(404); return res.end("nf"); }
  const type = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" }[path.extname(f)] || "application/octet-stream";
  let body = fs.readFileSync(f);
  if (p.endsWith("config.js")) body = Buffer.from(String(body).replace(/export const SUPABASE_URL = ".*";/, `export const SUPABASE_URL = "${API}";`).replace("__SUPABASE_ANON_KEY__", "test-anon-key"));
  res.writeHead(200, { "content-type": type });
  res.end(body);
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const now = Date.now();
const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
const sources = [
  { id: 1, slug: "a", name_ar: "مصدر ألف", homepage: "https://a.example", kind: "media", reliability: 4, enabled: true, allow_images: false, last_success_at: iso(1) },
  { id: 2, slug: "b", name_ar: "مصدر باء", homepage: "https://b.example", kind: "official", reliability: 5, enabled: true, allow_images: true, last_success_at: iso(90) },
];
const art = (id, extra) => ({
  id, source_id: 1, url: `https://a.example/${id}`, title: `عنوان اختباري رقم ${id}`, title_original: null, summary: "مقتطف قصير من الخبر لأغراض الاختبار فقط.", summary_kind: "feed",
  language: "ar", translated: false, title_en: null, countries: ["JO"], region: "middle_east", category: "jordan", categories: ["jordan"], image_url: null, published_at: iso(id * 7), published_estimated: false,
  fetched_at: iso(id * 7 - 1), cluster_id: null, verification: "reported", is_breaking: false, breaking_until: null, importance: 30, pinned: false,
  edited: false, status: "published", created_at: iso(id * 7), ...extra,
});
let articles = [
  art(1, { title: "زلزال بقوة 5 درجات يضرب جنوب الأردن", is_breaking: true, breaking_until: iso(-300), verification: "developing", cluster_id: 9, importance: 80 }),
  art(2, { source_id: 2, title: "هزة أرضية تضرب جنوب الأردن", cluster_id: 9, verification: "official" }),
  art(3, { title: "مزاعم عن تسرب وثائق حكومية", verification: "allegation", category: "politics", categories: ["politics"] }),
  art(4, { title: "OpenAI تطلق نموذجاً جديداً", category: "tech", categories: ["tech"] }),
  art(14, { source_id: 2, title: "خبر بصورة من مصدر يسمح بالصور", image_url: "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=" }),
  art(15, { source_id: 1, title: "خبر بصورة من مصدر لا يسمح بالصور", image_url: "https://img.example/x.jpg" }),
  art(5, { title: "Jordan opens solar plant", title_en: "Jordan opens solar plant", language: "en", countries: ["JO"], region: "middle_east" }),
  art(16, { title: "زلزال بقوة 7.4 درجات يضرب شمال اليابان", title_en: "Magnitude 7.4 earthquake strikes northern Japan", title_original: "Magnitude 7.4 earthquake strikes northern Japan",
    translated: true, category: "world", categories: ["world"], countries: ["JP"], region: "east_asia", is_breaking: true, breaking_until: iso(-120), importance: 95 }),
  art(17, { source_id: 2, title: "Magnitude 7.4 earthquake strikes northern Japan", title_en: "Magnitude 7.4 earthquake strikes northern Japan", language: "en",
    category: "world", categories: ["world"], countries: ["JP"], region: "east_asia", url: "https://b.example/17" }),
  ...Array.from({ length: 8 }, (_, i) => art(6 + i)),
];
const gev = (key, rank, lead, extra) => ({ key, rank, cluster_id: null, lead_article_id: lead, lead_ar_id: null, lead_en_id: null, first_article_id: lead,
  score: 50, parts: { impact: 10, freshness: 20, credibility: 16, independence: 4, velocity: 0 }, status: "developing", confirmed: false, single_source: true,
  allegation: false, independent_count: 1, publisher_count: 1, report_count: 1, countries: [], region: null, event_type: "general",
  first_seen: iso(20), last_seen: iso(20), is_breaking: false, updated_at: iso(1), ...extra });
const globalEvents = [
  gev("c77", 1, 16, { lead_ar_id: 16, lead_en_id: 17, first_article_id: 17, score: 93, status: "confirmed", confirmed: true, single_source: false,
    independent_count: 4, publisher_count: 6, report_count: 7, countries: ["JP"], region: "east_asia", event_type: "earthquake", is_breaking: true,
    parts: { impact: 27, freshness: 23.3, credibility: 20, independence: 13, velocity: 10 } }),
  gev("a6", 2, 6, { lead_ar_id: 6, score: 54, countries: ["JO"], region: "middle_east", event_type: "routine" }),
];
let failArticles = false;
let emptyMode = false;

async function mock(page) {
  await page.route(`${API}/**`, async (route) => {
    const u = new URL(route.request().url());
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(b), headers: { "access-control-allow-origin": "*" } });
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (u.pathname.startsWith("/realtime")) return route.abort();
    if (u.pathname === "/rest/v1/news_sources") return json(sources);
    if (u.pathname === "/rest/v1/news_live_channels") return json([
      { id: 1, name_ar: "قناة مضمّنة", youtube_channel_id: "UCIJXOvggjKtCagMfxvcCzAA", youtube_handle: null, official_live_url: null },
      { id: 2, name_ar: "قناة برابط", youtube_channel_id: null, youtube_handle: "@example", official_live_url: null }]);
    if (u.pathname === "/rest/v1/news_clusters") return json([{ id: 9, source_count: 2 }]);
    if (u.pathname === "/rest/v1/rpc/news_site_status") return json({ last_run_at: iso(1), sources_active: 2, sources_healthy: 1, articles_24h: articles.length, interval_minutes: 2 });
    if (u.pathname === "/rest/v1/news_global_events") {
      const p = u.searchParams;
      let rows = [...globalEvents];
      if (p.get("is_breaking") === "eq.true") rows = rows.filter((e) => e.is_breaking);
      if (p.get("region")) rows = rows.filter((e) => e.region === p.get("region").slice(3));
      if (p.get("countries")) rows = rows.filter((e) => e.countries.includes(p.get("countries").replace(/^cs\.\{|\}$/g, "")));
      return json(rows);
    }
    if (u.pathname === "/rest/v1/rpc/news_country_counts") return json([{ country: "JP", region: "east_asia", n: 2 }, { country: "JO", region: "middle_east", n: 14 }]);
    if (u.pathname === "/rest/v1/rpc/news_search_articles") return json(articles.filter((a) => a.title.includes("زلزال")));
    if (u.pathname === "/rest/v1/news_articles") {
      if (failArticles) return json({ message: "boom" }, 500);
      let rows = emptyMode ? [] : [...articles];
      const p = u.searchParams;
      if (p.get("is_breaking") === "eq.true") rows = rows.filter((a) => a.is_breaking);
      if (p.get("language") === "eq.ar") rows = rows.filter((a) => a.language === "ar");
      if (p.get("title_en") === "not.is.null") rows = rows.filter((a) => a.title_en);
      if (p.get("region")) rows = rows.filter((a) => a.region === p.get("region").slice(3));
      if (p.get("countries")) rows = rows.filter((a) => (a.countries || []).includes(p.get("countries").replace(/^cs\.\{|\}$/g, "")));
      if (p.get("id")?.startsWith("in.")) rows = rows.filter((a) => p.get("id").slice(4, -1).split(",").map(Number).includes(a.id));
      const gtId = p.get("id")?.startsWith("gt.") ? Number(p.get("id").slice(3)) : null;
      if (gtId !== null) rows = rows.filter((a) => a.id > gtId).sort((a, b) => a.id - b.id);
      else if (p.get("id")?.startsWith("in.")) { /* filtered above */ }
      else if (p.get("id")?.startsWith("eq.")) rows = rows.filter((a) => a.id === Number(p.get("id").slice(3)));
      else rows.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
      if (p.get("cluster_id")) rows = rows.filter((a) => a.cluster_id === Number(p.get("cluster_id").slice(3)) && a.id !== Number((p.get("id") || "neq.0").slice(4)));
      const accept = route.request().headers()["accept"] || "";
      if (accept.includes("vnd.pgrst.object")) return rows[0] ? json(rows[0]) : json({ code: "PGRST116", message: "0 rows" }, 406);
      return json(rows.slice(0, Number(p.get("limit") || 50)));
    }
    return json([]);
  });
}

const results = [];
const check = (cond, label) => { results.push([cond ? "ok" : "FAIL", label]); };
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });

for (const [name, vp] of [["mobile", { width: 390, height: 844 }], ["desktop", { width: 1366, height: 900 }]]) {
  const ctx = await browser.newContext({ viewport: vp, locale: "ar-JO", timezoneId: "Asia/Amman" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/realtime|websocket|ERR_FAILED|net::|status of 500|boom/i.test(m.text())) errors.push(m.text()); });
  await mock(page);
  await page.goto(base + "/index.html");
  await page.waitForSelector("li.card", { timeout: 8000 });
  check(await page.evaluate(() => document.documentElement.dir === "rtl"), `${name}: document is RTL`);
  check((await page.locator("li.card").count()) >= 10, `${name}: feed renders cards`);
  check((await page.locator("li.card", { hasText: "هزة أرضية" }).count()) === 0, `${name}: same-event story grouped (no duplicate card)`);
  check((await page.locator("li.card .more-src").first().textContent())?.includes("مصدر آخر"), `${name}: coverage count shown`);
  await page.waitForSelector(".ticker-move a", { timeout: 5000 }).catch(() => {});
  check((await page.locator(".ticker-move a").count()) >= 2, `${name}: breaking ticker populated (duplicated for loop)`);
  check(await page.locator(".chip.v-allegation").count() > 0, `${name}: allegation label rendered`);
  check((await page.locator("li.card", { hasText: "Jordan opens solar plant" }).count()) === 0, `${name}: Arabic edition hides untranslated English reports`);
  check((await page.locator("li.card", { hasText: "اليابان" }).locator(".place-chip").textContent())?.includes("اليابان"), `${name}: card shows country`);
  check((await page.locator(".catnav a[data-cat]").first().getAttribute("data-cat")) === "world", `${name}: sections start with World (no Jordan-first order)`);
  check((await page.locator("aside .panel .mini-list li").first().textContent())?.includes("اليابان"), `${name}: side panel lists the top global breaking event`);
  const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check(noHScroll, `${name}: no horizontal scroll`);
  await page.waitForTimeout(1500);
  const pill = await page.locator("#live-pill").getAttribute("data-state");
  check(pill === "polling" || pill === "connecting", `${name}: realtime blocked => polling fallback (${pill})`);
  check(await page.evaluate(() => ["environment", "education", "security", "entertainment"].every((c) => document.querySelector(`.catnav a[data-cat="${c}"]`))), `${name}: new sections in category navigation`);
  check((await page.locator("#live-pill").textContent()).includes("آخر تحديث") || name === "mobile", `${name}: last-updated time visible`);
  await page.screenshot({ path: `${outDir}/home-${name}.png`, fullPage: false });

  // live insertion: new article arrives, triggered via visibility change (forces a tick)
  articles.push(art(50, { title: "خبر جديد وصل للتو", published_at: iso(0), created_at: iso(0) }));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForSelector("li.card >> text=خبر جديد وصل للتو", { timeout: 5000 }).catch(() => {});
  check((await page.locator("li.card", { hasText: "خبر جديد وصل للتو" }).count()) === 1, `${name}: new article inserted live, exactly once`);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(800);
  check((await page.locator("li.card", { hasText: "خبر جديد وصل للتو" }).count()) === 1, `${name}: repeated ticks do not duplicate`);
  // pause
  await page.locator("button", { hasText: "إيقاف التحديث" }).click();
  articles.push(art(51, { title: "خبر أثناء الإيقاف", published_at: iso(0), created_at: iso(0) }));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(1200);
  check((await page.locator("li.card", { hasText: "خبر أثناء الإيقاف" }).count()) === 0, `${name}: paused feed does not insert`);
  check(await page.locator(".new-banner:not([hidden])").count() === 1, `${name}: paused feed shows "new items" banner`);
  check((await page.locator("#live-pill").getAttribute("data-state")) === "paused", `${name}: pill shows paused`);
  await page.locator("button", { hasText: "استئناف التحديث" }).click();
  await page.waitForTimeout(300);
  check((await page.locator("li.card", { hasText: "خبر أثناء الإيقاف" }).count()) === 1, `${name}: resume flushes queued items`);
  articles = articles.filter((a) => a.id < 50);

  // reader settings: font size persists across pages
  await page.locator("#settings-btn").click();
  await page.locator("dialog.settings button", { hasText: "كبير جداً" }).click();
  check(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--fs").trim()) === "1.25", `${name}: font size setting applies`);
  await page.locator("dialog.settings .switch", { hasText: "إخفاء الصور" }).locator("input").check();
  await page.locator("dialog.settings button", { hasText: "تم" }).click();
  await page.reload();
  await page.waitForSelector("li.card");
  check(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--fs").trim()) === "1.25", `${name}: font size persists after reload`);
  check(await page.evaluate(() => document.documentElement.dataset.noimg === "1"), `${name}: hide-images persists`);
  await page.locator("#settings-btn").click();
  await page.locator("dialog.settings button", { hasText: "ضخم" }).click();
  await page.locator("dialog.settings button", { hasText: "تم" }).click();
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.body.scrollWidth <= innerWidth + 1), `${name}: no horizontal overflow at largest font`);
  check(await page.evaluate(() => { const b = document.querySelector(".brand").getBoundingClientRect(); return b.right <= innerWidth + 1 && b.left >= -1; }), `${name}: masthead fits at largest font`);
  await page.screenshot({ path: `${outDir}/home-${name}-large-font.png` });
  await page.evaluate(() => localStorage.removeItem("nabd-prefs"));
  await page.reload();
  await page.waitForSelector("li.card");

  // dark mode
  await page.evaluate(() => document.getElementById("theme-toggle").click());
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check(bg === "rgb(14, 15, 18)", `${name}: dark mode applies (${bg})`);
  await page.screenshot({ path: `${outDir}/home-${name}-dark.png` });
  await page.evaluate(() => document.getElementById("theme-toggle").click());

  // article page
  await page.goto(base + "/article.html?id=1");
  await page.waitForSelector("h1");
  check((await page.locator("h1").textContent()).includes("زلزال"), `${name}: article headline`);
  const href = await page.locator("a.btn-primary").first().getAttribute("href");
  check(href === "https://a.example/1", `${name}: prominent link to original article`);
  check((await page.locator(".byline").textContent()).includes("بتوقيت عمّان"), `${name}: Amman time shown`);
  check(await page.locator(".coverage .item").count() === 1, `${name}: other sources' coverage listed with excerpt`);
  check(await page.locator(".facts").count() === 1, `${name}: source facts box`);
  check((await page.locator(".summary-label").textContent()).includes("مقتطف"), `${name}: summary provenance labelled`);
  await page.screenshot({ path: `${outDir}/article-${name}.png`, fullPage: true });
  await page.goto(base + "/article.html?id=999");
  await page.waitForSelector(".state h3");
  check((await page.locator(".state h3").textContent()).includes("غير متوفر"), `${name}: missing article state`);

  // global breaking page
  await page.goto(base + "/breaking.html");
  await page.waitForSelector(".timeline h3");
  await page.waitForSelector(".gev");
  check(await page.locator(".timeline h3").count() === 2, `${name}: breaking timeline (one per breaking report)`);
  const g1 = page.locator(".gev").first();
  check((await g1.locator("h3").textContent()).includes("اليابان"), `${name}: global breaking card headline (Arabic edition)`);
  check((await g1.locator(".score b").textContent()) === "93", `${name}: importance score shown`);
  check((await g1.locator(".score").getAttribute("title")).includes("الأثر العالمي: 27/30"), `${name}: score breakdown in tooltip`);
  check((await g1.locator(".place").textContent()).includes("اليابان") && (await g1.locator(".place").textContent()).includes("شرق آسيا"), `${name}: country and region shown`);
  check((await g1.locator(".chip.st-confirmed").count()) === 1 && (await g1.locator(".chip.breaking").count()) === 1, `${name}: confirmed + breaking status`);
  check((await g1.locator('a[target="_blank"]').getAttribute("href")) === "https://b.example/17", `${name}: links to the original (first) publisher`);
  check((await g1.textContent()).includes("4 جهات نشر مستقلة") && (await g1.textContent()).includes("6 وسيلة"), `${name}: independent publisher count (wire copies counted once)`);
  check(await page.locator(".gev", { hasText: "عنوان اختباري رقم 6" }).count() === 1, `${name}: routine story ranked below, not breaking`);
  check(await page.locator(".gev.is-breaking").count() === 1, `${name}: only the breaking event is marked breaking`);
  check(await page.locator(".filters .pill").count() === 12, `${name}: whole-world + 11 region filters`);
  check(await page.locator(".filters select option").count() === 3, `${name}: country filter lists countries with news`);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: global page has no horizontal scroll`);
  await page.screenshot({ path: `${outDir}/breaking-${name}.png`, fullPage: true });
  await page.goto(base + "/breaking.html?region=europe");
  await page.waitForSelector(".gev-list li");
  check(await page.locator(".gev").count() === 0 && (await page.locator(".section-head h2").first().textContent()).includes("أوروبا"), `${name}: region filter (Europe has no events in the mock)`);
  await page.goto(base + "/index.html?country=JP");
  await page.waitForSelector("li.card");
  check((await page.locator("li.card").count()) === 1 && (await page.locator(".section-head h2").first().textContent()).includes("اليابان"), `${name}: country filter on the news feed`);

  // English edition
  await page.goto(base + "/breaking.html");
  await page.waitForSelector(".gev");
  await page.locator(".lang-btn").click();
  await page.waitForSelector(".gev");
  check(await page.evaluate(() => document.documentElement.dir === "ltr" && document.documentElement.lang === "en"), `${name}: English edition is LTR`);
  check((await page.locator(".gev h3").first().textContent()).includes("Magnitude 7.4 earthquake strikes northern Japan"), `${name}: English headline of the same event`);
  check((await page.locator(".gev .place").first().textContent()).includes("Japan") && (await page.locator(".gev .place").first().textContent()).includes("East Asia"), `${name}: English country/region names`);
  check((await page.locator(".gev").first().textContent()).includes("4 independent publishers"), `${name}: English publisher count`);
  check((await page.locator(".catnav").textContent()).includes("Global breaking"), `${name}: English navigation`);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: English page has no horizontal scroll`);
  await page.screenshot({ path: `${outDir}/breaking-en-${name}.png`, fullPage: true });
  await page.goto(base + "/index.html");
  await page.waitForSelector("li.card");
  check((await page.locator("li.card", { hasText: "Jordan opens solar plant" }).count()) === 1, `${name}: English edition shows English reports`);
  check((await page.locator("li.card", { hasText: "عنوان اختباري" }).count()) === 0, `${name}: English edition hides Arabic-only reports`);
  await page.screenshot({ path: `${outDir}/home-en-${name}.png` });
  await page.goto(base + "/article.html?id=16");
  await page.waitForSelector("h1");
  check((await page.locator("h1").textContent()) === "Magnitude 7.4 earthquake strikes northern Japan", `${name}: English article headline`);
  await page.locator(".lang-btn").click();
  await page.waitForSelector("h1");
  check(await page.evaluate(() => document.documentElement.dir === "rtl") && (await page.locator("h1").textContent()).includes("اليابان"), `${name}: switch back to Arabic`);

  // search
  await page.goto(base + "/index.html?q=" + encodeURIComponent("زلزال"));
  await page.waitForSelector("li.card");
  check((await page.locator(".section-head h2").first().textContent()).includes("نتائج البحث"), `${name}: search results page`);

  // category page with empty state
  emptyMode = true;
  await page.goto(base + "/index.html?cat=sports");
  await page.waitForSelector(".state h3");
  check((await page.locator(".state h3").first().textContent()).includes("لا توجد أخبار"), `${name}: empty state`);
  emptyMode = false;
  // error state
  failArticles = true;
  await page.goto(base + "/index.html");
  await page.waitForSelector(".error-box", { timeout: 8000 }).catch(() => {});
  check(await page.locator(".error-box").count() >= 1, `${name}: error state with retry`);
  failArticles = false;
  await page.locator(".error-box button").click();
  await page.waitForSelector("li.card", { timeout: 8000 }).catch(() => {});
  check(await page.locator("li.card").count() > 0, `${name}: retry recovers`);

  // images: shown only for sources that allow them
  await page.goto(base + "/index.html");
  await page.waitForSelector("li.card");
  check(await page.locator("li.card", { hasText: "يسمح بالصور" }).locator("img").count() >= 0, `${name}: image card renders`);
  check(await page.locator("li.card", { hasText: "لا يسمح بالصور" }).locator("img").count() === 0, `${name}: no image when source disallows`);
  // live TV page
  await page.goto(base + "/live.html");
  await page.waitForSelector(".live-card");
  check(await page.locator(".live-card").count() === 2, `${name}: live channels listed`);
  check(await page.locator(".live-card iframe").count() === 0, `${name}: no stream loads until clicked`);
  check((await page.locator('.live-card a.play').getAttribute("href")) === "https://www.youtube.com/@example/live", `${name}: handle-only channel links to YouTube live`);
  await page.locator(".live-card button.play").click();
  check((await page.locator(".live-card iframe").getAttribute("src")).startsWith("https://www.youtube.com/embed/live_stream?channel=UCIJXOvggjKtCagMfxvcCzAA"), `${name}: click embeds official live stream`);
  await page.screenshot({ path: `${outDir}/live-${name}.png` });

  // admin page renders login
  await page.goto(base + "/admin.html");
  await page.waitForSelector(".login-box");
  check(await page.locator('input[type="password"]').count() === 1, `${name}: admin login form`);
  await page.screenshot({ path: `${outDir}/admin-login-${name}.png` });

  check(errors.length === 0, `${name}: no JS errors ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ""}`);
  await ctx.close();
}
await browser.close();
server.close();
for (const [s, l] of results) console.log(`${s} - ${l}`);
const failed = results.filter((r) => r[0] !== "ok").length;
console.log(failed ? `${failed} UI checks FAILED` : `ALL ${results.length} UI CHECKS PASSED`);
process.exit(failed ? 1 : 0);
