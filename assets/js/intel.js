// «مركز لحظة للذكاء العالمي» (intel.html): what the world is discussing now, the YouTube analyses attracting unusual
// attention, and the most important developments. Data: intel_trends + intel_yt_videos (migration 29) and the
// existing global ranking. Every number on this page comes from the database; nothing is estimated in the browser.
import { h, sb, configured, ago, time, toast, loadSources, CAT_NAME } from "./common.js";
import { renderChrome, fetchStatus } from "./layout.js";
import { EN, L, flag, countryName } from "./i18n.js";
import { fetchGlobalEvents, eventCard } from "./global.js";
import { searchUrl, termDir } from "./trends-data.js";

const chrome = renderChrome({ active: "intel" });
const root = document.getElementById("app");
document.title = L("مركز لحظة للذكاء العالمي — لحظة", "Lahza Global Intelligence — Lahza");
const P = new URLSearchParams(location.search);
const NF = new Intl.NumberFormat(EN ? "en" : "ar-JO-u-nu-latn", { notation: "compact", maximumFractionDigits: 1 });
const num = (n) => (n === null || n === undefined ? "—" : NF.format(n));

// ---------- sections ----------
export const SECTIONS = [
  ["all", L("الأكثر رواجاً عالمياً", "Global trending")],
  ["politics", L("تحليلات سياسية", "Political analysis")],
  ["war", L("الحروب والأمن", "War & security")],
  ["sports", L("الرياضة", "Sports")],
  ["tech", L("التكنولوجيا والذكاء الاصطناعي", "Tech & AI")],
  ["automotive", L("السيارات", "Automotive")],
  ["science", L("العلوم والاكتشافات", "Science")],
  ["medical", L("الطب والصحة", "Medicine & health")],
  ["economy", L("الاقتصاد والأسواق", "Economy & markets")],
  ["documentary", L("وثائقيات", "Documentaries")],
];
const SECTION_NAME = Object.fromEntries(SECTIONS);
const SORTS = [["popularity", L("الأكثر رواجاً", "Trending now")], ["editorial", L("الأهم تحريرياً", "Most important")], ["views", L("الأكثر مشاهدة", "Most viewed")]];
const WINDOWS = [[1, L("آخر ساعة", "Last hour")], [6, L("آخر 6 ساعات", "Last 6 hours")], [24, L("آخر 24 ساعة", "Last 24 hours")], [168, L("آخر 7 أيام", "Last 7 days")]];

const state = {
  section: SECTION_NAME[P.get("s")] ? P.get("s") : "all",
  sort: ["popularity", "editorial", "views"].includes(P.get("sort")) ? P.get("sort") : "popularity",
  hours: [1, 6, 24, 168].includes(Number(P.get("h"))) ? Number(P.get("h")) : 24,
  channels: new Map(),
};

// ---------- status strip (LIVE only when the data is actually fresh) ----------
const statusEl = h("div", { class: "in-status", role: "status", "aria-live": "polite" });
function pill(label, at, staleMin, nextMin) {
  const age = at ? (Date.now() - new Date(at)) / 60000 : Infinity;
  const live = age <= staleMin;
  return h("span", { class: "in-pill", dataset: { state: live ? "live" : "stale" },
      title: at ? L("آخر تحديث ناجح: ", "Last successful update: ") + ago(at) : L("لم يصل أي تحديث بعد", "No update yet") },
    h("i", { "aria-hidden": "true" }), h("b", {}, label), " ",
    live ? L("مباشر", "Live") : L("متأخر", "Delayed"),
    at ? h("span", { class: "num" }, " · " + time(at)) : null,
    live && nextMin ? h("small", {}, L(` · التالي خلال ~${nextMin} د`, ` · next in ~${nextMin} min`)) : null);
}
function minutesToNext(offset) { // the collectors run at minute offset, offset+10, …
  const m = new Date().getUTCMinutes();
  return ((offset - (m % 10) + 10) % 10) || 10;
}
async function loadStatus() {
  try {
    const [ch, geos, st, tr] = await Promise.all([
      sb.from("intel_yt_channels").select("last_ok_at").order("last_ok_at", { ascending: false, nullsFirst: false }).limit(1),
      sb.from("news_trend_geos").select("last_ok_at").order("last_ok_at", { ascending: false, nullsFirst: false }).limit(1),
      fetchStatus().catch(() => null),
      sb.from("intel_trends").select("updated_at").order("updated_at", { ascending: false }).limit(1),
    ]);
    statusEl.replaceChildren(
      pill(L("الأخبار", "News"), st?.last_run_at, 15, null),
      pill(L("يوتيوب", "YouTube"), ch.data?.[0]?.last_ok_at, 45, minutesToNext(6)),
      pill(L("بحث جوجل", "Google searches"), geos.data?.[0]?.last_ok_at, 20, null),
      pill(L("دمج الترند", "Trend fusion"), tr.data?.[0]?.updated_at, 25, minutesToNext(8)));
    const latest = [st?.last_run_at, ch.data?.[0]?.last_ok_at].filter(Boolean).sort().pop();
    chrome.setLiveState(latest && Date.now() - new Date(latest) < 15 * 60000 ? "polling" : "offline", latest ? new Date(latest) : null);
  } catch (e) { console.error(e); }
}

// ---------- 1) world trends ----------
const trendsEl = h("ol", { class: "in-trends" }, h("li", { class: "note" }, L("جارٍ التحميل…", "Loading…")));
const DIR = { new: ["✦", L("جديد", "New")], up: ["▲", L("صاعد", "Rising")], down: ["▼", L("يتراجع", "Falling")], flat: ["■", L("مستقر", "Steady")] };
function whyTrend(t) {
  const bits = [];
  if (t.n_countries) bits.push(EN ? `searched in ${t.n_countries} ${t.n_countries === 1 ? "country" : "countries"}` : t.n_countries === 1 ? "يُبحث عنه في دولة واحدة" : `يُبحث عنه في ${t.n_countries} دول`);
  if (t.news_publishers) bits.push(EN ? `covered by ${t.news_publishers} publisher${t.news_publishers === 1 ? "" : "s"} in Lahza's feeds` : `تغطيه ${t.news_publishers} ${t.news_publishers <= 10 ? "جهات نشر" : "جهة نشر"} في مصادر لحظة`);
  if (t.video_hits) bits.push(EN ? `in ${t.video_hits} recent analysis video${t.video_hits === 1 ? "" : "s"}` : `يظهر في ${t.video_hits} من فيديوهات التحليل الحديثة`);
  return bits.join(L("، ", ", ")) + ".";
}
function trendItem(t, i) {
  const name = !EN && t.term_ar ? t.term_ar : t.term;
  const [arrow, dirLabel] = DIR[t.direction] || DIR.flat;
  const news = Array.isArray(t.google_news) ? t.google_news[0] : null;
  return h("li", { class: "in-trend" },
    h("span", { class: "in-rank num", "aria-hidden": "true" }, String(i + 1)),
    h("div", { class: "in-main" },
      h("div", { class: "meta-row" },
        t.is_global ? h("span", { class: "chip in-global", title: L("ظهر في منصتين على الأقل وفي 3 دول أو لدى 3 جهات نشر مستقلة", "Seen on 2+ platforms and in 3+ countries or by 3+ independent publishers") }, L("عالمي", "Global"))
          : h("span", { class: "chip", title: L("لا يكفي ليوصف بأنه عالمي: منصة واحدة أو دولة واحدة", "Not enough to call it global: one platform or country") }, L("محلي/إقليمي", "Local/regional")),
        t.category ? h("span", { class: "chip" }, CAT_NAME[t.category] || SECTION_NAME[t.category] || t.category) : null,
        h("span", { class: "in-dir", dataset: { d: t.direction }, title: dirLabel }, arrow, " ", dirLabel)),
      h("h3", { dir: termDir(name) }, h("a", { href: searchUrl(t.term), title: L("ابحث عنه في أخبار لحظة", "Search Lahza news for it") }, name)),
      name !== t.term ? h("div", { class: "in-orig", dir: termDir(t.term) }, L("الكلمة الأصلية: ", "Original keyword: "), t.term) : null,
      h("p", { class: "in-why" }, h("b", {}, L("لماذا يهم: ", "Why it matters: ")), whyTrend(t)),
      h("div", { class: "in-meta" },
        (t.geos || []).length ? h("span", { title: (t.geos || []).map(countryName).join(L("، ", ", ")) }, (t.geos || []).slice(0, 8).map(flag).join(" "), t.geos.length > 8 ? ` +${t.geos.length - 8}` : "") : null,
        h("span", { class: "num" }, L("رُصد أول مرة ", "first detected ") + ago(t.first_seen_at)),
        h("span", { class: "num", title: L("درجة الترند من 100", "Trend score out of 100") }, L("الترند ", "Trend ") + t.score + "/100"),
        news?.u ? h("a", { href: news.u, target: "_blank", rel: "noopener noreferrer nofollow", dir: termDir(news.t || "") }, L("مصدر داعم ↗", "Supporting source ↗")) : null)));
}
async function loadTrends() {
  try {
    const { data, error } = await sb.from("intel_trends").select("*").gt("last_seen_at", new Date(Date.now() - 6 * 3600e3).toISOString())
      .order("is_global", { ascending: false }).order("score", { ascending: false }).limit(10);
    if (error) throw error;
    trendsEl.replaceChildren(...(data.length ? data.map(trendItem) : [h("li", { class: "note" }, L("لم تُرصد ترندات بعد. يُحدَّث كل 10 دقائق.", "No trends detected yet. Updated every 10 minutes."))]));
  } catch (e) { console.error(e); trendsEl.replaceChildren(h("li", { class: "note" }, L("تعذّر تحميل الترند.", "Could not load trends."))); }
}

// ---------- 2) YouTube analyses ----------
const tabsEl = h("nav", { class: "in-tabs", "aria-label": L("أقسام تحليلات يوتيوب", "YouTube analysis sections") });
const toolsEl = h("div", { class: "in-tools" });
const videosEl = h("ul", { class: "in-videos" }, h("li", { class: "note" }, L("جارٍ التحميل…", "Loading…")));

function whyVideo(v) {
  const p = v.score_parts || {}, out = [];
  if (v.velocity_ratio && v.velocity_ratio >= 1.5) out.push(L(`المشاهدات أسرع ${v.velocity_ratio}× من معدل القناة`, `views ${v.velocity_ratio}× faster than the channel's usual`));
  if (v.vph) out.push(L(`${num(Math.round(v.vph))} مشاهدة/ساعة`, `${num(Math.round(v.vph))} views/hour`) + (p.measured ? "" : L(" (متوسط منذ النشر)", " (average since publication)")));
  if (p.eng_pct) out.push(L(`إعجابات ${p.eng_pct}% من المشاهدات`, `likes ${p.eng_pct}% of views`));
  if (v.related_article_id) out.push(L(`مرتبط بحدث تغطيه ${v.related_publishers} ${v.related_publishers <= 10 ? "جهات" : "جهة"} نشر`, `linked to an event covered by ${v.related_publishers} publisher(s)`));
  if (v.trend_match) out.push(L(`يتقاطع مع بحث رائج: «${v.trend_match}»`, `matches a trending search: “${v.trend_match}”`));
  return out;
}
const POP_PARTS = [["velocity", L("السرعة مقارنة بالقناة", "Speed vs channel"), 40], ["growth", L("النمو الحالي", "Current growth"), 20], ["engagement", L("التفاعل", "Engagement"), 25], ["cross", L("حضور عبر المنصات", "Cross-platform"), 15]];
const EDT_PARTS = [["source", L("موثوقية القناة", "Channel credibility"), 35], ["subject", L("أهمية الموضوع", "Subject weight"), 25], ["coverage", L("تغطية إخبارية مستقلة", "Independent news coverage"), 25], ["format", L("طابع تحليلي", "Analysis format"), 15]];
const partsTitle = (v, parts, head) => head + "\n" + parts.map(([k, label, max]) => `${label}: ${v.score_parts?.[k] ?? 0}/${max}`).join("\n");
function scorePair(v) {
  return h("div", { class: "in-scores" },
    h("span", { class: "in-score pop", title: partsTitle(v, POP_PARTS, L("درجة الرواج: كم من الانتباه يجذب الفيديو", "Popularity: how much attention it attracts")) },
      h("small", {}, L("الرواج", "Popularity")), h("b", { class: "num" }, String(v.popularity ?? "—"))),
    h("span", { class: "in-score edt", title: partsTitle(v, EDT_PARTS, L("الأهمية التحريرية: أهمية الموضوع وموثوقية المصدر — مستقلة عن الرواج", "Editorial importance: subject weight and source credibility — independent of popularity")) },
      h("small", {}, L("الأهمية", "Importance")), h("b", { class: "num" }, String(v.editorial ?? "—"))));
}
let playing = null;
function play(fig, id) {
  if (playing && playing !== fig) playing.restore();
  const keep = [...fig.childNodes];
  const frame = h("iframe", { src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1`, title: L("مشغّل يوتيوب", "YouTube player"),
    allow: "autoplay; encrypted-media; picture-in-picture; fullscreen", allowfullscreen: true, loading: "lazy", referrerpolicy: "strict-origin-when-cross-origin" });
  fig.replaceChildren(frame);
  fig.restore = () => { fig.replaceChildren(...keep); if (playing === fig) playing = null; };
  playing = fig;
}
function videoCard(v) {
  const ch = state.channels.get(v.channel_id);
  const hasAr = !EN && v.title_ar;
  const titleEl = h("a", { href: `https://www.youtube.com/watch?v=${v.video_id}`, target: "_blank", rel: "noopener noreferrer", dir: hasAr ? "rtl" : termDir(v.title) }, hasAr ? v.title_ar : v.title);
  let showingOrig = !hasAr;
  const origBtn = hasAr ? h("button", { type: "button", class: "linkish", onclick: () => {
    showingOrig = !showingOrig;
    titleEl.textContent = showingOrig ? v.title : v.title_ar; titleEl.dir = showingOrig ? termDir(v.title) : "rtl";
    origBtn.textContent = showingOrig ? L("عرض الترجمة", "Show translation") : L("عرض العنوان الأصلي", "Show original title");
  } }, L("عرض العنوان الأصلي", "Show original title")) : null;
  const fig = h("figure", { class: "in-thumb" },
    v.thumbnail ? h("img", { src: v.thumbnail, alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" }) : null,
    h("button", { type: "button", class: "in-play", "aria-label": L("تشغيل الفيديو هنا", "Play here"), onclick: () => play(fig, v.video_id) }, "▶"));
  const why = whyVideo(v);
  return h("li", { class: "in-video" }, fig,
    h("div", { class: "in-vbody" },
      h("div", { class: "meta-row" },
        h("span", { class: "chip" }, SECTION_NAME[v.section] || v.section),
        !hasAr && v.language === "en" && !EN ? h("span", { class: "chip lang" }, L("بالإنجليزية", "English")) : null,
        v.language === "ar" && EN ? h("span", { class: "chip lang" }, "Arabic") : null),
      h("h3", {}, titleEl),
      h("div", { class: "in-meta" },
        h("span", {}, ch ? (EN ? ch.name_en : ch.name_ar) : v.channel_id, ch ? h("small", { title: L("فئة موثوقية القناة (5 الأعلى)", "Channel credibility tier (5 highest)") }, ` · ${L("فئة", "tier")} ${ch.tier}/5`) : null),
        h("span", { class: "num", title: new Date(v.published_at).toISOString() }, ago(v.published_at)),
        h("span", { class: "num" }, "👁 " + num(v.views)), v.likes ? h("span", { class: "num" }, "👍 " + num(v.likes)) : null),
      why.length ? h("p", { class: "in-why" }, h("b", {}, L("لماذا يتصدّر: ", "Why it's trending: ")), why.join(L("، ", ", ")) + ".") : null,
      h("div", { class: "in-actions" },
        origBtn,
        h("a", { href: `https://www.youtube.com/watch?v=${v.video_id}`, target: "_blank", rel: "noopener noreferrer" }, L("المصدر الأصلي ↗", "Original source ↗")),
        v.related_article_id ? h("a", { href: `article.html?id=${v.related_article_id}` }, L("اقرأ التغطية الكاملة", "Read the full coverage")) : null)),
    scorePair(v));
}
function drawControls() {
  const go = () => { const u = new URL(location.href); u.searchParams.set("s", state.section); u.searchParams.set("sort", state.sort); u.searchParams.set("h", String(state.hours)); history.replaceState(null, "", u); loadVideos(); drawControls(); };
  tabsEl.replaceChildren(...SECTIONS.map(([k, label]) => h("button", { type: "button", class: "in-tab", "aria-pressed": String(state.section === k), onclick: () => { state.section = k; go(); } }, label)));
  const seg = (opts, cur, set) => h("div", { class: "seg" }, opts.map(([v, label]) => h("button", { type: "button", "aria-pressed": String(cur === v), onclick: () => { set(v); go(); } }, label)));
  toolsEl.replaceChildren(seg(SORTS, state.sort, (v) => { state.sort = v; }), seg(WINDOWS, state.hours, (v) => { state.hours = v; }));
}
async function loadChannels() {
  const { data } = await sb.from("intel_yt_channels").select("channel_id,name_ar,name_en,tier,section");
  for (const c of data || []) state.channels.set(c.channel_id, c);
}
async function loadVideos() {
  try {
    let q = sb.from("intel_yt_videos").select("video_id,channel_id,title,title_ar,language,section,published_at,thumbnail,views,likes,vph,velocity_ratio,popularity,editorial,score_parts,related_article_id,related_publishers,trend_match")
      .gt("published_at", new Date(Date.now() - state.hours * 3600e3).toISOString());
    if (state.section !== "all") q = q.eq("section", state.section);
    q = q.order(state.sort, { ascending: false, nullsFirst: false }).limit(state.section === "all" ? 10 : 12);
    const { data, error } = await q;
    if (error) throw error;
    videosEl.replaceChildren(...(data.length ? data.map(videoCard)
      : [h("li", { class: "note" }, state.hours <= 1 ? L("لا فيديوهات تحليلية جديدة في آخر ساعة. جرّب نطاقاً أطول.", "No new analysis videos in the last hour. Try a longer window.")
        : L("لا فيديوهات في هذا القسم والفترة بعد.", "No videos in this section and window yet."))]));
  } catch (e) { console.error(e); videosEl.replaceChildren(h("li", { class: "note" }, L("تعذّر تحميل الفيديوهات.", "Could not load videos."))); }
}

// ---------- 3) most important developments ----------
const eventsEl = h("ul", { class: "gev-list" }, h("li", { class: "note" }, L("جارٍ التحميل…", "Loading…")));
async function loadEvents() {
  try {
    const [events, sources] = await Promise.all([fetchGlobalEvents({ limit: 5, ownLang: true }), loadSources()]);
    eventsEl.replaceChildren(...(events.length ? events.map((e) => eventCard(e, sources)) : [h("li", { class: "note" }, L("لا أحداث مرتّبة الآن.", "No ranked events right now."))]));
  } catch { eventsEl.replaceChildren(h("li", { class: "note" }, L("تعذّر تحميل الأحداث.", "Could not load events."))); }
}

// ---------- page ----------
root.replaceChildren(
  h("header", { class: "in-head" },
    h("h1", {}, L("مركز لحظة للذكاء والتحليل العالمي", "Lahza Global Intelligence")),
    h("p", { class: "tr-lede" }, L("لا نكتفي بإخبارك بما حدث، بل نشرح لماذا حدث، وما أهميته، وما الذي قد يحدث بعد ذلك.", "Not only what happened — why it happened, why it matters and what may come next.")),
    statusEl),
  h("section", { "aria-labelledby": "in-t" },
    h("div", { class: "section-head" }, h("h2", { id: "in-t" }, L("الآن يتصدّر العالم", "What the world is discussing now")), h("a", { class: "meta", href: "trends.html" }, L("الترند حسب الدولة ←", "Trends by country →"))),
    trendsEl),
  h("section", { "aria-labelledby": "in-y" },
    h("div", { class: "section-head" }, h("h2", { id: "in-y" }, L("تحليلات يوتيوب الرائجة", "Trending YouTube analysis"))),
    tabsEl, toolsEl, videosEl,
    h("p", { class: "note in-method" }, L("الرواج لا يعني الصحة: درجة «الرواج» تقيس الانتباه فقط، و«الأهمية» تقيس موثوقية القناة وأهمية الموضوع والتغطية المستقلة. البيانات من خلاصات يوتيوب العامة لقنوات موثّقة (المشاهدات والإعجابات)، وتُقاس السرعة كل 30 دقيقة مقارنةً بمعدل القناة نفسها. عدد التعليقات ونسب المشاهدة الخاصة غير متاحة ولا تُقدَّر.",
      "Popular is not the same as accurate: Popularity measures attention only; Importance measures channel credibility, subject weight and independent coverage. Data: public YouTube feeds of verified channels (views and likes); velocity is measured every 30 minutes against the channel's own baseline. Comment counts and private audience data are not available and are never estimated."))),
  h("section", { "aria-labelledby": "in-e" },
    h("div", { class: "section-head" }, h("h2", { id: "in-e" }, L("أهم التطورات الآن", "Most important developments")), h("a", { class: "meta", href: "breaking.html" }, L("الترتيب العالمي الكامل ←", "Full global ranking →"))),
    eventsEl));

drawControls();
if (configured) {
  loadStatus(); loadTrends(); loadEvents();
  loadChannels().finally(loadVideos);
  setInterval(() => { if (document.visibilityState === "visible") { loadStatus(); loadTrends(); loadVideos(); loadEvents(); } }, 180_000);
  chrome.refreshTicker().catch(() => {});
} else root.replaceChildren(h("div", { class: "state" }, L("الموقع غير مهيأ.", "Site not configured.")));
