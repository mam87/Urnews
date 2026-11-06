// Global breaking news: worldwide events ranked 0-100 (any country), region/country filters,
// the wider top-ranked list, and the 48-hour breaking timeline. Live-updating.
import { sb, h, configured, loadSources, friendlyError, notConfiguredState, time, date, ammanDay, verificationChip, CAT_NAME, srcName } from "./common.js";
import { renderChrome, fetchStatus } from "./layout.js";
import { Live } from "./live.js";
import { EN, L, REGIONS, REGION_NAME, countryName, flag, isCountry, langFilter, titleOf, titleDir } from "./i18n.js";
import { eventCard, fetchGlobalEvents } from "./global.js";

const params = new URLSearchParams(location.search);
const region = REGION_NAME[params.get("region")] ? params.get("region") : null;
const country = isCountry(params.get("country")) ? params.get("country") : null;

const chrome = renderChrome({ active: "breaking" });
const root = document.getElementById("app");
const where = country ? `${flag(country)} ${countryName(country)}` : region ? REGION_NAME[region] : null;
document.title = (where ? where + " — " : "") + L("عاجل عالمي — لحظة", "Global breaking news — Lahza");

const breakingList = h("ol", { class: "gev-list", "aria-live": "polite" });
const topList = h("ol", { class: "gev-list" });
const timeline = h("ol", { class: "timeline" });
const countrySel = h("select", { "aria-label": L("اختر دولة", "Choose a country") });
let sources = new Map();
let lastKey = "";
let lastIds = "";

const link = (patch) => {
  const u = new URLSearchParams();
  const r = "region" in patch ? patch.region : region, c = "country" in patch ? patch.country : country;
  if (r) u.set("region", r);
  if (c) u.set("country", c);
  return "breaking.html" + (u.toString() ? "?" + u : "");
};

function filters() {
  countrySel.replaceChildren(h("option", { value: "" }, L("كل الدول", "All countries")));
  countrySel.addEventListener("change", () => { location.href = link({ country: countrySel.value || null, region: null }); });
  return h("nav", { class: "filters", "aria-label": L("تصفية حسب المنطقة", "Filter by region") },
    h("a", { class: "pill", href: link({ region: null, country: null }), "aria-current": !region && !country ? "page" : null }, "🌐 ", L("العالم كله", "Whole world")),
    REGIONS.map(([k]) => h("a", { class: "pill", href: link({ region: k, country: null }), "aria-current": region === k && !country ? "page" : null }, REGION_NAME[k])),
    countrySel);
}

async function loadCountries() {
  const { data } = await sb.rpc("news_country_counts", { p_hours: 48 });
  const rows = (data || []).filter((r) => isCountry(r.country) && (!region || r.region === region));
  rows.sort((a, b) => countryName(a.country).localeCompare(countryName(b.country), EN ? "en" : "ar"));
  countrySel.append(...rows.map((r) => h("option", { value: r.country, selected: r.country === country }, `${flag(r.country)} ${countryName(r.country)} (${r.n})`)));
  if (country && !rows.some((r) => r.country === country)) countrySel.append(h("option", { value: country, selected: true }, `${flag(country)} ${countryName(country)}`));
}

function methodology() {
  return h("details", { class: "method" },
    h("summary", {}, L("كيف نرتّب الأخبار العاجلة العالمية؟", "How are global breaking stories ranked?")),
    h("p", {}, L("كل حدث (مجموعة تقارير عن الشيء نفسه، بالعربية أو بالإنجليزية) يحصل على درجة من 0 إلى 100، دون أي أفضلية لدولة على أخرى — الأردن دولة مثل غيرها:",
      "Every event (all reports about the same thing, in Arabic or English) gets a score from 0 to 100, with no preference for any country — Jordan is treated like every other country:")),
    h("ul", {},
      h("li", {}, L("الأثر العالمي — 30 نقطة (نوع الحدث، قوة الزلزال، عدد الضحايا، تدخل هيئات دولية، عدد الدول المعنية)", "Global impact — 30 points (type of event, quake magnitude, casualties, international bodies, number of countries involved)")),
      h("li", {}, L("حداثة الخبر — 25 نقطة (تنخفض للنصف كل ساعتين)", "Freshness — 25 points (halves every two hours)")),
      h("li", {}, L("موثوقية المصدر — 20 نقطة", "Source credibility — 20 points")),
      h("li", {}, L("التغطية المستقلة — 15 نقطة (النسخ المكررة لتقرير رويترز أو أسوشيتد برس تُحسب مرة واحدة)", "Independent coverage — 15 points (syndicated copies of one Reuters or AP report count once)")),
      h("li", {}, L("سرعة تطور الحدث — 10 نقاط", "Development speed — 10 points"))),
    h("p", {}, L("يصبح الحدث «عاجلاً» إذا بلغ 60 نقطة ولم يكن خبراً روتينياً، وغطته جهتا نشر مستقلتان على الأقل — أو جهة واحدة عالية الموثوقية، وعندها يُوسم «تقرير من مصدر واحد». «مؤكَّد» يتطلب 3 جهات مستقلة منها جهتان عاليتا الموثوقية. لا نختلق أي تأكيد أو رقم أو اقتباس، ونربط دائماً بالناشر الأصلي.",
      "An event becomes “breaking” at 60 points if it is not routine and is covered by at least two independent publishers — or by one highly reliable publisher, then labelled “single-source report”. “Confirmed” needs 3 independent publishers, 2 of them highly reliable. We never fabricate confirmation, numbers or quotes, and always link to the original publisher.")));
}

async function loadEvents() {
  const [breaking, top] = await Promise.all([
    fetchGlobalEvents({ breakingOnly: true, region, country, limit: 12 }),
    fetchGlobalEvents({ region, country, limit: 30 }),
  ]);
  const key = JSON.stringify([breaking, top].map((l) => l.map((e) => [e.key, e.score, e.status, e.report_count])));
  if (key === lastKey) return;
  lastKey = key;
  breakingList.replaceChildren(...(breaking.length ? breaking.map((e) => eventCard(e, sources))
    : [h("li", { class: "note", style: "display:block;padding:12px 0" }, where
        ? L(`لا أحداث عاجلة في ${where} الآن. `, `No breaking events in ${where} right now. `)
        : L("لا أحداث عالمية عاجلة في هذه اللحظة.", "No global breaking events right now."))]));
  const rest = top.filter((e) => !e.is_breaking).slice(0, 15);
  topList.replaceChildren(...(rest.length ? rest.map((e) => eventCard(e, sources))
    : [h("li", { class: "note", style: "display:block;padding:12px 0" }, L("لا أحداث أخرى مرتبة.", "No other ranked events."))]));
}

async function loadTimeline() {
  const since = new Date(Date.now() - 48 * 3600_000).toISOString();
  let qb = sb.from("news_articles")
    .select("id,title,title_en,language,summary,source_id,published_at,breaking_until,verification,category,cluster_id,countries")
    .eq("status", "published").eq("is_breaking", true).is("duplicate_of", null).gt("published_at", since);
  if (region) qb = qb.eq("region", region);
  if (country) qb = qb.contains("countries", [country]);
  const { data, error } = await langFilter(qb).order("published_at", { ascending: false }).limit(100);
  if (error) throw error;
  const ids = data.map((a) => a.id).join(",");
  if (ids === lastIds) return;
  const fresh = new Set(data.map((a) => a.id).filter((x) => lastIds && !lastIds.split(",").includes(String(x))));
  lastIds = ids;
  if (!data.length) {
    timeline.replaceChildren(h("li", { class: "state", style: "display:block" }, h("h3", {}, L("لا أخبار عاجلة خلال آخر 48 ساعة", "No breaking news in the last 48 hours")), L("ستظهر هنا فور ورودها.", "They will appear here as soon as they arrive.")));
    return;
  }
  const out = [];
  let day = "";
  for (const a of data) {
    const d = ammanDay(a.published_at);
    if (d !== day) { day = d; out.push(h("li", { class: "day-sep", style: "display:block" }, date(a.published_at))); }
    const active = new Date(a.breaking_until) > new Date();
    const c = a.countries?.[0];
    out.push(h("li", { class: (active ? "" : "expired ") + (fresh.has(a.id) ? "card is-new" : "") },
      h("span", { class: "tl-time num" }, time(a.published_at)),
      h("span", { class: "tl-dot", "aria-hidden": "true" }),
      h("div", {},
        h("h3", { dir: titleDir(a) }, h("a", { href: `article.html?id=${a.id}` }, titleOf(a))),
        !EN && a.summary ? h("p", { class: "note", style: "font-size:14px;margin:0" }, a.summary) : null,
        h("div", { class: "meta-row" },
          c ? h("span", { class: "chip place-chip" }, flag(c), " ", countryName(c)) : null,
          h("span", { class: "src" }, srcName(sources.get(a.source_id))), h("span", { class: "chip cat" }, CAT_NAME[a.category] || ""), verificationChip(a.verification)))));
  }
  timeline.replaceChildren(...out);
}

async function refresh() { await Promise.all([loadEvents(), loadTimeline()]); }

async function boot() {
  root.replaceChildren(
    h("div", { class: "section-head" },
      h("h2", {}, where ? L("عاجل — ", "Breaking — ") + where : L("الأخبار العاجلة العالمية", "Global breaking news")),
      h("span", { class: "meta" }, L("الأهم عالمياً الآن · مرتبة من 0 إلى 100", "Most important worldwide now · ranked 0–100"))),
    filters(),
    methodology(),
    breakingList,
    h("div", { class: "section-head" }, h("h2", {}, L("الأهم عالمياً خلال 12 ساعة", "Top stories worldwide, last 12 hours"))),
    topList,
    h("div", { class: "section-head" }, h("h2", {}, L("سجل العاجل", "Breaking timeline")), h("span", { class: "meta" }, L("آخر 48 ساعة · بتوقيت عمّان", "Last 48 hours · Amman time"))),
    timeline);
  if (!configured) return notConfiguredState(breakingList);
  try {
    sources = await loadSources();
    await Promise.all([refresh(), loadCountries().catch(() => {})]);
    const s = await fetchStatus().catch(() => null);
    chrome.setLiveState("connecting", s?.last_run_at);
    chrome.refreshTicker();
    const live = new Live({
      onTick: async () => { await refresh(); chrome.refreshTicker(); const st = await fetchStatus().catch(() => null); chrome.setLiveState(live.state(), st?.last_run_at); },
      onChanged: () => { lastIds = ""; lastKey = ""; refresh(); chrome.refreshTicker(); },
      onState: (st) => chrome.setLiveState(st),
    });
    live.start();
  } catch (e) {
    breakingList.replaceChildren(h("li", { class: "error-box", style: "display:block" }, friendlyError(e)));
  }
}
boot();
