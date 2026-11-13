// Weather page (weather.html): the reader's place in full (now, 24 hours, 7 days), other saved places,
// and the weather right now in major cities of every region. Data: Open-Meteo (see weather.js).
import { sb, h, configured, ARTICLE_COLS, loadSources } from "./common.js";
import { renderChrome } from "./layout.js";
import { EN, L, langFilter, flag } from "./i18n.js";
import { card } from "./cards.js";
import { loadPlaces, forecast, currentMany, describe, nowBlock, factsRow, hoursRow, daysList, updatedLine, placePicker, selectPlace } from "./weather.js";

const chrome = renderChrome({ active: "weather" });
const root = document.getElementById("app");
document.title = L("الطقس — لحظة", "Weather — Lahza");

// [Arabic, English, ISO country, lat, lon] — one or two big cities per world region
const WORLD = [
  ["مكة المكرمة", "Makkah", "SA", 21.43, 39.83], ["الرياض", "Riyadh", "SA", 24.71, 46.68], ["القاهرة", "Cairo", "EG", 30.04, 31.24], ["دبي", "Dubai", "AE", 25.2, 55.27],
  ["القدس", "Jerusalem", "PS", 31.78, 35.22], ["عمّان", "Amman", "JO", 31.95, 35.93], ["بغداد", "Baghdad", "IQ", 33.31, 44.37], ["الدار البيضاء", "Casablanca", "MA", 33.57, -7.59],
  ["إسطنبول", "Istanbul", "TR", 41.01, 28.98], ["لندن", "London", "GB", 51.51, -0.13], ["باريس", "Paris", "FR", 48.85, 2.35], ["برلين", "Berlin", "DE", 52.52, 13.4],
  ["موسكو", "Moscow", "RU", 55.75, 37.62], ["نيويورك", "New York", "US", 40.71, -74.01], ["لوس أنجلوس", "Los Angeles", "US", 34.05, -118.24], ["ساو باولو", "São Paulo", "BR", -23.55, -46.63],
  ["لاغوس", "Lagos", "NG", 6.45, 3.39], ["جوهانسبرغ", "Johannesburg", "ZA", -26.2, 28.05], ["نيودلهي", "New Delhi", "IN", 28.61, 77.21], ["بكين", "Beijing", "CN", 39.9, 116.4],
  ["طوكيو", "Tokyo", "JP", 35.68, 139.69], ["جاكرتا", "Jakarta", "ID", -6.21, 106.85], ["سيدني", "Sydney", "AU", -33.87, 151.21], ["مكسيكو سيتي", "Mexico City", "MX", 19.43, -99.13],
];

const main = h("section", { class: "wx-full" }, h("ul", { class: "skeleton", "aria-hidden": "true" }, h("li"), h("li")));
const world = h("div", { class: "wx-world" }, h("p", { class: "note" }, L("جارٍ تحميل طقس المدن…", "Loading cities…")));
const news = h("section", { class: "sp-news" });
let state = null;

async function draw(force = false) {
  try {
    state = state || await loadPlaces();
    const p = state.places[state.active];
    const res = await forecast(p, { force });
    main.replaceChildren(
      h("div", { class: "wx-hero" }, nowBlock(p, res.data), factsRow(res.data)),
      h("h2", { class: "wx-h" }, L("الساعات الأربع والعشرون القادمة", "Next 24 hours")), hoursRow(res.data, 24),
      h("h2", { class: "wx-h" }, L("توقعات سبعة أيام", "7-day forecast")), daysList(res.data, 0, 7),
      updatedLine(res));
    chrome.setLiveState("polling", new Date(res.at));
  } catch {
    main.replaceChildren(h("div", { class: "state" }, h("h3", {}, L("تعذّر تحميل الطقس", "Weather is unavailable")),
      h("button", { class: "btn", type: "button", onclick: () => draw(true) }, L("إعادة المحاولة", "Try again"))));
  }
}

async function drawWorld() {
  try {
    const rows = await currentMany(WORLD.map(([, , , lat, lon]) => ({ lat, lon })));
    world.replaceChildren(h("ul", { class: "wx-grid" }, WORLD.map(([ar, en, cc, lat, lon], i) => {
      const c = rows[i]?.current; if (!c) return null;
      const w = describe(c.weather_code, c.is_day !== 0);
      return h("li", {}, h("button", { type: "button", title: L("عرض توقعات ", "Show forecast for ") + (EN ? en : ar), onclick: () => { state = selectPlace({ name: EN ? en : ar, admin: "", cc, lat, lon }); picker.replaceWith(picker = makePicker()); draw(); scrollTo({ top: 0, behavior: "smooth" }); } },
        h("span", { class: "c" }, flag(cc), " ", EN ? en : ar), h("span", { class: "i", title: w.label, "aria-label": w.label }, w.icon), h("b", { class: "num" }, Math.round(c.temperature_2m) + "°")));
    })));
  } catch { world.replaceChildren(h("p", { class: "note" }, L("تعذّر تحميل طقس المدن الآن.", "City weather is unavailable right now."))); }
}

async function drawNews() {
  if (!configured) return;
  try {
    const [{ data, error }, srcs] = await Promise.all([
      langFilter(sb.from("news_articles").select(ARTICLE_COLS).eq("status", "published").is("duplicate_of", null).contains("categories", ["weather"]))
        .order("published_at", { ascending: false }).limit(6), loadSources()]);
    if (error || !data?.length) return;
    news.replaceChildren(h("div", { class: "section-head" }, h("h2", {}, L("أخبار الطقس", "Weather news")), h("a", { class: "meta", href: "index.html?cat=weather" }, L("المزيد ←", "More →"))),
      h("ul", { class: "feed" }, data.map((a) => card(a, srcs.get(a.source_id)))));
  } catch { /* the page works without the news list */ }
}

const makePicker = () => placePicker((s) => { state = s; draw(); });
let picker = makePicker();
root.replaceChildren(
  h("div", { class: "section-head" }, h("h1", {}, L("الطقس", "Weather")), h("span", { class: "meta" }, L("مدينتك وأي مدينة في العالم، محدّث كل 10 دقائق", "Your city and any city in the world, refreshed every 10 minutes"))),
  picker, main,
  h("div", { class: "section-head" }, h("h2", {}, L("الطقس الآن حول العالم", "Weather now around the world"))), world, news);

draw(); drawWorld(); drawNews();
setInterval(() => { if (document.visibilityState === "visible") { draw(); drawWorld(); } }, 10 * 60_000 + 5_000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") draw(); });
chrome.refreshTicker().catch(() => {});
