// Weather for the reader's own place (home-page panel + weather.html).
// Place: the reader's saved choice, else the city of the device time zone (no IP lookup, nothing sent to us);
// "My location" asks the browser for coordinates only when pressed; any city / region / country can be searched.
// Data: Open-Meteo forecast + geocoding APIs — free, no key, CORS-enabled. The forecast is cached per place for
// 10 minutes and refreshed every 10 minutes while the page is visible (the provider updates every 15 minutes).
import { h, store } from "./common.js";
import { EN, L, flag, countryName, isCountry } from "./i18n.js";

const LANG = EN ? "en" : "ar";
const TTL = 10 * 60_000;
const KEY = "lahza-wx-places-v2";
const FALLBACK = { name: L("عمّان", "Amman"), admin: "", cc: "JO", lat: 31.95, lon: 35.93 };

// WMO weather codes → label + icon (day / night)
const WMO = [
  [[0], "صحو", "Clear", "☀️", "🌙"], [[1], "صحو غالباً", "Mostly clear", "🌤️", "🌙"], [[2], "غائم جزئياً", "Partly cloudy", "⛅", "☁️"], [[3], "غائم", "Overcast", "☁️", "☁️"],
  [[45, 48], "ضباب", "Fog", "🌫️", "🌫️"], [[51, 53, 55, 56, 57], "رذاذ", "Drizzle", "🌦️", "🌧️"], [[61, 63, 80, 81], "أمطار", "Rain", "🌧️", "🌧️"],
  [[65, 82], "أمطار غزيرة", "Heavy rain", "🌧️", "🌧️"], [[66, 67], "أمطار متجمدة", "Freezing rain", "🌨️", "🌨️"], [[71, 73, 75, 77, 85, 86], "ثلوج", "Snow", "❄️", "❄️"],
  [[95], "عاصفة رعدية", "Thunderstorm", "⛈️", "⛈️"], [[96, 99], "عاصفة رعدية مع برد", "Thunderstorm with hail", "⛈️", "⛈️"],
];
export function describe(code, isDay = true) {
  for (const [codes, ar, en, day, night] of WMO) if (codes.includes(code)) return { label: EN ? en : ar, icon: isDay ? day : night };
  return { label: "—", icon: "🌡️" };
}
const n0 = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? "–" : String(Math.round(Number(v))));
const deg = (v) => n0(v) + "°";
const WEEKDAY = new Intl.DateTimeFormat(EN ? "en-GB" : "ar-JO-u-nu-latn", { weekday: "long", timeZone: "UTC" });
const dayName = (ymd, i) => (i === 0 ? L("اليوم", "Today") : i === 1 ? L("غداً", "Tomorrow") : WEEKDAY.format(new Date(ymd + "T12:00:00Z")));
const hhmm = (iso) => String(iso || "").slice(11, 16);
const clock = (t) => new Intl.DateTimeFormat(EN ? "en-GB" : "ar-JO-u-nu-latn", { hour: "numeric", minute: "2-digit" }).format(t);

// ---------- places ----------
export function placeLabel(p) {
  const where = [p.admin && p.admin !== p.name ? p.admin : null, isCountry(p.cc) ? countryName(p.cc) : p.country || null].filter(Boolean).join("، ");
  return { title: p.gps ? L("موقعي الحالي", "My location") : p.name, where, flag: isCountry(p.cc) ? flag(p.cc) : "📍" };
}
function readState() {
  try { const s = JSON.parse(store.get(KEY) || "null"); if (s && Array.isArray(s.places) && s.places.length) return { places: s.places.slice(0, 6), active: Math.min(Math.max(0, s.active | 0), s.places.length - 1) }; } catch { /* ignore */ }
  return null;
}
const writeState = (s) => store.set(KEY, JSON.stringify(s));
const same = (a, b) => Math.abs(a.lat - b.lat) < 0.02 && Math.abs(a.lon - b.lon) < 0.02;

/** Add (or select) a place and make it the active one. At most 6 are kept. */
export function selectPlace(p) {
  const s = readState() || { places: [], active: 0 };
  let i = s.places.findIndex((x) => same(x, p));
  if (i < 0) { s.places.unshift(p); s.places = s.places.slice(0, 6); i = 0; }
  s.active = i; writeState(s);
  return s;
}
export function removePlace(i) {
  const s = readState(); if (!s) return null;
  s.places.splice(i, 1);
  if (!s.places.length) { store.set(KEY, ""); return null; }
  s.active = Math.min(s.active, s.places.length - 1); writeState(s);
  return s;
}

async function getJson(u) {
  const r = await fetch(u, { signal: AbortSignal.timeout(10_000), credentials: "omit", referrerPolicy: "no-referrer" });
  if (!r.ok) throw new Error("weather " + r.status);
  return r.json();
}
const toPlace = (g) => ({ name: g.name, admin: g.admin1 || "", cc: g.country_code || "", country: g.country || "", lat: +g.latitude.toFixed(3), lon: +g.longitude.toFixed(3) });

/** Cities / regions matching a name, in the page language (Open-Meteo geocoding). */
export async function searchPlaces(q, count = 8) {
  const u = new URL("https://geocoding-api.open-meteo.com/v1/search");
  u.searchParams.set("name", q); u.searchParams.set("count", String(count)); u.searchParams.set("language", LANG); u.searchParams.set("format", "json");
  const j = await getJson(u);
  return (j.results || []).map((g) => ({ ...toPlace(g), tz: g.timezone, pop: g.population || 0 }));
}

/** First visit: the main city of the device time zone ("Asia/Amman" → Amman), found by name in that zone. */
async function guessPlace() {
  let tz = "";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { /* ignore */ }
  const city = tz.split("/").pop()?.replace(/_/g, " ");
  if (!city || !tz.includes("/")) return FALLBACK;
  try {
    const u = new URL("https://geocoding-api.open-meteo.com/v1/search");
    u.searchParams.set("name", city); u.searchParams.set("count", "10"); u.searchParams.set("language", LANG); u.searchParams.set("format", "json");
    const list = (await getJson(u)).results || [];
    const hit = list.filter((g) => g.timezone === tz).sort((a, b) => (b.population || 0) - (a.population || 0))[0];
    return hit ? toPlace(hit) : FALLBACK;
  } catch { return FALLBACK; }
}

/** The saved places, creating the first one from the time zone when nothing is saved yet. */
export async function loadPlaces() {
  const s = readState();
  if (s) return s;
  return selectPlace(await guessPlace());
}

/** Browser geolocation (asked only on the reader's click). Coordinates are rounded to ~1 km and stay in this browser. */
export function locateMe() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("unsupported"));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ name: L("موقعي الحالي", "My location"), admin: "", cc: "", gps: true, lat: +pos.coords.latitude.toFixed(2), lon: +pos.coords.longitude.toFixed(2) }),
      (e) => reject(e), { enableHighAccuracy: false, timeout: 10_000, maximumAge: 15 * 60_000 });
  });
}

// ---------- forecast ----------
const mem = new Map();
const fkey = (p) => `lahza-wx:${p.lat},${p.lon}`;
/** Current conditions + next 24 hours + 7 days for one place. Returns { data, at, stale }. */
export async function forecast(p, { force = false } = {}) {
  const k = fkey(p);
  let c = mem.get(k);
  if (!c) { try { c = JSON.parse(sessionStorage.getItem(k) || "null"); } catch { c = null; } }
  if (!force && c && Date.now() - c.at < TTL) return { data: c.data, at: c.at, stale: false };
  const u = new URL("https://api.open-meteo.com/v1/forecast");
  u.searchParams.set("latitude", p.lat); u.searchParams.set("longitude", p.lon);
  u.searchParams.set("current", "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation,is_day");
  u.searchParams.set("hourly", "temperature_2m,weather_code,precipitation_probability,is_day");
  u.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max");
  u.searchParams.set("timezone", "auto"); u.searchParams.set("forecast_days", "7"); u.searchParams.set("forecast_hours", "24");
  try {
    const data = await getJson(u);
    c = { at: Date.now(), data };
    mem.set(k, c);
    try { sessionStorage.setItem(k, JSON.stringify(c)); } catch { /* ignore */ }
    return { data, at: c.at, stale: false };
  } catch (e) {
    if (c) return { data: c.data, at: c.at, stale: true };
    throw e;
  }
}

/** Current temperature and sky for several places in one request (world cities grid). */
export async function currentMany(places) {
  const u = new URL("https://api.open-meteo.com/v1/forecast");
  u.searchParams.set("latitude", places.map((p) => p.lat).join(",")); u.searchParams.set("longitude", places.map((p) => p.lon).join(","));
  u.searchParams.set("current", "temperature_2m,weather_code,is_day"); u.searchParams.set("timezone", "auto");
  const j = await getJson(u);
  return Array.isArray(j) ? j : [j];
}

// ---------- shared pieces ----------
export function nowBlock(p, d) {
  const c = d.current, w = describe(c.weather_code, c.is_day !== 0), lab = placeLabel(p);
  return h("div", { class: "wx-now" },
    h("span", { class: "wx-icon", "aria-hidden": "true" }, w.icon),
    h("div", { class: "wx-main" },
      h("b", { class: "wx-temp num" }, deg(c.temperature_2m)),
      h("div", { class: "wx-sky" }, w.label, " · ", L("المحسوسة ", "feels like "), h("span", { class: "num" }, deg(c.apparent_temperature)))),
    h("div", { class: "wx-place" }, h("b", {}, lab.flag, " ", lab.title), lab.where ? h("span", {}, lab.where) : null));
}
export function factsRow(d) {
  const c = d.current, day = d.daily;
  const fact = (k, v) => h("div", { class: "wx-fact" }, h("span", {}, k), h("b", { class: "num" }, v));
  return h("div", { class: "wx-facts" },
    fact(L("الرطوبة", "Humidity"), n0(c.relative_humidity_2m) + "%"),
    fact(L("الرياح", "Wind"), n0(c.wind_speed_10m) + L(" كم/س", " km/h")),
    fact(L("احتمال المطر", "Rain chance"), n0(day.precipitation_probability_max?.[0]) + "%"),
    day.uv_index_max?.[0] != null ? fact(L("الأشعة فوق البنفسجية", "UV index"), n0(day.uv_index_max[0])) : null,
    day.sunrise?.[0] ? fact(L("الشروق / الغروب", "Sunrise / sunset"), hhmm(day.sunrise[0]) + " / " + hhmm(day.sunset[0])) : null);
}
export function hoursRow(d, count = 24) {
  const hr = d.hourly;
  return h("ol", { class: "wx-hours", "aria-label": L("الساعات القادمة", "Next hours") }, hr.time.slice(0, count).map((t, i) => {
    const w = describe(hr.weather_code[i], hr.is_day?.[i] !== 0);
    return h("li", {}, h("span", { class: "num" }, i === 0 ? L("الآن", "Now") : hhmm(t)), h("span", { title: w.label, "aria-label": w.label }, w.icon), h("b", { class: "num" }, deg(hr.temperature_2m[i])),
      hr.precipitation_probability?.[i] >= 30 ? h("span", { class: "wx-rain num" }, "💧" + n0(hr.precipitation_probability[i]) + "%") : h("span", { class: "wx-rain" }));
  }));
}
export function daysList(d, from = 0, count = 7) {
  const day = d.daily;
  return h("ul", { class: "wx-days" }, day.time.slice(from, from + count).map((t, j) => {
    const i = from + j, w = describe(day.weather_code[i]);
    return h("li", {}, h("span", {}, dayName(t, i)), h("span", { title: w.label, "aria-label": w.label }, w.icon),
      day.precipitation_probability_max?.[i] >= 30 ? h("span", { class: "wx-rain num" }, "💧" + n0(day.precipitation_probability_max[i]) + "%") : h("span"),
      h("span", { class: "num wx-range" }, h("b", {}, deg(day.temperature_2m_max[i])), " / ", deg(day.temperature_2m_min[i])));
  }));
}
export function updatedLine(res) {
  return h("p", { class: "note wx-upd" }, res.stale ? L("تعذّر التحديث الآن — آخر قراءة: ", "Could not refresh — last reading: ") : L("آخر تحديث: ", "Updated: "), h("b", { class: "num" }, clock(res.at)),
    " · ", L("البيانات: ", "Data: "), h("a", { href: "https://open-meteo.com/", target: "_blank", rel: "noopener noreferrer" }, "Open-Meteo"));
}

/** Search box + "my location" + saved places. Calls onChange(state) after every choice. */
export function placePicker(onChange, { compact = false } = {}) {
  const results = h("ul", { class: "wx-results", hidden: true });
  const input = h("input", { type: "search", id: "wxq" + (compact ? "c" : ""), maxlength: "60", autocomplete: "off", placeholder: L("ابحث عن مدينة أو منطقة أو دولة…", "Search a city, region or country…") });
  const msg = h("p", { class: "note", hidden: true, role: "status" });
  const chips = h("div", { class: "wx-chips" });
  let timer = 0, seq = 0;
  const say = (t) => { msg.hidden = !t; msg.textContent = t || ""; };
  const pick = (p) => { results.hidden = true; input.value = ""; say(""); const s = selectPlace(p); drawChips(s); onChange(s); };
  function drawChips(s = readState()) {
    chips.replaceChildren(...(s ? s.places.map((p, i) => { const lab = placeLabel(p);
      return h("span", { class: "wx-chip", "aria-current": i === s.active ? "true" : null },
        h("button", { type: "button", onclick: () => pick(p) }, lab.flag, " ", lab.title),
        s.places.length > 1 ? h("button", { type: "button", class: "x", "aria-label": L("إزالة ", "Remove ") + lab.title, onclick: () => { const n = removePlace(i); drawChips(n); if (n) onChange(n); } }, "×") : null); }) : []));
  }
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { results.hidden = true; return; }
    timer = setTimeout(async () => {
      const my = ++seq;
      try {
        const list = await searchPlaces(q);
        if (my !== seq) return;
        results.hidden = false;
        results.replaceChildren(...(list.length ? list.map((p) => { const lab = placeLabel(p);
          return h("li", {}, h("button", { type: "button", onclick: () => pick({ name: p.name, admin: p.admin, cc: p.cc, country: p.country, lat: p.lat, lon: p.lon }) }, h("b", {}, lab.flag, " ", p.name), lab.where ? h("span", {}, lab.where) : null)); })
          : [h("li", { class: "note" }, L("لا نتائج. جرّب اسماً آخر أو اكتبه بالإنجليزية.", "No results. Try another spelling."))]));
      } catch { if (my === seq) { results.hidden = true; say(L("تعذّر البحث الآن.", "Search is unavailable right now.")); } }
    }, 300);
  });
  const gps = h("button", { class: "btn", type: "button", onclick: async () => {
    gps.disabled = true; say(L("جارٍ تحديد موقعك…", "Finding your location…"));
    try { pick(await locateMe()); }
    catch (e) { say(e?.code === 1 ? L("لم يُسمح بتحديد الموقع. يمكنك البحث عن مدينتك بالاسم.", "Location permission was not granted. Search for your city instead.") : L("تعذّر تحديد الموقع. ابحث عن مدينتك بالاسم.", "Could not get your location. Search for your city instead.")); }
    finally { gps.disabled = false; }
  } }, "📍 ", L("موقعي", "My location"));
  drawChips();
  return h("div", { class: "wx-picker" + (compact ? " compact" : "") },
    h("div", { class: "wx-search" }, h("label", { class: "sr-only", for: input.id }, L("ابحث عن مدينة", "Search a city")), input, gps),
    results, msg, chips);
}

/** Home-page panel: the reader's place now, the next hours and three days; refreshes every 10 minutes. */
export function weatherPanel() {
  const body = h("div", { class: "wx" }, h("p", { class: "note" }, L("جارٍ تحميل الطقس…", "Loading weather…")));
  const head = h("h2", {}, L("الطقس الآن", "Weather now"));
  let state = null, pickerOpen = false;
  const picker = h("div", { hidden: true });
  const toggle = h("button", { class: "btn wx-change", type: "button", "aria-expanded": "false", onclick: () => {
    pickerOpen = !pickerOpen; toggle.setAttribute("aria-expanded", String(pickerOpen)); picker.hidden = !pickerOpen;
    if (pickerOpen && !picker.firstChild) picker.append(placePicker((s) => { state = s; draw(true); }, { compact: true }));
    if (pickerOpen) picker.querySelector("input")?.focus();
  } }, L("تغيير المدينة", "Change city"));
  const panel = h("section", { class: "panel wx-panel", "aria-label": L("الطقس", "Weather") },
    h("div", { class: "wx-head" }, head, toggle), picker, body,
    h("p", { class: "note" }, h("a", { href: "weather.html" }, L("التوقعات الكاملة وطقس العالم ←", "Full forecast & world weather →")), " · ", h("a", { href: "index.html?cat=weather" }, L("أخبار الطقس", "Weather news"))));

  async function draw(force = false) {
    try {
      state = state || await loadPlaces();
      const p = state.places[state.active];
      const res = await forecast(p, { force });
      body.replaceChildren(nowBlock(p, res.data), factsRow(res.data), hoursRow(res.data, 8), daysList(res.data, 1, 3), updatedLine(res));
    } catch { body.replaceChildren(h("p", { class: "note" }, L("تعذّر تحميل الطقس حالياً.", "Weather is unavailable right now."))); }
  }
  draw();
  setInterval(() => { if (document.visibilityState === "visible") draw(); }, TTL + 5_000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") draw(); });
  return panel;
}
