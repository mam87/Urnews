// Shared helpers: Supabase client, safe DOM building, Amman-time formatting, labels, theme.
import { createClient } from "../vendor/supabase-2.45.4.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { EN, L } from "./i18n.js";
export { EN, L };

export const configured = !SUPABASE_URL.startsWith("__");
export const sb = configured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, storageKey: "nabd-auth" }, realtime: { params: { eventsPerSecond: 2 } } })
  : null;

export const ARTICLE_COLS = "id,source_id,url,title,title_original,summary,summary_kind,language,translated,title_en,countries,region,event_type,category,categories,image_url,published_at,published_estimated,fetched_at,cluster_id,verification,is_breaking,breaking_until,importance,pinned,edited,status,created_at";

// Sections. In the English edition "world" comes first; Jordan is one country among all others in both.
const CATS = [
  ["world", "دولي", "World"], ["politics", "سياسة", "Politics"], ["economy", "اقتصاد وأعمال", "Business"], ["tech", "تكنولوجيا وذكاء اصطناعي", "Tech & AI"],
  ["health", "صحة وعلوم", "Health & Science"], ["environment", "بيئة ومناخ", "Climate"], ["arab", "العالم العربي", "Arab World"], ["palestine", "فلسطين", "Palestine"],
  ["jordan", "الأردن", "Jordan"], ["sports", "رياضة", "Sports"], ["weather", "طقس", "Weather"], ["security", "أمن وجريمة", "Security"],
  ["education", "تعليم", "Education"], ["entertainment", "فن وثقافة", "Culture"],
];
export const CATEGORIES = CATS.map(([slug, ar, en]) => [slug, EN ? en : ar]);
export const CAT_NAME = Object.fromEntries(CATEGORIES);

export const VERIFICATION = EN ? {
  official:   { label: "Official source",      hint: "Issued directly by an official body" },
  confirmed:  { label: "Editor-verified",      hint: "Checked by an editor against independent sources" },
  statement:  { label: "Attributed statement", hint: "Reports a statement attributed to someone, according to the source" },
  allegation: { label: "Unverified claim",     hint: "Contains claims or unconfirmed reports — treat with caution" },
  developing: { label: "Developing",           hint: "A breaking story whose details may change" },
  reported:   { label: "As reported",          hint: "As reported by the named source, not independently verified" },
} : {
  official:   { label: "مصدر رسمي",       hint: "صادر عن جهة رسمية مباشرة" },
  confirmed:  { label: "مؤكَّد تحريرياً",  hint: "راجعه محرر وتأكد منه من مصادر مستقلة" },
  statement:  { label: "تصريح منسوب",     hint: "ينقل تصريحاً أو بياناً منسوباً لجهة ما، بحسب المصدر" },
  allegation: { label: "ادعاء غير مؤكد",  hint: "يتضمن مزاعم أو أنباء غير مؤكدة — تعامل معه بحذر" },
  developing: { label: "خبر متطور",       hint: "قصة عاجلة قد تتغير تفاصيلها" },
  reported:   { label: "حسب المصدر",      hint: "منقول عن المصدر المذكور دون تحقق مستقل" },
};

export const SUMMARY_KIND = EN ? {
  feed: "Short excerpt from the source",
  ai: "Automatic AI summary — not a verbatim quote",
  editor: "Summary written by our editors",
} : {
  feed: "مقتطف قصير من المصدر",
  ai: "ملخص آلي بالذكاء الاصطناعي — ليس اقتباساً حرفياً",
  editor: "ملخص من تحرير الموقع",
};

/** Hyperscript-style element builder. Text is always inserted as text (never HTML). */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v; // CSSOM: allowed under a strict CSP (no inline style attributes)
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "href" || k === "src") { const u = safeHref(v); if (u) el.setAttribute(k, u); }
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function safeHref(u) {
  if (typeof u !== "string") return null;
  if (u.startsWith("/") || u.startsWith("./") || u.startsWith("?") || u.startsWith("#") || /^[\w-]+\.html/.test(u)) return u;
  try { const p = new URL(u); return p.protocol === "https:" || p.protocol === "http:" ? p.toString() : null; } catch { return null; }
}

const TZ = "Asia/Amman";
const LOC = EN ? "en-GB" : "ar-JO-u-nu-latn";
const fmtTime = new Intl.DateTimeFormat(LOC, { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });
const fmtDate = new Intl.DateTimeFormat(LOC, { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtLongToday = new Intl.DateTimeFormat(LOC, { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
export const todayLabel = () => fmtLongToday.format(new Date());
const fmtShortDate = new Intl.DateTimeFormat(LOC, { timeZone: TZ, day: "numeric", month: "short" });
const fmtFull = new Intl.DateTimeFormat(LOC, { timeZone: TZ, dateStyle: "medium", timeStyle: "short", hour12: true });
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

export const time = (d) => fmtTime.format(new Date(d));
export const date = (d) => fmtDate.format(new Date(d));
export const shortDate = (d) => fmtShortDate.format(new Date(d));
export const full = (d) => fmtFull.format(new Date(d)) + L(" (بتوقيت عمّان)", " (Amman time, UTC+3)");
export const ammanDay = (d) => dayKey.format(new Date(d));

export function ago(d, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(d).getTime()) / 1000));
  if (EN) {
    if (s < 60) return "just now";
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const hr = Math.round(m / 60);
    if (hr < 24) return `${hr} h ago`;
    return ammanDay(d) === ammanDay(now - 86400000) ? "yesterday " + time(d) : shortDate(d) + " " + time(d);
  }
  if (s < 60) return "الآن";
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? "منذ دقيقة" : m === 2 ? "منذ دقيقتين" : m <= 10 ? `منذ ${m} دقائق` : `منذ ${m} دقيقة`;
  const hr = Math.round(m / 60);
  if (hr < 24) return hr === 1 ? "منذ ساعة" : hr === 2 ? "منذ ساعتين" : hr <= 10 ? `منذ ${hr} ساعات` : `منذ ${hr} ساعة`;
  return ammanDay(d) === ammanDay(now - 86400000) ? "أمس " + time(d) : shortDate(d) + " " + time(d);
}

export function isToday(d) { return ammanDay(d) === ammanDay(Date.now()); }

export function verificationChip(v) {
  if (!v || v === "reported") return null;
  const info = VERIFICATION[v];
  return h("span", { class: `chip v-${v}`, title: info.hint }, info.label);
}

/* ---------- theme ---------- */
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};
export { store };
/* ---------- reader preferences (stored only in this browser) ---------- */
export const FONT_STEPS = [["0.9", "صغير"], ["1", "عادي"], ["1.12", "كبير"], ["1.25", "كبير جداً"], ["1.4", "ضخم"]];
const DEFAULT_PREFS = { theme: "auto", fs: "1", noimg: false, motion: "auto", density: "comfy" };
export function getPrefs() {
  let p = {};
  try { p = JSON.parse(store.get("nabd-prefs") || "{}") || {}; } catch { p = {}; }
  const legacy = store.get("nabd-theme");
  if (!p.theme && (legacy === "dark" || legacy === "light")) p.theme = legacy;
  return { ...DEFAULT_PREFS, ...p };
}
export function applyPrefs(p = getPrefs()) {
  const r = document.documentElement;
  if (p.theme === "dark" || p.theme === "light") r.dataset.theme = p.theme; else delete r.dataset.theme;
  r.style.setProperty("--fs", FONT_STEPS.some(([v]) => v === String(p.fs)) ? String(p.fs) : "1");
  if (p.noimg) r.dataset.noimg = "1"; else delete r.dataset.noimg;
  if (p.motion === "reduce") r.dataset.motion = "reduce"; else delete r.dataset.motion;
  if (p.density === "compact") r.dataset.density = "compact"; else delete r.dataset.density;
}
export function setPrefs(patch) {
  const p = { ...getPrefs(), ...patch };
  store.set("nabd-prefs", JSON.stringify(p));
  applyPrefs(p);
  return p;
}
export function initTheme() {
  applyPrefs();
  document.getElementById("theme-toggle")?.addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setPrefs({ theme: cur === "dark" ? "light" : "dark" });
  });
}

/* ---------- sources cache ---------- */
let sourcesPromise = null;
export function loadSources() {
  if (!sourcesPromise) {
    sourcesPromise = sb.from("news_sources").select("id,slug,name_ar,name_en,homepage,kind,reliability,enabled,allow_images,last_success_at")
      .then(({ data, error }) => {
        if (error) { sourcesPromise = null; throw error; }
        return new Map(data.map((s) => [s.id, s]));
      });
  }
  return sourcesPromise;
}

export function toast(msg, ms = 2600) {
  const t = h("div", { class: "toast", role: "status" }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

export function friendlyError(e) {
  const m = String(e?.message || e || "");
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return L("تعذّر الاتصال بالخادم. تحقق من اتصالك بالإنترنت.", "Could not reach the server. Check your connection.");
  if (/JWT|auth/i.test(m)) return L("انتهت الجلسة. يرجى تسجيل الدخول من جديد.", "Your session expired. Please sign in again.");
  return L("حدث خطأ غير متوقع. حاول مرة أخرى بعد قليل.", "Something went wrong. Please try again shortly.");
}

export function setupSearchToggle() {
  const btn = document.getElementById("search-toggle");
  const box = document.getElementById("search-mobile");
  btn?.addEventListener("click", () => { box.classList.toggle("open"); box.querySelector("input")?.focus(); });
}

export function notConfiguredState(root) {
  root.replaceChildren(h("div", { class: "state" }, h("h3", {}, "الموقع غير مهيأ بعد"), "لم يتم ضبط عنوان قاعدة البيانات في assets/js/config.js."));
}

/** Source name in the reader's language. */
export const srcName = (s) => (s ? (EN ? s.name_en || s.name_ar : s.name_ar) : "");
