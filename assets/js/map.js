// World news map (map.html): countries shaded by how many stories mention them first, by theme and period.
// Tap a country (or pick it in the ranked list) to see its most important recent stories.
// Country tags come from the ingest gazetteer; the map is drawn per country — no event coordinates are invented.
import { sb, h, configured, ARTICLE_COLS, loadSources, friendlyError } from "./common.js";
import { renderChrome } from "./layout.js";
import { EN, L, langFilter, countryName, flag, isCountry } from "./i18n.js";
import { card } from "./cards.js";
import { followButton } from "./saved.js";
import { toast } from "./common.js";

const chrome = renderChrome({ active: "map" });
const root = document.getElementById("app");
document.title = L("خريطة الأخبار العالمية — لحظة", "World news map — Lahza");
const P = new URLSearchParams(location.search);
const THEMES = [["all", L("كل الأخبار", "All news")], ["conflict", L("نزاعات وأمن", "Conflict & security")], ["disaster", L("كوارث وطوارئ", "Disasters & emergencies")],
  ["politics", L("سياسة وانتخابات", "Politics & elections")], ["economy", L("اقتصاد وطاقة", "Economy & energy")], ["tech", L("تكنولوجيا وعلوم", "Tech & science")]];
const PERIODS = [[6, L("6 ساعات", "6 h")], [24, L("24 ساعة", "24 h")], [168, L("7 أيام", "7 days")]];
let theme = THEMES.some(([k]) => k === P.get("theme")) ? P.get("theme") : "all";
let hours = [6, 24, 168].includes(Number(P.get("h"))) ? Number(P.get("h")) : 24;
let selected = isCountry(P.get("country")) ? P.get("country") : null;
let counts = new Map(), maxN = 1, shapes = null, svg = null;
const VB = [0, 0, 960, 500];

const controls = h("div", { class: "map-controls" });
const mapBox = h("div", { class: "map-box" }, h("div", { class: "map-loading" }, L("جارٍ تحميل الخريطة…", "Loading map…")));
const legend = h("div", { class: "map-legend" });
const panel = h("section", { class: "map-panel", "aria-live": "polite" });
const list = h("ol", { class: "map-rank" });
const meta = h("span", { class: "meta" });
root.replaceChildren(
  h("div", { class: "section-head" }, h("h1", { class: "map-h1" }, L("خريطة الأخبار العالمية", "World news map")), meta),
  controls, h("div", { class: "map-grid" }, h("div", {}, mapBox, legend), panel),
  h("section", {}, h("div", { class: "section-head" }, h("h2", {}, L("الدول الأكثر حضوراً في الأخبار", "Countries most in the news"))), list),
  h("p", { class: "note" }, L("تُنسب كل قصة إلى أول دولة يذكرها الخبر بحسب التصنيف الآلي، وقد يخطئ التصنيف أحياناً. الحدود للتوضيح فقط (Natural Earth).",
    "Each story counts for the first country it is tagged with by the automatic classifier, which can be wrong. Borders are illustrative only (Natural Earth).")));

const seg = (opts, cur, pick) => h("div", { class: "seg", role: "group" }, opts.map(([v, t]) => h("button", { type: "button", "aria-pressed": String(String(v) === String(cur)), onclick: () => pick(v) }, t)));
function drawControls() {
  controls.replaceChildren(
    h("div", { class: "map-themes" }, seg(THEMES, theme, (v) => { theme = v; sync(); load(); })),
    seg(PERIODS, hours, (v) => { hours = v; sync(); load(); }));
}
function sync() {
  const u = new URL(location.href);
  theme === "all" ? u.searchParams.delete("theme") : u.searchParams.set("theme", theme);
  hours === 24 ? u.searchParams.delete("h") : u.searchParams.set("h", hours);
  selected ? u.searchParams.set("country", selected) : u.searchParams.delete("country");
  history.replaceState(null, "", u);
  drawControls();
}

// 5 shading steps on a square-root scale (a handful of countries dominate the raw counts)
const step = (n) => (!n ? 0 : Math.min(5, 1 + Math.floor(4 * Math.sqrt(n / maxN))));

async function loadShapes() {
  const r = await fetch("assets/world-map.json", { cache: "force-cache" });
  if (!r.ok) throw new Error("map " + r.status);
  return r.json();
}

function drawMap() {
  const NS = "http://www.w3.org/2000/svg";
  svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", VB.join(" ")); svg.setAttribute("class", "world");
  svg.setAttribute("role", "img"); svg.setAttribute("aria-label", L("خريطة العالم ملوّنة حسب عدد الأخبار", "World map shaded by number of stories"));
  for (const [iso, d] of Object.entries(shapes.countries)) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d); p.dataset.iso = iso;
    const t = document.createElementNS(NS, "title"); p.append(t);
    svg.append(p);
  }
  svg.addEventListener("click", (e) => { const p = e.target.closest("path[data-iso]"); if (p) select(p.dataset.iso); });
  mapBox.replaceChildren(svg,
    h("button", { class: "btn map-reset", type: "button", hidden: true, onclick: () => select(null) }, L("عرض العالم", "Whole world")));
}

function paint() {
  if (!svg) return;
  for (const p of svg.querySelectorAll("path")) {
    const c = counts.get(p.dataset.iso);
    p.dataset.s = step(c?.n);
    p.classList.toggle("brk", !!c?.breaking);
    p.classList.toggle("sel", p.dataset.iso === selected);
    p.firstChild.textContent = `${countryName(p.dataset.iso)}: ${c?.n || 0} ${L("خبر", "stories")}`;
  }
  zoomTo(selected);
}

function zoomTo(iso) {
  const p = iso && svg?.querySelector(`path[data-iso="${iso}"]`);
  let vb = VB;
  if (p) {
    const b = p.getBBox();
    const w = Math.max(b.width, 120) * 2.2, hgt = Math.max(w / 1.92, b.height * 2.2);
    vb = [Math.max(0, b.x + b.width / 2 - w / 2), Math.max(0, b.y + b.height / 2 - hgt / 2), Math.min(w, 960), Math.min(hgt, 500)];
  }
  svg.setAttribute("viewBox", vb.map((x) => x.toFixed(1)).join(" "));
  mapBox.querySelector(".map-reset").hidden = !p;
}

function drawLegend() {
  legend.replaceChildren(h("span", {}, L("أقل", "Fewer")), ...[1, 2, 3, 4, 5].map((s) => h("i", { class: "sw", dataset: { s } })), h("span", {}, L("أكثر", "More")),
    h("i", { class: "sw brk-sw" }), h("span", {}, L("عاجل الآن", "Breaking now")));
}

function drawList() {
  const rows = [...counts.values()].filter((c) => isCountry(c.country)).slice(0, 20);
  list.replaceChildren(...(rows.length ? rows.map((c) => h("li", {},
    h("button", { type: "button", class: "map-row" + (c.country === selected ? " on" : ""), onclick: () => { select(c.country); panel.scrollIntoView({ behavior: "smooth", block: "nearest" }); } },
      h("span", { class: "fl", "aria-hidden": "true" }, flag(c.country)), h("span", { class: "nm" }, countryName(c.country)),
      c.breaking ? h("span", { class: "chip breaking" }, L("عاجل", "Breaking")) : h("span", { "aria-hidden": "true" }),
      h("span", { class: "bar", style: `--w:${Math.round(100 * c.n / maxN)}%` }), h("b", { class: "num" }, c.n))))
    : [h("li", { class: "note" }, L("لا أخبار في هذا التصنيف خلال الفترة المختارة.", "No stories in this theme for the selected period."))]));
}

async function drawPanel() {
  if (!selected) {
    panel.replaceChildren(h("h2", {}, L("اختر دولة", "Pick a country")),
      h("p", { class: "note" }, L("اضغط على أي دولة في الخريطة أو في القائمة لعرض أهم أخبارها.", "Tap a country on the map or in the list to see its top stories.")));
    return;
  }
  const c = counts.get(selected);
  panel.replaceChildren(h("h2", {}, flag(selected), " ", countryName(selected)),
    h("p", { class: "note" }, c ? L(`${c.n} خبر خلال الفترة المختارة`, `${c.n} stories in the selected period`) : L("لا أخبار ضمن هذا التصنيف والفترة.", "No stories for this theme and period.")),
    h("ul", { class: "skeleton", "aria-hidden": "true" }, h("li"), h("li")));
  const want = selected;
  try {
    const since = new Date(Date.now() - hours * 3600e3).toISOString();
    const [{ data, error }, srcs] = await Promise.all([
      langFilter(sb.from("news_articles").select(ARTICLE_COLS).eq("status", "published").is("duplicate_of", null)
        .contains("countries", [selected]).gt("published_at", since))
        .order("importance", { ascending: false }).order("published_at", { ascending: false }).limit(8),
      loadSources()]);
    if (error) throw error;
    if (want !== selected) return;
    panel.querySelector(".skeleton")?.replaceWith(data.length ? h("ul", { class: "feed compact" }, data.map((a) => card(a, srcs.get(a.source_id))))
      : h("p", { class: "note" }, L("لا قصص بلغة هذه النسخة لهذه الدولة الآن.", "No stories in this edition's language for this country right now.")));
    panel.append(h("div", { class: "toolbar" },
      h("a", { class: "btn", href: `index.html?country=${selected}` }, L("كل أخبار ", "All news: "), countryName(selected)),
      h("a", { class: "btn", href: `breaking.html?country=${selected}` }, L("العاجل في ", "Breaking: "), countryName(selected)),
      followButton("countries", selected, countryName(selected), toast)));
  } catch (e) { panel.querySelector(".skeleton")?.replaceWith(h("p", { class: "note" }, friendlyError(e))); }
}

function select(iso) {
  selected = iso && isCountry(iso) ? iso : null;
  sync(); paint(); drawList(); drawPanel();
}

let timer = null;
async function load() {
  clearTimeout(timer);
  meta.textContent = L("جارٍ التحديث…", "Updating…");
  const { data, error } = await sb.rpc("news_map_counts", { p_hours: hours, p_theme: theme === "all" ? null : theme });
  if (error) { meta.textContent = friendlyError(error); chrome.setLiveState("offline"); timer = setTimeout(load, 60e3); return; }
  counts = new Map(data.map((r) => [r.country, { country: r.country, n: Number(r.n), breaking: Number(r.breaking) }]));
  maxN = Math.max(1, ...[...counts.values()].map((c) => c.n));
  const total = [...counts.values()].reduce((s, c) => s + c.n, 0);
  meta.textContent = EN ? `${total} stories · ${counts.size} countries` : `${total} خبر · ${counts.size} دولة`;
  chrome.setLiveState("polling", new Date());
  paint(); drawList(); drawPanel();
  timer = setTimeout(load, 300e3);
}

async function boot() {
  drawControls(); drawLegend();
  if (!configured) return;
  try { shapes = await loadShapes(); drawMap(); }
  catch { mapBox.replaceChildren(h("div", { class: "state" }, L("تعذّر تحميل الخريطة؛ القائمة أدناه تعمل.", "The map could not load; the list below still works."))); }
  await load();
  chrome.refreshTicker().catch(() => {});
}
boot();
