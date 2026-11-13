// Trends page (trends.html): (1) the stories the world's newsrooms are covering most right now (Lahza's own global
// ranking), (2) what people are searching for right now, country by country (Google Trends public feed).
import { h, configured, loadSources, ago, toast } from "./common.js";
import { renderChrome } from "./layout.js";
import { EN, L } from "./i18n.js";
import { fetchGlobalEvents, eventCard } from "./global.js";
import { fetchTrends, guessGeo, saveGeo, geoLabel, geoName, volume, attribution, searchUrl, termDir } from "./trends-data.js";

const chrome = renderChrome({ active: "trends" });
const root = document.getElementById("app");
document.title = L("ترند الآن حول العالم — لحظة", "Trending worldwide — Lahza");
const P = new URLSearchParams(location.search);

const eventsEl = h("ul", { class: "gev-list" }, h("li", { class: "note" }, L("جارٍ التحميل…", "Loading…")));
const geoNav = h("nav", { class: "tr-geos", "aria-label": L("اختر دولة", "Pick a country") });
const body = h("div", { class: "tr-body" }, h("ul", { class: "skeleton", "aria-hidden": "true" }, h("li"), h("li"), h("li")));
const updatedEl = h("span", { class: "meta num" });
let data = null, geo = null; // geo === "world" → one glance at every country

function trendItem(r, i) {
  const news = Array.isArray(r.news) ? r.news.slice(0, 3) : [];
  return h("li", { class: "tr-item" },
    h("span", { class: "tr-rank num", "aria-hidden": "true" }, String(i + 1)),
    h("div", { class: "tr-main" },
      h("h3", { dir: termDir(r.title) }, h("a", { href: searchUrl(r.title), title: L("ابحث عنه في أخبار لحظة", "Search Lahza news for it") }, r.title)),
      h("div", { class: "tr-meta" }, r.traffic ? h("span", { class: "chip num" }, volume(r.traffic)) : null,
        r.started_at ? h("span", { class: "num" }, L("بدأ ", "started ") + ago(r.started_at)) : null),
      news.length ? h("ul", { class: "tr-news" }, news.map((n) => h("li", {},
        h("a", { href: n.u, target: "_blank", rel: "noopener noreferrer nofollow", dir: termDir(n.t) }, n.t), n.s ? h("span", { class: "src" }, n.s) : null))) : null));
}

function drawWorld() {
  body.replaceChildren(h("ul", { class: "tr-world" }, [...data.by].map(([g, rows]) =>
    h("li", {}, h("button", { type: "button", class: "tr-country", onclick: () => pick(g) }, geoLabel(g)),
      h("ol", {}, rows.slice(0, 4).map((r) => h("li", { dir: termDir(r.title) }, h("a", { href: searchUrl(r.title) }, r.title),
        r.traffic ? h("span", { class: "num" }, volume(r.traffic)) : null)))))), attribution(null));
}
function drawGeo() {
  const rows = data.by.get(geo) || [];
  body.replaceChildren(
    h("div", { class: "section-head" }, h("h2", {}, L("الأكثر بحثاً الآن في ", "Most searched right now in ") + geoName(geo)), h("span", { class: "meta num" }, L(`${rows.length} مصطلحاً`, `${rows.length} terms`))),
    rows.length ? h("ol", { class: "tr-list" }, rows.map(trendItem)) : h("div", { class: "state" }, L("لا بيانات لهذه الدولة الآن.", "No data for this country right now.")),
    attribution(geo));
}
function drawNav() {
  const btn = (g, label) => h("button", { type: "button", class: "tr-geo", "aria-pressed": String(geo === g), onclick: () => pick(g) }, label);
  geoNav.replaceChildren(btn("world", "🌐 " + L("نظرة عالمية", "World at a glance")), ...[...data.by.keys()].map((g) => btn(g, geoLabel(g))));
}
function pick(g) {
  geo = g;
  if (g !== "world") saveGeo(g);
  const u = new URL(location.href); u.searchParams.set("geo", g); history.replaceState(null, "", u);
  drawNav(); g === "world" ? drawWorld() : drawGeo();
  geoNav.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest", inline: "center" });
}

async function loadTrends(first = false) {
  try {
    data = await fetchTrends();
    if (!data.by.size) { body.replaceChildren(h("div", { class: "state" }, h("h3", {}, L("لا ترندات متاحة الآن", "No trends available right now")), L("تُجمع البيانات كل 5 دقائق.", "Data is collected every 5 minutes."))); return; }
    if (first || !geo) { const q = P.get("geo"); geo = q === "world" || data.by.has(q) ? q : guessGeo([...data.by.keys()]); }
    if (geo !== "world" && !data.by.has(geo)) geo = "world";
    updatedEl.textContent = data.updated ? L("آخر تحديث ", "updated ") + ago(data.updated) : "";
    drawNav(); geo === "world" ? drawWorld() : drawGeo();
    chrome.setLiveState("polling", data.updated ? new Date(data.updated) : null);
  } catch (e) {
    console.error(e);
    if (first) body.replaceChildren(h("div", { class: "state" }, h("h3", {}, L("تعذّر تحميل الترند", "Could not load trends")),
      h("button", { class: "btn", type: "button", onclick: () => loadTrends(true) }, L("إعادة المحاولة", "Try again"))));
    else toast(L("تعذّر تحديث الترند الآن", "Could not refresh trends"));
  }
}
async function loadEvents() {
  try {
    const [events, sources] = await Promise.all([fetchGlobalEvents({ limit: 40, ownLang: true }), loadSources()]);
    // "talked about" = covered by the most independent publishers, newest first among equals
    const top = [...events].sort((a, b) => b.independent_count - a.independent_count || b.score - a.score).slice(0, 8);
    eventsEl.replaceChildren(...(top.length ? top.map((e) => eventCard(e, sources, { rank: false })) : [h("li", { class: "note" }, L("لا أحداث مرتّبة الآن.", "No ranked events right now."))]));
  } catch { eventsEl.replaceChildren(h("li", { class: "note" }, L("تعذّر تحميل الأحداث.", "Could not load events."))); }
}

root.replaceChildren(
  h("div", { class: "section-head" }, h("h1", {}, L("ترند الآن حول العالم", "Trending worldwide")), updatedEl),
  h("p", { class: "tr-lede" }, L("ما يبحث عنه الناس الآن في كل دولة، وما تتناقله غرف الأخبار حول العالم — يتحدّث تلقائياً.", "What people are searching for in each country, and what the world's newsrooms are covering most — updated automatically.")),
  geoNav, body,
  h("div", { class: "section-head" }, h("h2", {}, L("حديث غرف الأخبار الآن", "What newsrooms are covering now")), h("a", { class: "meta", href: "breaking.html" }, L("الترتيب العالمي الكامل ←", "Full global ranking →"))),
  eventsEl);

if (configured) {
  loadTrends(true); loadEvents();
  setInterval(() => { if (document.visibilityState === "visible") { loadTrends(); loadEvents(); } }, 120_000);
  chrome.refreshTicker().catch(() => {});
} else body.replaceChildren(h("div", { class: "state" }, L("الموقع غير مهيأ.", "Site not configured.")));
