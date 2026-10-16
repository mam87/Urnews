// Shared helpers: Supabase client, safe DOM building, Amman-time formatting, labels, theme.
import { createClient } from "../vendor/supabase-2.45.4.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const configured = !SUPABASE_URL.startsWith("__");
export const sb = configured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, storageKey: "nabd-auth" }, realtime: { params: { eventsPerSecond: 2 } } })
  : null;

export const ARTICLE_COLS = "id,source_id,url,title,title_original,summary,summary_kind,language,translated,category,categories,image_url,published_at,published_estimated,fetched_at,cluster_id,verification,is_breaking,breaking_until,importance,pinned,edited,status,created_at";

export const CATEGORIES = [
  ["jordan", "الأردن"], ["palestine", "فلسطين"], ["arab", "العالم العربي"], ["world", "دولي"], ["politics", "سياسة"],
  ["economy", "اقتصاد وأعمال"], ["tech", "تكنولوجيا وذكاء اصطناعي"], ["health", "صحة وعلوم"], ["sports", "رياضة"],
];
export const CAT_NAME = Object.fromEntries(CATEGORIES);

export const VERIFICATION = {
  official:   { label: "مصدر رسمي",       hint: "صادر عن جهة رسمية مباشرة" },
  confirmed:  { label: "مؤكَّد تحريرياً",  hint: "راجعه محرر وتأكد منه من مصادر مستقلة" },
  statement:  { label: "تصريح منسوب",     hint: "ينقل تصريحاً أو بياناً منسوباً لجهة ما، بحسب المصدر" },
  allegation: { label: "ادعاء غير مؤكد",  hint: "يتضمن مزاعم أو أنباء غير مؤكدة — تعامل معه بحذر" },
  developing: { label: "خبر متطور",       hint: "قصة عاجلة قد تتغير تفاصيلها" },
  reported:   { label: "حسب المصدر",      hint: "منقول عن المصدر المذكور دون تحقق مستقل" },
};

export const SUMMARY_KIND = {
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
const fmtTime = new Intl.DateTimeFormat("ar-JO-u-nu-latn", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });
const fmtDate = new Intl.DateTimeFormat("ar-JO-u-nu-latn", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtShortDate = new Intl.DateTimeFormat("ar-JO-u-nu-latn", { timeZone: TZ, day: "numeric", month: "short" });
const fmtFull = new Intl.DateTimeFormat("ar-JO-u-nu-latn", { timeZone: TZ, dateStyle: "medium", timeStyle: "short", hour12: true });
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

export const time = (d) => fmtTime.format(new Date(d));
export const date = (d) => fmtDate.format(new Date(d));
export const shortDate = (d) => fmtShortDate.format(new Date(d));
export const full = (d) => fmtFull.format(new Date(d)) + " (بتوقيت عمّان)";
export const ammanDay = (d) => dayKey.format(new Date(d));

export function ago(d, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(d).getTime()) / 1000));
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
export function initTheme() {
  const saved = store.get("nabd-theme");
  if (saved === "dark" || saved === "light") document.documentElement.dataset.theme = saved;
  const btn = document.getElementById("theme-toggle");
  btn?.addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme
      || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set("nabd-theme", next);
  });
}

/* ---------- sources cache ---------- */
let sourcesPromise = null;
export function loadSources() {
  if (!sourcesPromise) {
    sourcesPromise = sb.from("sources").select("id,slug,name_ar,homepage,kind,reliability,enabled,allow_images,last_success_at")
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
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "تعذّر الاتصال بالخادم. تحقق من اتصالك بالإنترنت.";
  if (/JWT|auth/i.test(m)) return "انتهت الجلسة. يرجى تسجيل الدخول من جديد.";
  return "حدث خطأ غير متوقع. حاول مرة أخرى بعد قليل.";
}

export function setupSearchToggle() {
  const btn = document.getElementById("search-toggle");
  const box = document.getElementById("search-mobile");
  btn?.addEventListener("click", () => { box.classList.toggle("open"); box.querySelector("input")?.focus(); });
}

export function notConfiguredState(root) {
  root.replaceChildren(h("div", { class: "state" }, h("h3", {}, "الموقع غير مهيأ بعد"), "لم يتم ضبط عنوان قاعدة البيانات في assets/js/config.js."));
}
