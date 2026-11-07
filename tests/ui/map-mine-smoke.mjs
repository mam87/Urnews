// World map + "My Lahza" (saved stories, follows) UI test with a mocked Supabase API.
// Usage: CHROME=/path/to/chrome node tests/ui/map-mine-smoke.mjs <site-dir> <out-dir>
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
  const type = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" }[path.extname(f)] || "application/octet-stream";
  let body = fs.readFileSync(f);
  if (p.endsWith("config.js")) body = Buffer.from(String(body).replace(/export const SUPABASE_URL = ".*";/, `export const SUPABASE_URL = "${API}";`));
  res.writeHead(200, { "content-type": type }); res.end(body);
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const iso = (m) => new Date(Date.now() - m * 60000).toISOString();
const art = (id, extra) => ({ id, source_id: 1, url: `https://a.example/${id}`, title: `خبر رقم ${id}`, title_original: null, summary: "مقتطف.", summary_kind: "feed", language: "ar", translated: false,
  title_en: null, countries: ["JO"], region: "middle_east", event_type: null, category: "jordan", categories: ["jordan"], image_url: null, published_at: iso(id), published_estimated: false,
  fetched_at: iso(id), cluster_id: null, verification: "reported", is_breaking: false, breaking_until: null, importance: 30, pinned: false, edited: false, status: "published", created_at: iso(id), ...extra });
const articles = [art(1), art(2, { countries: ["JP"], region: "east_asia", category: "world", categories: ["world"] }), art(3, { category: "sports", categories: ["sports"], countries: ["ES"] })];
const rpcCalls = [], articleQueries = [];

async function mock(page) {
  await page.route(`${API}/**`, async (route) => {
    const u = new URL(route.request().url());
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(b), headers: { "access-control-allow-origin": "*" } });
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (u.pathname.startsWith("/realtime")) return route.abort();
    if (u.pathname === "/rest/v1/rpc/news_map_counts") {
      const body = JSON.parse(route.request().postData() || "{}"); rpcCalls.push(body);
      return json(body.p_theme === "disaster" ? [{ country: "JP", n: 4, breaking: 1 }] : [{ country: "JO", n: 40, breaking: 0 }, { country: "JP", n: 12, breaking: 1 }, { country: "US", n: 3, breaking: 0 }]);
    }
    if (u.pathname === "/rest/v1/news_sources") return json([{ id: 1, slug: "a", name_ar: "مصدر ألف", name_en: "Source A", allow_images: false }]);
    if (u.pathname === "/rest/v1/news_articles") {
      articleQueries.push(u.search);
      const p = u.searchParams;
      if (p.get("is_breaking")) return json([]);
      let rows = [...articles];
      if (p.get("countries")?.startsWith("cs.")) rows = rows.filter((a) => a.countries.includes(p.get("countries").slice(4, -1)));
      if (p.get("id")?.startsWith("in.")) rows = rows.filter((a) => p.get("id").slice(4, -1).split(",").map(Number).includes(a.id));
      if (p.get("id")?.startsWith("eq.")) { const a = rows.find((x) => x.id === Number(p.get("id").slice(3))); const acc = route.request().headers()["accept"] || ""; return acc.includes("vnd.pgrst.object") ? (a ? json(a) : json({}, 406)) : json(a ? [a] : []); }
      return json(rows);
    }
    const acc = route.request().headers()["accept"] || "";
    if (acc.includes("vnd.pgrst.object")) return json({ code: "PGRST116", message: "0 rows" }, 406);
    return json([]);
  });
}
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log("FAIL", m); } else console.log("ok  ", m); };
const until = async (page, fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn).catch(() => false)) return true; await page.waitForTimeout(150); } throw new Error("timeout: " + fn); };
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
await mock(page);

// map
await page.goto(base + "/map.html");
await page.waitForSelector("svg.world path[data-iso='JO']");
await until(page, () => document.querySelector("path[data-iso='JO']").dataset.s === "5");
ok(await page.$eval("path[data-iso='JP']", (p) => Number(p.dataset.s) >= 1 && p.classList.contains("brk")), "countries shaded; breaking outlined");
ok(await page.$eval("path[data-iso='FR']", (p) => p.dataset.s === "0"), "countries without stories stay neutral");
ok(await page.$$eval(".map-rank li", (x) => x.length) === 3, "ranked list (accessible alternative)");
ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "map: no horizontal overflow on mobile");
await page.click(".map-rank .map-row");
await page.waitForSelector(".map-panel .feed li");
ok(await page.$eval(".map-panel h2", (e) => e.textContent.includes("الأردن")), "country panel opens with its stories");
ok(articleQueries.some((q) => q.includes("countries=cs.%7BJO%7D") || q.includes("countries=cs.{JO}")), "panel queries stories tagged with the country");
ok(new URL(page.url()).searchParams.get("country") === "JO", "selection kept in the URL");
ok(await page.$eval("svg.world", (s) => s.getAttribute("viewBox") !== "0 0 960 500"), "map zooms to the selected country");
await page.click(".map-panel .follow-btn");
ok(await page.$eval(".map-panel .follow-btn", (b) => b.getAttribute("aria-pressed") === "true"), "follow country from the map");
await page.screenshot({ path: path.join(outDir, "map-ar.png"), fullPage: true });
await page.click("text=كوارث وطوارئ");
await until(page, () => document.querySelectorAll(".map-rank li").length === 1);
ok(rpcCalls.some((b) => b.p_theme === "disaster" && b.p_hours === 24), "theme filter sent to the server");
await page.click("text=7 أيام");
await until(page, () => new URL(location.href).searchParams.get("h") === "168");
for (let i = 0; i < 40 && !rpcCalls.some((b) => b.p_hours === 168); i++) await page.waitForTimeout(100);
ok(rpcCalls.some((b) => b.p_hours === 168), "period filter");

// my lahza: For you uses the follow
await page.goto(base + "/mine.html");
await page.waitForSelector(".feed li");
ok(articleQueries.some((q) => decodeURIComponent(q).includes("countries.ov.{JO}")), "For you: feed from followed countries");
// follow a section
await page.click("text=ما أتابعه");
await page.click(".follow-chip:has-text('رياضة')");
ok(await page.$eval(".follow-chip[aria-pressed='true']", (b) => b.textContent.includes("رياضة")), "follow a section");
await page.click(".sp-tabs button:has-text('لك')");
await page.waitForSelector(".feed li");
ok(articleQueries.some((q) => decodeURIComponent(q).includes("category.in.(sports)")), "For you includes followed sections");

// save from an article page, then see it in Saved
await page.goto(base + "/article.html?id=1");
await page.waitForSelector(".save-btn");
await page.click(".save-btn");
ok(await page.$eval(".save-btn", (b) => b.getAttribute("aria-pressed") === "true"), "save button toggles");
await page.evaluate(() => { const l = JSON.parse(localStorage.getItem("lahza-saved")); l.push({ kind: "article", id: 999, title: "خبر قديم محذوف", at: new Date().toISOString() }); localStorage.setItem("lahza-saved", JSON.stringify(l)); });
await page.goto(base + "/mine.html?tab=saved");
await page.waitForSelector(".feed li");
ok(await page.$$eval(".feed > li", (x) => x.length) === 2, "saved list shows the live article and the expired one");
ok(await page.$eval(".saved-plain", (e) => e.textContent.includes("خبر قديم محذوف") && e.textContent.includes("30")), "expired saved story keeps its title with a note");
await page.click(".saved-plain .saved-tools button");
await until(page, () => document.querySelectorAll(".feed > li").length === 1);
ok(true, "remove from saved");
await page.screenshot({ path: path.join(outDir, "mine-ar.png"), fullPage: true });
ok(errors.length === 0, "no console errors: " + errors.join(" / "));

// English edition of the map
const en = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await en.addInitScript(() => localStorage.setItem("nabd-lang", "en"));
const p2 = await en.newPage(); await mock(p2);
await p2.goto(base + "/map.html?country=JP");
await p2.waitForSelector(".map-panel h2");
ok(await p2.$eval("html", (e) => e.dir === "ltr") && await p2.$eval(".map-panel h2", (e) => e.textContent.includes("Japan")), "English map, deep link to a country");
await p2.screenshot({ path: path.join(outDir, "map-en.png") });
await browser.close(); server.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
