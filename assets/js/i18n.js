// Site language (Arabic / English). Chosen with the masthead switch or ?lang=en|ar, remembered in this browser.
// theme-boot.js applies <html lang dir> before first paint; switching reloads the page.
import { COUNTRIES } from "./countries.js";

const read = () => { try { return localStorage.getItem("nabd-lang"); } catch { return null; } };
const fromUrl = new URLSearchParams(location.search).get("lang");
export const LANG = fromUrl === "en" || fromUrl === "ar" ? fromUrl : read() === "en" ? "en" : "ar";
export const EN = LANG === "en";
export const DIR = EN ? "ltr" : "rtl";

/** Pick the string for the current language. */
export const L = (ar, en) => (EN ? en : ar);

export function setLang(lang) {
  try { localStorage.setItem("nabd-lang", lang); } catch { /* storage unavailable */ }
  const u = new URL(location.href);
  u.searchParams.delete("lang");
  location.replace(u.toString());
}

export const REGIONS = [
  ["north_america", "أمريكا الشمالية والوسطى", "North & Central America"],
  ["south_america", "أمريكا الجنوبية", "South America"],
  ["europe", "أوروبا", "Europe"],
  ["middle_east", "الشرق الأوسط", "Middle East"],
  ["north_africa", "شمال أفريقيا", "North Africa"],
  ["sub_saharan_africa", "أفريقيا جنوب الصحراء", "Sub-Saharan Africa"],
  ["east_asia", "شرق آسيا", "East Asia"],
  ["south_asia", "جنوب آسيا", "South Asia"],
  ["southeast_asia", "جنوب شرق آسيا", "Southeast Asia"],
  ["central_asia", "آسيا الوسطى", "Central Asia"],
  ["oceania", "أستراليا وأوقيانوسيا", "Australia & Oceania"],
];
export const REGION_NAME = Object.fromEntries(REGIONS.map(([k, ar, en]) => [k, EN ? en : ar]));

export const isCountry = (iso) => typeof iso === "string" && Object.hasOwn(COUNTRIES, iso);
export const countryName = (iso) => (isCountry(iso) ? COUNTRIES[iso][EN ? 1 : 0] : iso || "");
export const countryRegion = (iso) => (isCountry(iso) ? COUNTRIES[iso][2] : null);
/** Flag emoji from the ISO code (regional-indicator letters). */
export const flag = (iso) => (isCountry(iso) && /^[A-Z]{2}$/.test(iso) ? String.fromCodePoint(...[...iso].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "🌐");
export const allCountries = () => Object.keys(COUNTRIES).sort((a, b) => countryName(a).localeCompare(countryName(b), LANG));

/** Headline / excerpt in the reader's language. English edition: the English original when there is one. */
export function titleOf(a) {
  if (EN) return a.title_en || a.title;
  return a.title;
}
/** Text direction of a headline that is not in the page language. */
export function titleDir(a) {
  const t = titleOf(a) || "";
  const ar = /[؀-ۿ]/.test(t);
  if (EN) return ar ? "rtl" : null;
  return ar ? null : "ltr";
}
/** Restrict an articles query to what can be shown in this language. */
export function langFilter(qb) {
  return EN ? qb.not("title_en", "is", null) : qb.eq("language", "ar");
}
export const inLang = (a) => (EN ? !!a.title_en : a.language === "ar");
