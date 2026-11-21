// Global intelligence page (intel.html) with a mocked Supabase backend (no network needed).
// Usage: CHROME=/path/to/chrome node tests/ui/intel-smoke.mjs <absolute-site-dir> <out-dir>
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const [siteDir, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const API = "https://test.supabase.co";
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const f = path.join(siteDir, p);
  if (!f.startsWith(siteDir) || !fs.existsSync(f)) { res.writeHead(404); return res.end("nf"); }
  const type = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" }[path.extname(f)] || "application/octet-stream";
  let body = fs.readFileSync(f);
  if (p.endsWith("config.js")) body = Buffer.from(String(body).replace(/export const SUPABASE_URL = ".*";/, `export const SUPABASE_URL = "${API}";`));
  res.writeHead(200, { "content-type": type }); res.end(body);
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const iso = (m) => new Date(Date.now() - m * 60000).toISOString();

const channels = [
  { channel_id: "UC0p5jTq6Xx_DosDFxVXnWaQ", name_ar: "ذي إيكونوميست", name_en: "The Economist", tier: 5, section: "economy" },
  { channel_id: "UCfiwzLy-8yKzIbsmZTzxDgw", name_ar: "الجزيرة", name_en: "Al Jazeera Arabic", tier: 4, section: "politics" },
];
const videos = [
  { video_id: "AAAAAAAAAA1", channel_id: channels[0].channel_id, title: "Why the summit matters | The Economist", title_ar: "لماذا تهم القمة", language: "en", section: "economy",
    published_at: iso(300), thumbnail: "https://i1.ytimg.com/vi/AAAAAAAAAA1/hqdefault.jpg", views: 70000, likes: 2000, vph: 10000, velocity_ratio: 3.2, popularity: 71, editorial: 80,
    score_parts: { velocity: 25, growth: 20, engagement: 18, cross: 15, source: 35, subject: 20, coverage: 10, format: 15, measured: true, eng_pct: 2.86 },
    related_article_id: 42, related_publishers: 4, trend_match: "summit" },
  { video_id: "AAAAAAAAAA2", channel_id: channels[1].channel_id, title: "غارات جديدة: تحليل للوضع الميداني", title_ar: null, language: "ar", section: "war",
    published_at: iso(90), thumbnail: null, views: 12000, likes: null, vph: 8000, velocity_ratio: null, popularity: 40, editorial: 71,
    score_parts: { measured: false }, related_article_id: null, related_publishers: 0, trend_match: null },
];
const trends = [
  { key: "summit", term: "summit", term_ar: "القمة", term_is_ar: false, geos: ["EG", "JO", "SA"], n_countries: 3, traffic_max: 5000, news_hits: 5, news_publishers: 4, video_hits: 1,
    platforms: 3, is_global: true, category: "politics", score: 78, prev_score: 70, direction: "up", google_news: [{ t: "Summit news", u: "https://example.com/s", s: "Ex" }],
    article_ids: [42], video_ids: ["AAAAAAAAAA1"], first_seen_at: iso(120), last_seen_at: iso(5), updated_at: iso(3) },
  { key: "local fair", term: "local fair", term_ar: null, term_is_ar: false, geos: ["JO"], n_countries: 1, traffic_max: 100, news_hits: 0, news_publishers: 0, video_hits: 0,
    platforms: 1, is_global: false, category: null, score: 12, prev_score: null, direction: "new", google_news: [], article_ids: [], video_ids: [], first_seen_at: iso(30), last_seen_at: iso(5), updated_at: iso(3) },
];
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log("FAIL", m); } else console.log("ok  ", m); };
const seen = [];

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
async function open(url, { lang, width = 390, stale = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: "Asia/Amman" });
  if (lang) await ctx.addInitScript((l) => localStorage.setItem("nabd-lang", l), lang);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const json = (route, b) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b), headers: { "access-control-allow-origin": "*" } });
  await page.route("https://fonts.googleapis.com/**", (r) => r.abort());
  await page.route("https://i1.ytimg.com/**", (r) => r.fulfill({ status: 200, contentType: "image/svg+xml", body: "<svg xmlns='http://www.w3.org/2000/svg' width='16' height='9'/>" }));
  await page.route("https://www.youtube-nocookie.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<p>player</p>" }));
  await page.route(`${API}/**`, (route) => {
    const u = new URL(route.request().url());
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    seen.push(u.pathname + u.search);
    if (u.pathname === "/rest/v1/intel_yt_channels") return json(route, u.searchParams.get("select") === "last_ok_at" ? [{ last_ok_at: stale ? iso(300) : iso(4) }] : channels);
    if (u.pathname === "/rest/v1/intel_yt_videos") {
      const sec = u.searchParams.get("section");
      return json(route, videos.filter((v) => !sec || sec === `eq.${v.section}`));
    }
    if (u.pathname === "/rest/v1/intel_trends") return json(route, u.searchParams.get("select") === "updated_at" ? [{ updated_at: iso(3) }] : trends);
    if (u.pathname === "/rest/v1/news_trend_geos") return json(route, [{ last_ok_at: iso(2) }]);
    if (u.pathname === "/rest/v1/rpc/news_site_status") return json(route, { last_run_at: stale ? iso(400) : iso(1) });
    return json(route, []);
  });
  await page.goto(base + url);
  return { page, ctx, errors };
}
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

{ // Arabic, phone
  const { page, ctx, errors } = await open("/intel.html");
  await page.waitForSelector(".in-video");
  await page.waitForSelector(".in-trend h3");
  ok(await page.locator("h1").innerText() === "مركز لحظة للذكاء والتحليل العالمي", "page title in Arabic");
  ok((await page.locator(".in-trend").count()) === 2, "two trends listed");
  ok((await page.locator(".in-trend").first().innerText()).includes("عالمي") && (await page.locator(".in-trend").first().innerText()).includes("القمة"), "global trend shown with its Arabic name");
  ok((await page.locator(".in-trend").first().innerText()).includes("الكلمة الأصلية: summit"), "original keyword shown");
  ok((await page.locator(".in-trend").nth(1).innerText()).includes("محلي/إقليمي"), "single-country trend is not called global");
  ok((await page.locator(".in-video").count()) === 2, "two videos in global trending");
  const v1 = page.locator(".in-video").first();
  ok((await v1.locator("h3").innerText()) === "لماذا تهم القمة", "translated title shown first");
  await v1.getByRole("button", { name: "عرض العنوان الأصلي" }).click();
  ok((await v1.locator("h3").innerText()).startsWith("Why the summit matters"), "original title on request");
  ok((await v1.innerText()).includes("أسرع 3.2×") && (await v1.innerText()).includes("«summit»"), "why it is trending: velocity and trend match");
  ok((await v1.locator(".in-score.pop b").innerText()) === "71" && (await v1.locator(".in-score.edt b").innerText()) === "80", "two separate scores");
  ok((await v1.locator(".in-score.edt").getAttribute("title")).includes("موثوقية القناة: 35/35"), "editorial breakdown in tooltip");
  ok((await v1.getByRole("link", { name: "المصدر الأصلي ↗" }).getAttribute("href")) === "https://www.youtube.com/watch?v=AAAAAAAAAA1", "original source link");
  ok((await v1.getByRole("link", { name: "اقرأ التغطية الكاملة" }).getAttribute("href")) === "article.html?id=42", "full coverage link");
  ok((await page.locator(".in-video").nth(1).innerText()).includes("(متوسط منذ النشر)"), "unmeasured velocity is labelled as an average");
  await v1.locator(".in-play").click();
  ok((await v1.locator("iframe").getAttribute("src")).startsWith("https://www.youtube-nocookie.com/embed/AAAAAAAAAA1"), "plays in the privacy-enhanced embed");
  await page.locator(".in-video").nth(1).locator(".in-play").click();
  ok((await page.locator(".in-videos iframe").count()) === 1, "only one player at a time");
  ok((await page.locator(".in-pill[data-state=live]").count()) === 4, "all four feeds live when fresh");
  await page.getByRole("button", { name: "الحروب والأمن" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".in-video").length === 1);
  ok(seen.some((s) => s.includes("section=eq.war")), "section tab queries that section");
  ok(new URL(page.url()).searchParams.get("s") === "war", "section kept in the address");
  await page.getByRole("button", { name: "الأهم تحريرياً" }).click();
  await page.waitForTimeout(300);
  ok(seen.some((s) => s.includes("order=editorial.desc")), "sort by editorial importance");
  ok(await page.locator('nav a[href="intel.html"]').count() >= 1, "navigation links to the page");
  ok(await noOverflow(page), "no horizontal overflow on a phone");
  await page.screenshot({ path: path.join(outDir, "intel-ar-390.png"), fullPage: true });
  ok(errors.length === 0, "no console errors " + errors.join(" | "));
  await ctx.close();
}
{ // stale data → never LIVE
  const { page, ctx } = await open("/intel.html", { stale: true });
  await page.waitForSelector(".in-pill");
  await page.waitForFunction(() => document.querySelectorAll(".in-pill").length === 4);
  ok((await page.locator('.in-pill[data-state="stale"]').count()) === 2, "stale news and YouTube are shown as delayed");
  ok((await page.locator(".in-status").innerText()).includes("متأخر"), "delayed label in Arabic");
  await ctx.close();
}
{ // English, desktop
  const { page, ctx, errors } = await open("/intel.html?s=economy&sort=views&h=6", { lang: "en", width: 1280 });
  await page.waitForSelector(".in-video");
  ok((await page.locator("h1").innerText()) === "Lahza Global Intelligence", "English title");
  ok((await page.locator(".in-video h3").first().innerText()).startsWith("Why the summit matters"), "English edition shows the original title");
  ok(seen.some((s) => s.includes("order=views.desc")), "sort from the address");
  ok(await noOverflow(page), "no horizontal overflow on desktop");
  await page.screenshot({ path: path.join(outDir, "intel-en-1280.png"), fullPage: true });
  ok(errors.length === 0, "no console errors (en) " + errors.join(" | "));
  await ctx.close();
}
await browser.close(); server.close();
console.log(failures ? `${failures} FAILED` : "all passed");
process.exit(failures ? 1 : 0);
