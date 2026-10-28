// Jordan weather panel (home page). Data: Open-Meteo forecast API — free, no key, CORS-enabled.
// Cached per browser for 30 minutes so the API is called at most twice an hour per visitor.
import { h } from "./common.js";

const CITIES = [
  { name: "عمّان", lat: 31.95, lon: 35.93 },
  { name: "إربد", lat: 32.56, lon: 35.85 },
  { name: "الزرقاء", lat: 32.07, lon: 36.09 },
  { name: "العقبة", lat: 29.53, lon: 35.01 },
  { name: "الكرك", lat: 31.18, lon: 35.70 },
];
const CACHE_KEY = "lahza-weather-v1";
const TTL = 30 * 60_000;

// WMO weather codes → Arabic label + emoji
const WMO = [
  [[0], "صحو", "☀️"], [[1], "صحو غالباً", "🌤️"], [[2], "غائم جزئياً", "⛅"], [[3], "غائم", "☁️"],
  [[45, 48], "ضباب", "🌫️"], [[51, 53, 55, 56, 57], "رذاذ", "🌦️"], [[61, 63, 80, 81], "أمطار", "🌧️"],
  [[65, 82], "أمطار غزيرة", "🌧️"], [[66, 67], "أمطار متجمدة", "🌨️"], [[71, 73, 75, 77, 85, 86], "ثلوج", "❄️"],
  [[95], "عاصفة رعدية", "⛈️"], [[96, 99], "عاصفة رعدية مع برد", "⛈️"],
];
export function describe(code) {
  for (const [codes, label, icon] of WMO) if (codes.includes(code)) return { label, icon };
  return { label: "—", icon: "🌡️" };
}

const DAY = new Intl.DateTimeFormat("ar", { weekday: "long", timeZone: "Asia/Amman" });
const num = (n) => Math.round(n).toLocaleString("ar-EG");

async function load() {
  try {
    const c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
    if (c && Date.now() - c.at < TTL) return c.data;
  } catch { /* storage unavailable */ }
  const u = new URL("https://api.open-meteo.com/v1/forecast");
  u.searchParams.set("latitude", CITIES.map((c) => c.lat).join(","));
  u.searchParams.set("longitude", CITIES.map((c) => c.lon).join(","));
  u.searchParams.set("current", "temperature_2m,weather_code,wind_speed_10m");
  u.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max");
  u.searchParams.set("timezone", "Asia/Amman");
  u.searchParams.set("forecast_days", "4");
  const r = await fetch(u, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error("weather " + r.status);
  let data = await r.json();
  if (!Array.isArray(data)) data = [data];
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data })); } catch { /* ignore */ }
  return data;
}

export function weatherPanel() {
  const body = h("div", { class: "wx" }, h("p", { class: "note" }, "جارٍ تحميل الطقس…"));
  const panel = h("section", { class: "panel", "aria-label": "طقس الأردن" },
    h("h2", {}, "طقس الأردن"), body,
    h("p", { class: "note" }, h("a", { href: "index.html?cat=weather" }, "أخبار الطقس ←"), " · البيانات: ",
      h("a", { href: "https://open-meteo.com/", target: "_blank", rel: "noopener noreferrer" }, "Open-Meteo")));

  load().then((data) => {
    const [amman, ...rest] = data;
    const now = describe(amman.current.weather_code);
    const d = amman.daily;
    body.replaceChildren(
      h("div", { class: "wx-now" },
        h("span", { class: "wx-icon", "aria-hidden": "true" }, now.icon),
        h("div", {},
          h("b", { class: "wx-temp" }, num(amman.current.temperature_2m) + "°"),
          h("div", {}, CITIES[0].name + " · " + now.label),
          h("div", { class: "note" }, "الرياح " + num(amman.current.wind_speed_10m) + " كم/س"))),
      h("ul", { class: "wx-days" }, d.time.slice(1, 4).map((t, i) => {
        const k = i + 1, w = describe(d.weather_code[k]);
        return h("li", {},
          h("span", {}, DAY.format(new Date(t + "T12:00:00+03:00"))),
          h("span", { title: w.label, "aria-label": w.label }, w.icon),
          h("span", { class: "num" }, num(d.temperature_2m_max[k]) + "° / " + num(d.temperature_2m_min[k]) + "°"),
          d.precipitation_probability_max[k] >= 30 ? h("span", { class: "wx-rain" }, "مطر " + num(d.precipitation_probability_max[k]) + "٪") : h("span"));
      })),
      h("ul", { class: "wx-cities" }, rest.map((c, i) => {
        const w = describe(c.current.weather_code);
        return h("li", {}, h("span", {}, CITIES[i + 1].name), h("span", { title: w.label, "aria-label": w.label }, w.icon),
          h("b", { class: "num" }, num(c.current.temperature_2m) + "°"));
      })));
  }).catch(() => body.replaceChildren(h("p", { class: "note" }, "تعذّر تحميل الطقس حالياً.")));
  return panel;
}
