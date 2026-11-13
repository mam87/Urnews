// Weather + trends pages with mocked Supabase, Open-Meteo and geocoding (no network needed).
// Usage: CHROME=/path/to/chrome node tests/ui/pages-smoke.mjs <absolute-site-dir> <out-dir>
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
  const type = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" }[path.extname(f)] || "application/octet-stream";
  let body = fs.readFileSync(f);
  if (p.endsWith("config.js")) body = Buffer.from(String(body).replace(/export const SUPABASE_URL = ".*";/, `export const SUPABASE_URL = "${API}";`));
  res.writeHead(200, { "content-type": type }); res.end(body);
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const iso = (m) => new Date(Date.now() - m * 60000).toISOString();
const hours = Array.from({ length: 24 }, (_, i) => `2026-11-13T${String(i).padStart(2, "0")}:00`);
const days = Array.from({ length: 7 }, (_, i) => `2026-11-${13 + i}`);
const wx = (t) => ({ timezone: "Asia/Amman", current: { temperature_2m: t, apparent_temperature: t - 1.4, relative_humidity_2m: 41, weather_code: 2, wind_speed_10m: 12.6, precipitation: 0, is_day: 1 },
  hourly: { time: hours, temperature_2m: hours.map((_, i) => t - i / 4), weather_code: hours.map(() => 61), precipitation_probability: hours.map((_, i) => i * 4), is_day: hours.map((_, i) => (i < 10 ? 1 : 0)) },
  daily: { time: days, weather_code: days.map(() => 3), temperature_2m_max: days.map((_, i) => t + i), temperature_2m_min: days.map((_, i) => t - 8 + i), precipitation_probability_max: days.map((_, i) => i * 12), sunrise: days.map((d) => d + "T06:05"), sunset: days.map((d) => d + "T16:41"), uv_index_max: days.map(() => 4.2) } });
const geos = ["JO", "SA", "US"].map((geo, i) => ({ geo, sort_order: i, last_ok_at: iso(2) }));
const trends = geos.flatMap(({ geo }) => Array.from({ length: 5 }, (_, i) => ({ geo, title: geo === "US" ? `Search term ${i + 1}` : `مصطلح بحث ${i + 1}`, rank: i + 1, traffic: (5 - i) * 1000, started_at: iso(30 * (i + 1)),
  news: [{ t: "عنوان خبر مرتبط", u: "https://example.com/a", s: "مصدر" }], seen_at: iso(1) })));
let failures = 0, forecastCalls = 0;
const ok = (c, m) => { if (!c) { failures++; console.log("FAIL", m); } else console.log("ok  ", m); };

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
async function open(url, { lang } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, timezoneId: "Asia/Amman" });
  if (lang) await ctx.addInitScript((l) => localStorage.setItem("nabd-lang", l), lang);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const json = (route, b) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b), headers: { "access-control-allow-origin": "*" } });
  await page.route("https://fonts.googleapis.com/**", (r) => r.abort());
  await page.route("https://geocoding-api.open-meteo.com/**", (r) => { const q = new URL(r.request().url()).searchParams.get("name");
    json(r, { results: q === "nothing" ? [] : [{ name: q === "Amman" ? "عمّان" : "إربد", admin1: q === "Amman" ? "محافظة العاصمة" : "محافظة إربد", country: "الأردن", country_code: "JO", latitude: q === "Amman" ? 31.955 : 32.556, longitude: q === "Amman" ? 35.945 : 35.85, timezone: "Asia/Amman", population: 1000000 }] }); });
  await page.route("https://api.open-meteo.com/**", (r) => { const u = new URL(r.request().url()); const n = u.searchParams.get("latitude").split(",").length; if (n === 1) forecastCalls++;
    json(r, n === 1 ? wx(u.searchParams.get("latitude").startsWith("32.5") ? 14 : 19) : Array.from({ length: n }, (_, i) => ({ current: { temperature_2m: 10 + i, weather_code: 0, is_day: 1 } }))); });
  await page.route(`${API}/**`, (route) => {
    const u = new URL(route.request().url());
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (u.pathname === "/rest/v1/news_trend_geos") return json(route, geos);
    if (u.pathname === "/rest/v1/news_trends") return json(route, trends);
    return json(route, []);
  });
  await page.goto(base + url);
  return { page, ctx, errors };
}
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

{ // weather: place from the time zone, details, search another city, world grid
  const { page, ctx, errors } = await open("/weather.html");
  await page.waitForSelector(".wx-hero .wx-temp");
  ok(await page.$eval(".wx-hero .wx-place b", (e) => e.textContent.includes("عمّان")), "first visit: city of the device time zone");
  ok(await page.$eval(".wx-hero .wx-place span", (e) => e.textContent.includes("محافظة العاصمة") && e.textContent.includes("الأردن")), "region and country shown");
  ok(await page.$eval(".wx-hero .wx-temp", (e) => e.textContent === "19°"), "current temperature, Latin digits");
  ok(await page.$$eval(".wx-hours li", (x) => x.length === 24) && await page.$$eval(".wx-full .wx-days li", (x) => x.length === 7), "24 hours and 7 days");
  await page.waitForSelector(".wx-grid li");
  ok(await page.$$eval(".wx-grid li", (x) => x.length === 24), "world cities grid");
  await page.fill(".wx-search input", "Irbid");
  await page.waitForSelector(".wx-results button");
  await page.click(".wx-results button");
  await page.waitForFunction(() => document.querySelector(".wx-hero .wx-temp")?.textContent === "14°");
  ok(await page.$$eval(".wx-chip", (x) => x.length === 2), "searched city selected and saved next to the first");
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem("lahza-wx-places-v2")).places.length === 2), "places remembered in this browser only");
  ok(await noOverflow(page), "weather: no horizontal overflow");
  await page.screenshot({ path: path.join(outDir, "weather-ar.png"), fullPage: true });
  ok(errors.length === 0, "weather: no console errors " + errors.join(" / "));
  await ctx.close();
}
{ // home panel uses the same place and a cached forecast
  const { page, ctx, errors } = await open("/index.html");
  await page.waitForSelector(".wx-panel .wx-temp");
  ok(await page.$eval(".wx-panel", (e) => e.textContent.includes("عمّان") && e.textContent.includes("آخر تحديث")), "home panel: reader's city with update time");
  await page.waitForSelector(".trend-strip a[href^='index.html?q=']");
  ok(await page.$eval(".trend-strip", (e) => e.textContent.includes("مصطلح بحث 1")), "home: trend strip for the reader's country");
  ok(errors.length === 0, "home: no console errors " + errors.join(" / "));
  await ctx.close();
}
{ // trends
  const { page, ctx, errors } = await open("/trends.html");
  await page.waitForSelector(".tr-item");
  ok(await page.$eval(".tr-geo[aria-pressed='true']", (e) => e.textContent.includes("الأردن")), "trends open on the reader's country");
  ok(await page.$$eval(".tr-item", (x) => x.length === 5) && await page.$eval(".tr-item .chip", (e) => e.textContent.includes("5 ألف")), "ranked terms with search volume");
  ok(await page.$eval(".tr-news a", (a) => a.href === "https://example.com/a" && a.rel.includes("noopener") && a.target === "_blank"), "related news links open at the publisher");
  await page.click(".tr-geo:first-child");
  await page.waitForSelector(".tr-world > li");
  ok(await page.$$eval(".tr-world > li", (x) => x.length === 3), "world at a glance: every country");
  ok(await page.$eval(".tr-attrib a", (a) => a.textContent === "Google Trends"), "source credited");
  ok(await noOverflow(page), "trends: no horizontal overflow");
  await page.screenshot({ path: path.join(outDir, "trends-ar.png"), fullPage: true });
  ok(errors.length === 0, "trends: no console errors " + errors.join(" / "));
  await ctx.close();
  const en = await open("/trends.html?geo=US", { lang: "en" });
  await en.page.waitForSelector(".tr-item");
  ok(await en.page.$eval(".tr-item h3", (e) => e.textContent === "Search term 1" && e.dir === "ltr") && await en.page.$eval("html", (e) => e.dir === "ltr"), "English edition, deep link to a country");
  await en.ctx.close();
}
await browser.close(); server.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
