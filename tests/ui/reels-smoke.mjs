// Reels UI test with mocked Supabase and a stubbed YouTube embed (no network needed).
// Usage: CHROME=/path/to/chrome node tests/ui/reels-smoke.mjs <site-dir> <out-dir>
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const [siteDir, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const API = "https://test.supabase.co";
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const f = path.join(siteDir, p);
  if (!f.startsWith(siteDir) || !fs.existsSync(f)) { res.writeHead(404); return res.end("nf"); }
  const type = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" }[path.extname(f)] || "application/octet-stream";
  let body = fs.readFileSync(f);
  if (p.endsWith("config.js")) body = Buffer.from(String(body).replace(/export const SUPABASE_URL = ".*";/, `export const SUPABASE_URL = "${API}";`));
  res.writeHead(200, { "content-type": type }); res.end(body);
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const now = Date.now();
const iso = (m) => new Date(now - m * 60000).toISOString();
const channels = [
  { channel_id: "UCfiwzLy-8yKzIbsmZTzxDgw", name_ar: "الجزيرة", name_en: "Al Jazeera Arabic", kind: "news", language: "ar" },
  { channel_id: "UCpcTrCXblq78GZrTUTLWeBw", name_ar: "فيفا", name_en: "FIFA", kind: "sports", language: "en" },
];
const vid = (i, extra) => ({ video_id: ("vid" + String(i).padStart(8, "0")).slice(0, 11), channel_id: channels[0].channel_id, title: `عنوان فيديو رقم ${i}`, caption: "وصف قصير من الناشر.",
  published_at: iso(i * 5), thumbnail: null, kind: "news", language: "ar", related_article_id: i === 1 ? 77 : null, ...extra });
let videos = [...Array.from({ length: 20 }, (_, i) => vid(i + 1)), vid(30, { channel_id: channels[1].channel_id, title: "Goal of the day", kind: "sports", language: "en", caption: null })];
let fail = false;
const queries = [];

async function mock(page) {
  await page.route("https://www.youtube-nocookie.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<html><body style='background:#111'></body></html>" }));
  await page.route(`${API}/**`, async (route) => {
    const u = new URL(route.request().url());
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(b), headers: { "access-control-allow-origin": "*" } });
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (u.pathname === "/rest/v1/news_video_channels") return json(channels);
    if (u.pathname === "/rest/v1/news_videos") {
      if (fail) return json({ message: "boom" }, 500);
      const p = u.searchParams; queries.push(u.search);
      let rows = [...videos].sort((a, b) => b.published_at.localeCompare(a.published_at));
      if (p.get("kind")) rows = rows.filter((v) => v.kind === p.get("kind").slice(3));
      if (p.get("language")) rows = rows.filter((v) => v.language === p.get("language").slice(3));
      if (p.get("published_at")) rows = rows.filter((v) => v.published_at < p.get("published_at").slice(3));
      if (p.get("video_id")) { const r = rows.find((v) => v.video_id === p.get("video_id").slice(3)); return r ? json(r) : json({ code: "PGRST116" }, 406); }
      return json(rows.slice(0, Number(p.get("limit") || 15)));
    }
    return json([]);
  });
}

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log("FAIL", m); } else console.log("ok  ", m); };
const until = async (page, fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn).catch(() => false)) return true; await page.waitForTimeout(200); } throw new Error("timeout: " + fn); };
async function open(q, { width = 390, height = 800, lang } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  if (lang) await ctx.addInitScript((l) => localStorage.setItem("nabd-lang", l), lang);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await mock(page);
  await page.goto(base + "/reels.html" + q);
  return { page, ctx, errors };
}

{
  const { page, ctx, errors } = await open("");
  await page.waitForSelector(".reel");
  await until(page, () => document.querySelectorAll(".reel iframe").length === 1);
  const src = await page.$eval(".reel iframe", (f) => f.src);
  ok(src.startsWith("https://www.youtube-nocookie.com/embed/vid00000001?") && src.includes("autoplay=1") && src.includes("mute=1") && src.includes("enablejsapi=1") && src.includes("playsinline=1"), "first video plays muted in the official privacy-enhanced embed");
  ok(await page.$eval(".reel", (c) => c.dataset.state === "playing"), "first card playing");
  ok(await page.$eval(".reel .rchan", (e) => e.textContent === "الجزيرة"), "publisher named");
  ok(await page.$eval(".reel .rlinks", (e) => e.querySelector("a[href='article.html?id=77']") && e.querySelector("a[href='https://www.youtube.com/shorts/vid00000001']")), "related story + YouTube links");
  ok(await page.$eval("html", (e) => e.dir === "rtl"), "RTL");
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no horizontal overflow");
  await page.screenshot({ path: path.join(outDir, "reels-ar.png") });
  // swipe to the next video → only one player, on the second card
  await page.$eval("#reels-feed", (f) => f.scrollBy(0, f.clientHeight));
  await until(page, () => document.querySelectorAll(".reel")[1].querySelector("iframe") && document.querySelectorAll(".reel iframe").length === 1);
  ok(true, "scrolling moves playback to the next video, one player at a time");
  // sound: unmute sends the command, next video starts unmuted
  await page.click(".reel:nth-child(2) .act-sound");
  ok(await page.$eval(".reel:nth-child(2) .act-sound", (b) => b.getAttribute("aria-pressed") === "true"), "sound toggled on");
  await page.click(".reel:nth-child(2) .act-cc");
  await until(page, () => document.querySelectorAll(".reel")[1].querySelector("iframe")?.src.includes("cc_load_policy=1"));
  ok(true, "captions reload the player with captions on");
  await page.click(".reel:nth-child(2) .act-play");
  ok(await page.$eval(".reel:nth-child(2)", (c) => c.dataset.state === "paused"), "pause");
  // infinite load
  for (let i = 0; i < 14; i++) await page.$eval("#reels-feed", (f) => f.scrollBy(0, f.clientHeight));
  await until(page, () => document.querySelectorAll(".reel").length === 21);
  ok(queries.some((q) => q.includes("published_at=lt.")), "next page loaded with a time cursor");
  await page.$eval("#reels-feed", (f) => f.scrollTo(0, f.scrollHeight));
  await page.waitForSelector(".reels-state.end");
  ok(true, "end of feed state");
  // filter: sports
  await page.click("text=رياضة");
  await until(page, () => document.querySelectorAll(".reel").length === 1);
  ok(await page.$eval(".reel h2", (e) => e.textContent === "Goal of the day" && e.dir === "ltr"), "sports filter; English title shown LTR");
  ok(new URL(page.url()).searchParams.get("kind") === "sports", "filter kept in the URL");
  ok(errors.length === 0, "no console errors: " + errors.join(" / "));
  await ctx.close();
}
{
  const { page, ctx } = await open("?v=vid00000005", { lang: "en", width: 1280 });
  await page.waitForSelector(".reel");
  ok(await page.$eval(".reel", (c) => c.dataset.id === "vid00000005"), "shared link opens that video first");
  ok(await page.$$eval(".reel[data-id='vid00000005']", (x) => x.length) === 1, "shared video not duplicated in the feed");
  ok(await page.$eval("html", (e) => e.dir === "ltr") && await page.$eval(".reel .rchan", (e) => e.textContent === "Al Jazeera Arabic"), "English edition: LTR, English publisher name");
  await page.screenshot({ path: path.join(outDir, "reels-en.png") });
  await ctx.close();
}
{
  fail = true;
  const { page, ctx } = await open("");
  await page.waitForSelector(".reels-state h3");
  ok(await page.$eval(".reels-state", (e) => e.textContent.includes("تعذّر")), "load error state with retry");
  fail = false;
  await page.click(".reels-state button");
  await page.waitForSelector(".reel");
  ok(true, "retry recovers");
  await ctx.close();
  videos = [];
  const e = await open("");
  await e.page.waitForSelector(".reels-state h3");
  ok(await e.page.$eval(".reels-state", (x) => x.textContent.includes("لا فيديوهات")), "empty state");
  await e.ctx.close();
}
await browser.close(); server.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
