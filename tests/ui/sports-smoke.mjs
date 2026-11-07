// Sports centre UI test with a mocked sports provider and a mocked Supabase API (no network needed).
// Usage: node tests/ui/sports-smoke.mjs <site-dir> <out-dir>   (CHROME=/path/to/chrome to pick a browser)
// Checks: day view groups by competition and keeps major competitions first, live match shows minute and
// is polled, provider overload shows the "delayed" banner over the last good copy (never invented data),
// a provider outage with no cache shows an error state, empty days, standings/scorers/assists tables,
// match events (goals/cards/subs, half-time), team form, player stats, search, attribution link on every
// view, Arabic RTL + English LTR, no horizontal overflow at 360 px, no console errors.
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const [siteDir, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const API = "https://test.supabase.co";
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/") p = "/index.html";
  const f = path.join(siteDir, p);
  if (!f.startsWith(siteDir) || !fs.existsSync(f)) { res.writeHead(404); return res.end("nf"); }
  const type = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" }[path.extname(f)] || "application/octet-stream";
  let body = fs.readFileSync(f);
  if (p.endsWith("config.js")) body = Buffer.from(String(body).replace(/export const SUPABASE_URL = ".*";/, `export const SUPABASE_URL = "${API}";`));
  res.writeHead(200, { "content-type": type }); res.end(body);
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const now = new Date();
const utcDay = (n = 0) => { const d = new Date(now); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const at = (minFromNow) => new Date(now.getTime() + minFromNow * 60000).toISOString();
const M = (o) => ({ home_logo: "", away_logo: "", competition_logo: "", status_text: "", ...o });
let liveMinute = 67;
const fixturesToday = () => [
  M({ home: "Obscure FC", away: "Tiny United", home_score: "1", away_score: "0", status: "finished", time: at(-200), competition: "Some Regional League", url: "/football/match/obscure-fc-vs-tiny-united/aaa/" }),
  M({ home: "FC Barcelona", away: "Atletico Madrid", home_score: "2", away_score: "1", status: "live", time: at(-70), competition: "Spanish La Liga", url: "/football/match/atletico-madrid-vs-fc-barcelona/bbb/" }),
  M({ home: "Arsenal", away: "Chelsea", home_score: null, away_score: null, status: "upcoming", time: at(90), competition: "English Premier League", url: "/football/match/arsenal-vs-chelsea/ccc/" }),
];
let provider = "ok"; // ok | overload | down
const calls = { fixtures: 0, match: 0 };

async function mock(page) {
  await page.route("https://sportscore.com/**", async (route) => {
    const u = new URL(route.request().url());
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(b), headers: { "access-control-allow-origin": "*" } });
    if (provider === "overload") return route.fulfill({ status: 503, contentType: "text/html", body: "<h1>High traffic right now</h1>", headers: { "access-control-allow-origin": "*" } });
    if (provider === "down") return route.abort();
    const q = u.searchParams;
    if (u.pathname === "/api/v1/fixtures/") {
      calls.fixtures++;
      const sport = q.get("sport");
      let list = sport === "football" && (q.get("date") === utcDay(0) || q.get("date") === utcDay(-1)) ? fixturesToday() : [];
      if (q.get("date") === utcDay(-1)) list = []; // everything is on the current UTC day in this fixture set
      if (q.get("competition") === "spanish-la-liga") list = list.filter((m) => m.competition === "Spanish La Liga");
      if (sport === "basketball" && q.get("date") === utcDay(0)) list = [M({ home: "Atlanta Hawks", away: "Washington Wizards", home_score: "139", away_score: "132", status: "finished", time: at(-30), competition: "National Basketball Association", url: "/basketball/match/atlanta-hawks-vs-washington-wizards/" })];
      list = list.map((m) => (m.status === "live" ? { ...m, live_minute: liveMinute } : m));
      return json({ sport, date: q.get("date"), count: list.length, matches: list });
    }
    if (u.pathname === "/api/widget/match/") {
      calls.match++;
      if (q.get("slug") !== "atletico-madrid-vs-fc-barcelona") return json({ error: "Match not found" }, 404);
      return json({ sport: "football", match: { ...fixturesToday()[1], live_minute: liveMinute, home_ht_score: 1, away_ht_score: 0, stats: [], lineups: null,
        incidents: [
          { time: 12, type: "Goal", side: "home", player: "Raphinha", is_goal: true, home_score: 1, away_score: 0 },
          { time: 30, type: "Yellow card", side: "away", player: "", is_card: true },
          { time: 55, type: "Goal", side: "away", player: "", is_goal: true, home_score: 1, away_score: 1 },
          { time: 60, type: "Substitution", side: "home", player: "" },
          { time: 64, type: "Goal", side: "home", player: "Lamine Yamal", is_goal: true, home_score: 2, away_score: 1 },
          { time: 66, type: "Red card", side: "away", player: "", is_card: true }] }, updated: at(0) });
    }
    if (u.pathname === "/api/widget/standings/") return json({ sport: "football", competition: "Spanish La Liga", tables: [{ group: "", rows: [
      { pos: 1, team: "FC Barcelona", team_logo: "", team_slug: "fc-barcelona", p: 11, w: 10, d: 0, l: 1, gf: 46, ga: 12, gd: 34, pts: 30, promo_color: "#fa8072", promo_name: "Champions League league stage" },
      { pos: 2, team: "Atletico Madrid", team_logo: "", team_slug: "atletico-madrid", p: 11, w: 9, d: 1, l: 1, gf: 22, ga: 8, gd: 14, pts: 28, promo_color: "#fa8072", promo_name: "Champions League league stage" },
      { pos: 20, team: "Malaga", team_logo: "", team_slug: "malaga", p: 11, w: 0, d: 5, l: 6, gf: 7, ga: 20, gd: -13, pts: 5, promo_color: "red;}</style>", promo_name: "" }] }] });
    if (u.pathname === "/api/widget/topscorers/") return json({ sport: "football", stat_type: q.get("stat"), scorers: [
      { rank: 1, player: q.get("stat") === "assists" ? "Lamine Yamal" : "Raphinha", player_slug: q.get("stat") === "assists" ? "lamine-yamal" : "raphinha", player_logo: "", team: "FC Barcelona", team_slug: "fc-barcelona", team_logo: "", goals: 15, assists: 3, matches: 10 }] });
    if (u.pathname === "/api/widget/team/") return json({ sport: "football", team: { name: "FC Barcelona", logo: "", slug: "fc-barcelona" }, count: 3, matches: [
      M({ home: "FC Barcelona", away: "Deportivo Alavés", home_score: "6", away_score: "1", status: "finished", time: at(-10000), competition: "Spanish La Liga", url: "/football/match/fc-barcelona-vs-deportivo-alaves/x/" }),
      M({ home: "FC Barcelona", away: "Real Madrid", home_score: "1", away_score: "2", status: "finished", time: at(-20000), competition: "Spanish La Liga", url: "/football/match/fc-barcelona-vs-real-madrid/y/" }),
      M({ home: "Atletico Madrid", away: "FC Barcelona", home_score: null, away_score: null, status: "upcoming", time: at(2000), competition: "Spanish La Liga", url: "/football/match/atletico-madrid-vs-fc-barcelona/z/" })] });
    if (u.pathname === "/api/widget/player/") return json({ sport: "football", player: { name: "Raphinha", logo: "", slug: "raphinha" }, stats: { team: "FC Barcelona", competition: "UEFA Champions League", matches: 3, goals: 4, assists: 0, minutes: 201 } });
    if (u.pathname === "/api/v1/search/") return json({ sport: "football", teams: [{ name: "FC Barcelona", slug: "fc-barcelona", logo: "" }], competitions: [], players: [] });
    return json({ error: "unknown" }, 404);
  });
  await page.route(`${API}/**`, async (route) => {
    const u = new URL(route.request().url());
    const json = (b) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b), headers: { "access-control-allow-origin": "*" } });
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (u.pathname.startsWith("/realtime")) return route.abort();
    if (u.pathname === "/rest/v1/news_sources") return json([{ id: 1, slug: "a", name_ar: "مصدر ألف", name_en: "Source A", allow_images: false }]);
    if (u.pathname === "/rest/v1/news_articles") {
      const isBreaking = u.searchParams.get("is_breaking");
      if (isBreaking) return json([]);
      return json([{ id: 7, source_id: 1, url: "https://a.example/7", title: "برشلونة يتصدر الدوري الإسباني", title_en: "Barcelona top La Liga", summary: "مقتطف.", summary_kind: "feed",
        language: "ar", translated: false, countries: ["ES"], region: "europe", category: "sports", categories: ["sports"], image_url: null, published_at: at(-30), fetched_at: at(-29),
        cluster_id: null, verification: "reported", is_breaking: false, breaking_until: null, importance: 30, pinned: false, edited: false, status: "published", created_at: at(-30) }]);
    }
    return json([]);
  });
}

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.log("FAIL", msg); } else console.log("ok  ", msg); };

async function open(pathq, { width = 390, lang } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 860 } });
  if (lang) await ctx.addInitScript((l) => localStorage.setItem("nabd-lang", l), lang);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR_FAILED/.test(m.text())) errors.push(m.text()); });
  await mock(page);
  await page.goto(base + "/" + pathq);
  return { page, ctx, errors };
}
const until = async (page, fn, ms = 45000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn).catch(() => false)) return true; await page.waitForTimeout(500); } throw new Error("timeout waiting for " + fn); };
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

// 1. Day view (Arabic, mobile)
{
  const { page, ctx, errors } = await open("sports.html");
  await page.waitForSelector(".mrow");
  const groups = await page.$$eval(".mgroup h3", (x) => x.map((e) => e.textContent));
  ok(groups.length === 2 && groups.every((g) => !g.includes("Regional")), "major competitions only by default, Arabic names: " + groups.join(" | "));
  ok(groups[0].includes("الإنجليزي") && groups[1].includes("الإسباني"), "competitions in editorial order (Premier League, then La Liga)");
  ok(await page.$eval(".st.live", (e) => e.textContent.includes("67'")), "live minute shown");
  ok(await page.$eval("html", (e) => e.dir === "rtl"), "RTL in Arabic");
  ok(await page.$$eval(".mrow .nm", (x) => x.some((e) => e.textContent === "برشلونة")), "known team shown with Arabic name");
  ok(await page.$(".sp-attrib a[href='https://sportscore.com/']") !== null, "attribution link present");
  ok(await page.$eval(".sp-fresh", (e) => e.textContent.includes("آخر تحديث")), "last update time shown");
  ok(await noOverflow(page), "no horizontal overflow at 390px");
  await page.click("text=كل المباريات");
  await until(page, () => document.querySelectorAll(".mlist .mgroup").length === 3, 8000);
  ok(true, "'all matches' reveals the minor competition");
  await page.click("text=المباشر فقط");
  await until(page, () => document.querySelectorAll(".mlist .mrow").length === 1, 8000);
  ok(true, "live-only filter leaves one match");
  await page.waitForSelector(".sp-news .feed li");
  ok(true, "related sports news from Lahza listed");
  await page.screenshot({ path: path.join(outDir, "sports-day-ar.png"), fullPage: true });
  // live polling: next refresh within ~30 s shows the new minute
  liveMinute = 68;
  await until(page, () => document.querySelector(".st.live")?.textContent.includes("68'"));
  ok(true, "live match refreshed by polling (minute 67 → 68)");
  ok(errors.length === 0, "no console errors: " + errors.join(" / "));
  // provider overload after a good load → delayed banner, old data kept
  provider = "overload";
  await page.evaluate(() => { sessionStorage.clear(); });
  liveMinute = 69;
  await page.waitForSelector(".sp-fresh.warn", { timeout: 45000 });
  ok(await page.$eval(".st.live", (e) => e.textContent.includes("68'")), "overload: last good data kept and marked delayed (no invented minute)");
  provider = "ok";
  await ctx.close();
}
// 2. provider down with no cache → error state
{
  provider = "down";
  const { page, ctx } = await open("sports.html?sport=football&date=2026-01-01");
  await page.waitForSelector(".state h3", { timeout: 20000 });
  ok(await page.$eval(".state", (e) => e.textContent.includes("غير متاحة")), "outage without cache → error state, no scores");
  ok(await page.$$eval(".mrow", (x) => x.length) === 0, "no match rows during outage");
  provider = "ok";
  await ctx.close();
}
// 3. empty day + other sport
{
  const { page, ctx } = await open("sports.html?sport=football&date=" + utcDay(5));
  await page.waitForSelector(".state h3");
  ok(await page.$eval(".state h3", (e) => e.textContent.includes("لا مباريات")), "empty day state");
  await ctx.close();
  const b = await open("sports.html?sport=basketball");
  await b.page.waitForSelector(".mrow");
  ok(await b.page.$eval(".mrow", (e) => e.textContent.includes("139")), "basketball scores render");
  await b.ctx.close();
}
// 4. competition tabs
{
  const { page, ctx, errors } = await open("sports.html?comp=spanish-la-liga&tab=table");
  await page.waitForSelector("table.standings tbody tr");
  ok(await page.$$eval("table.standings tbody tr", (x) => x.length) === 3, "standings rows");
  ok(await page.$eval("table.standings tbody tr:nth-child(3) td", (e) => !e.getAttribute("style")?.includes("<")), "unsafe colour from provider ignored");
  ok(await page.$(".sp-legend li") !== null, "qualification legend");
  ok(await noOverflow(page), "standings: no horizontal overflow on mobile");
  await page.click("text=الهدافون"); await page.waitForSelector("text=Raphinha");
  await page.click("text=صناعة الأهداف"); await page.waitForSelector("text=Lamine Yamal");
  ok(true, "scorers and assists tabs");
  await page.click("text=المباريات"); await page.waitForSelector(".mrow");
  ok(await page.$$eval(".mrow", (x) => x.length) === 1, "competition day filtered to La Liga");
  await page.screenshot({ path: path.join(outDir, "sports-comp-ar.png"), fullPage: true });
  ok(errors.length === 0, "no console errors (competition): " + errors.join(" / "));
  await ctx.close();
}
// 5. match centre (English, desktop)
{
  const { page, ctx, errors } = await open("sports.html?match=atletico-madrid-vs-fc-barcelona", { width: 1280, lang: "en" });
  await page.waitForSelector(".scoreboard");
  ok(await page.$eval("html", (e) => e.dir === "ltr"), "LTR in English");
  ok(await page.$eval(".sb-score .big", (e) => e.textContent.replace(/\s/g, "") === "2-1"), "score");
  ok(await page.$eval(".sb-ht", (e) => e.textContent.includes("1 - 0")), "half-time score");
  const inc = await page.$$eval(".incidents li", (x) => x.map((e) => e.textContent));
  ok(inc.length === 6 && inc[0].includes("Raphinha") && inc.some((t) => t.includes("Red card")) && inc.some((t) => t.includes("Substitution")), "goals, cards and substitutions listed in order");
  ok(await page.$(".sp-attrib a") !== null, "attribution on match page");
  ok(!(await page.$eval("#app", (e) => /\bnull\b|undefined/.test(e.textContent))), "no 'null'/'undefined' text rendered");
  await page.screenshot({ path: path.join(outDir, "sports-match-en.png"), fullPage: true });
  ok(errors.length === 0, "no console errors (match): " + errors.join(" / "));
  await ctx.close();
  const nf = await open("sports.html?match=nope");
  await nf.page.waitForSelector(".state");
  ok(await nf.page.$eval(".state", (e) => e.textContent.includes("لم نجد")), "unknown match → not-found state");
  await nf.ctx.close();
}
// 6. team, player, search
{
  const { page, ctx } = await open("sports.html?team=fc-barcelona");
  await page.waitForSelector(".sp-profile h2");
  ok(await page.$eval(".sp-profile h2", (e) => e.textContent === "برشلونة"), "team page title in Arabic");
  ok(await page.$$eval(".form", (x) => x.map((e) => e.className).join()) === "form w,form l", "form W then L (newest first)");
  await page.waitForSelector(".sp-news .feed li");
  ok(true, "team news listed");
  ok(!(await page.$eval("#app", (e) => /\bnull\b|undefined/.test(e.textContent))), "team page: no 'null' text");
  await ctx.close();
  const p = await open("sports.html?player=raphinha");
  await p.page.waitForSelector(".stat");
  ok(await p.page.$$eval(".stat", (x) => x.length) === 4, "player stats shown (only fields the provider supplies)");
  await p.ctx.close();
  const s = await open("sports.html?q=barca");
  await s.page.waitForSelector(".mrow.simple");
  ok(await s.page.$eval(".mrow.simple", (e) => e.getAttribute("href").includes("team=fc-barcelona")), "search links to team page");
  await s.ctx.close();
}
// 7. nav link exists on the home page chrome
{
  const { page, ctx } = await open("index.html");
  await page.waitForSelector(".bottombar a[href='sports.html']");
  ok(true, "bottom bar links to the sports centre");
  await ctx.close();
}
ok(calls.fixtures > 0 && calls.match > 0, `provider calls made (fixtures ${calls.fixtures}, match ${calls.match})`);
await browser.close(); server.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
