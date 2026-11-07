// Monetization hooks: nothing renders when switched off; house ad + newsletter render and work when switched on.
// Usage: CHROME=/path/to/chrome node tests/ui/monetize-smoke.mjs <site-dir> <out-dir>
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
  let body = fs.readFileSync(f);
  if (p.endsWith("config.js")) body = Buffer.from(String(body).replace(/export const SUPABASE_URL = ".*";/, `export const SUPABASE_URL = "${API}";`));
  res.writeHead(200, { "content-type": { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" }[path.extname(f)] || "application/octet-stream" }); res.end(body);
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
let enabled = false;
const subs = [];
async function mock(page) {
  await page.route(`${API}/**`, async (route) => {
    const u = new URL(route.request().url());
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(b), headers: { "access-control-allow-origin": "*" } });
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (u.pathname.startsWith("/realtime")) return route.abort();
    if (u.pathname === "/rest/v1/news_settings") return json([
      { key: "ads_config", value: { enabled, slots: ["home_side", "article", "sports"], house: [{ title_ar: "سيرة ذاتية احترافية", text_ar: "أنشئ سيرتك في دقائق", url: "https://example.com/cv", sponsor: "CV Pro" }, { title_ar: "رابط غير آمن", url: "javascript:alert(1)" }] } },
      { key: "newsletter_enabled", value: enabled }]);
    if (u.pathname === "/rest/v1/rpc/news_newsletter_subscribe") { const b = JSON.parse(route.request().postData()); subs.push(b); return json(b.p_consent ? "ok" : "consent_required"); }
    if (u.pathname === "/rest/v1/rpc/news_site_status") return json({ last_run_at: new Date().toISOString(), sources_active: 1, sources_healthy: 1, articles_24h: 0, interval_minutes: 1 });
    const acc = route.request().headers()["accept"] || "";
    if (acc.includes("vnd.pgrst.object")) return json({ code: "PGRST116" }, 406);
    return json([]);
  });
}
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log("FAIL", m); } else console.log("ok  ", m); };
const open = async (u) => { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage(); const errors = [];
  page.on("pageerror", (e) => errors.push(String(e))); await mock(page); await page.goto(base + u); return { page, ctx, errors }; };

{ const { page, ctx, errors } = await open("/index.html");
  await page.waitForSelector("aside"); await page.waitForTimeout(800);
  ok(await page.$(".ad-slot") === null && await page.$(".newsletter") === null, "switched off: no ad, no newsletter box, no empty space");
  ok(!errors.length, "no errors (off)"); await ctx.close(); }
enabled = true;
{ const { page, ctx, errors } = await open("/index.html");
  await page.waitForSelector("aside .ad-slot");
  ok(await page.$eval(".ad-slot .ad-label", (e) => e.textContent.includes("إعلان") && e.textContent.includes("CV Pro")), "ad is labelled as an advertisement with its sponsor");
  ok(await page.$eval(".ad-slot a", (a) => a.href === "https://example.com/cv" && a.rel.includes("sponsored")), "only the https ad is used; rel=sponsored");
  await page.waitForSelector(".newsletter");
  await page.fill(".newsletter input[type=email]", "reader@example.com");
  await page.click(".newsletter button[type=submit]");
  ok(subs.length === 0, "browser blocks submit without consent (required checkbox)");
  await page.check(".newsletter input[type=checkbox]");
  await page.click(".newsletter button[type=submit]");
  await page.waitForFunction(() => document.querySelector(".newsletter [role=status]").textContent.length > 0);
  ok(subs.length === 1 && subs[0].p_consent === true && subs[0].p_email === "reader@example.com", "sign-up sent with consent");
  ok(await page.$eval(".newsletter [role=status]", (e) => e.textContent.includes("شكراً")), "confirmation shown");
  await page.screenshot({ path: path.join(outDir, "monetize-on.png"), fullPage: true });
  ok(!errors.length, "no errors (on): " + errors.join(" / ")); await ctx.close(); }
await browser.close(); server.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
