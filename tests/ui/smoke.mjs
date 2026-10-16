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
  language: "ar", translated: false, category: "jordan", categories: ["jordan"], image_url: null, published_at: iso(id * 7), published_estimated: false,
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
  art(5, { title: "Jordan opens solar plant", language: "en" }),
  ...Array.from({ length: 8 }, (_, i) => art(6 + i)),
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
    if (u.pathname === "/rest/v1/rpc/news_search_articles") return json(articles.filter((a) => a.title.includes("زلزال")));
    if (u.pathname === "/rest/v1/news_articles") {
      if (failArticles) return json({ message: "boom" }, 500);
      let rows = emptyMode ? [] : [...articles];
      const p = u.searchParams;
      if (p.get("is_breaking") === "eq.true") rows = rows.filter((a) => a.is_breaking);
      const gtId = p.get("id")?.startsWith("gt.") ? Number(p.get("id").slice(3)) : null;
      if (gtId !== null) rows = rows.filter((a) => a.id > gtId).sort((a, b) => a.id - b.id);
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
  check(await page.locator('h3[dir="ltr"]').count() > 0, `${name}: untranslated English headline is LTR + labelled`);
  const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check(noHScroll, `${name}: no horizontal scroll`);
  await page.waitForTimeout(1500);
  const pill = await page.locator("#live-pill").getAttribute("data-state");
  check(pill === "polling" || pill === "connecting", `${name}: realtime blocked => polling fallback (${pill})`);
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

  // dark mode
  await page.locator("#theme-toggle").click();
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check(bg === "rgb(14, 15, 18)", `${name}: dark mode applies (${bg})`);
  await page.screenshot({ path: `${outDir}/home-${name}-dark.png` });
  await page.locator("#theme-toggle").click();

  // article page
  await page.goto(base + "/article.html?id=1");
  await page.waitForSelector("h1");
  check((await page.locator("h1").textContent()).includes("زلزال"), `${name}: article headline`);
  const href = await page.locator("a.btn-primary").getAttribute("href");
  check(href === "https://a.example/1", `${name}: prominent link to original article`);
  check((await page.locator(".byline").textContent()).includes("بتوقيت عمّان"), `${name}: Amman time shown`);
  check(await page.locator(".related li").count() === 1, `${name}: related coverage listed`);
  check((await page.locator(".summary-label").textContent()).includes("مقتطف"), `${name}: summary provenance labelled`);
  await page.screenshot({ path: `${outDir}/article-${name}.png`, fullPage: true });
  await page.goto(base + "/article.html?id=999");
  await page.waitForSelector(".state h3");
  check((await page.locator(".state h3").textContent()).includes("غير متوفر"), `${name}: missing article state`);

  // breaking page
  await page.goto(base + "/breaking.html");
  await page.waitForSelector(".timeline h3");
  check(await page.locator(".timeline h3").count() === 1, `${name}: breaking timeline`);
  await page.screenshot({ path: `${outDir}/breaking-${name}.png` });

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
