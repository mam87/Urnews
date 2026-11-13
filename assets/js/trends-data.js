// Worldwide search trends (news_trends): what people are searching for right now, per country.
// Source: Google Trends' public "trending now" feed per country, collected by the database every 5 minutes
// (terms, approximate volume, start time and the news links Google lists with each term). Shown with attribution.
import { sb, h, store } from "./common.js";
import { EN, L, flag, countryName, isCountry } from "./i18n.js";

const TZ_GEO = { "Asia/Amman": "JO", "Asia/Riyadh": "SA", "Africa/Cairo": "EG", "Asia/Dubai": "AE", "Africa/Casablanca": "MA", "Africa/Algiers": "DZ", "Asia/Baghdad": "IQ",
  "Asia/Kuwait": "KW", "Asia/Qatar": "QA", "Asia/Beirut": "LB", "Europe/London": "GB", "Europe/Paris": "FR", "Europe/Berlin": "DE", "Europe/Istanbul": "TR", "Europe/Madrid": "ES",
  "Europe/Rome": "IT", "Asia/Kolkata": "IN", "Asia/Calcutta": "IN", "Asia/Tokyo": "JP", "America/Sao_Paulo": "BR", "Asia/Jakarta": "ID", "Africa/Lagos": "NG", "Africa/Johannesburg": "ZA",
  "Australia/Sydney": "AU", "Australia/Melbourne": "AU", "America/Toronto": "CA", "America/Vancouver": "CA", "America/Mexico_City": "MX", "Asia/Seoul": "KR", "Asia/Karachi": "PK" };

/** The reader's country for trends: saved choice, else the device time zone, else the United States. */
export function guessGeo(available) {
  const saved = store.get("lahza-trend-geo");
  if (saved && available.includes(saved)) return saved;
  let tz = ""; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { /* ignore */ }
  const g = TZ_GEO[tz] || (tz.startsWith("America/") ? "US" : null);
  return g && available.includes(g) ? g : available.includes("US") ? "US" : available[0] || null;
}
export const saveGeo = (g) => store.set("lahza-trend-geo", g);
export const geoName = (g) => (isCountry(g) ? countryName(g) : g);
export const geoLabel = (g) => `${flag(g)} ${geoName(g)}`;

/** Current trends of every country, grouped: Map(geo → rows sorted by rank). Order of the map = editorial order. */
export async function fetchTrends() {
  const [{ data: geos, error: e1 }, { data, error }] = await Promise.all([
    sb.from("news_trend_geos").select("geo,sort_order,last_ok_at").order("sort_order", { ascending: true }),
    sb.from("news_trends").select("geo,title,rank,traffic,started_at,news,seen_at").not("rank", "is", null).order("rank", { ascending: true }).limit(1000)]);
  if (error || e1) throw error || e1;
  const by = new Map((geos || []).map((g) => [g.geo, []]));
  for (const r of data || []) by.get(r.geo)?.push(r);
  for (const [g, rows] of by) if (!rows.length) by.delete(g);
  const updated = (geos || []).reduce((m, g) => (g.last_ok_at && g.last_ok_at > m ? g.last_ok_at : m), "");
  return { by, updated: updated || null };
}

/** "2000+" style volume → short label. */
export function volume(n) {
  if (!n) return "";
  const v = n >= 1e6 ? (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + L(" مليون", "M") : n >= 1000 ? Math.round(n / 1000) + L(" ألف", "K") : String(n);
  return L(`+${v} بحث`, `${v}+ searches`);
}
export const trendUrl = (g) => `https://trends.google.com/trending?geo=${encodeURIComponent(g)}`;
export const searchUrl = (term) => `index.html?q=${encodeURIComponent(term)}`;
export const attribution = (g) => h("p", { class: "note tr-attrib" }, L("عمليات البحث الرائجة: ", "Trending searches: "),
  h("a", { href: g ? trendUrl(g) : "https://trends.google.com/trending", target: "_blank", rel: "noopener noreferrer" }, "Google Trends"),
  L(" · تُحدَّث كل 5 دقائق. المصطلحات تظهر بلغة البلد كما يكتبها الناس.", " · refreshed every 5 minutes. Terms appear in each country's language, as people type them."));
export const termDir = (t) => (/[֐-ࣿ]/.test(t) ? "rtl" : "ltr");
