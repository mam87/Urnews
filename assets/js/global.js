// Global breaking news: ranked worldwide events (news_global_events, rewritten by every ingest run).
import { sb, h, ago, time, srcName } from "./common.js";
import { EN, L, REGION_NAME, countryName, flag, titleOf, titleDir } from "./i18n.js";

export const STATUS = {
  developing: { label: L("قيد التطور", "Developing"), hint: L("الحدث يتطور وقد تتغير تفاصيله", "The event is developing and details may change") },
  confirmed: { label: L("مؤكَّد من مصادر مستقلة", "Confirmed"), hint: L("أكدته 3 جهات نشر مستقلة على الأقل، منها جهتان عاليتا الموثوقية (أو راجعه محرر)", "Reported by at least 3 independent publishers, 2 of them highly reliable (or verified by an editor)") },
  updated: { label: L("محدَّث", "Updated"), hint: L("وصلت تقارير جديدة عن الحدث خلال آخر 30 دقيقة", "New reports arrived in the last 30 minutes") },
};

const PART_LABELS = EN
  ? [["impact", "Global impact", 30], ["freshness", "Freshness", 25], ["credibility", "Source credibility", 20], ["independence", "Independent coverage", 15], ["velocity", "Development speed", 10]]
  : [["impact", "الأثر العالمي", 30], ["freshness", "حداثة الخبر", 25], ["credibility", "موثوقية المصدر", 20], ["independence", "التغطية المستقلة", 15], ["velocity", "سرعة التطور", 10]];

export function scoreTitle(e) {
  return L("درجة الأهمية العالمية ", "Global importance score ") + e.score + "/100\n" +
    PART_LABELS.map(([k, label, max]) => `${label}: ${e.parts?.[k] ?? 0}/${max}`).join("\n");
}

/** Ranked events (optionally breaking only / one region / one country) with their reports attached. */
export async function fetchGlobalEvents({ breakingOnly = false, region = null, country = null, limit = 30 } = {}) {
  let q = sb.from("news_global_events").select("*").order("rank", { ascending: true }).limit(limit);
  if (breakingOnly) q = q.eq("is_breaking", true);
  if (region) q = q.eq("region", region);
  if (country) q = q.contains("countries", [country]);
  const { data: events, error } = await q;
  if (error) throw error;
  const ids = [...new Set(events.flatMap((e) => [e.lead_article_id, e.lead_ar_id, e.lead_en_id, e.first_article_id]).filter(Boolean))];
  const arts = new Map();
  if (ids.length) {
    const { data, error: e2 } = await sb.from("news_articles")
      .select("id,title,title_en,title_original,language,translated,url,source_id,published_at,summary,status")
      .in("id", ids.slice(0, 300));
    if (e2) throw e2;
    for (const a of data || []) arts.set(a.id, a);
  }
  return events.map((e) => ({ ...e, arts })).filter((e) => e.arts.has(e.lead_article_id));
}

/** The report to show for this event in the reader's language (falls back to the other language). */
export function eventHead(e) {
  const g = (id) => (id ? e.arts.get(id) : null);
  return EN ? g(e.lead_en_id) || g(e.lead_article_id) || g(e.lead_ar_id) : g(e.lead_ar_id) || g(e.lead_article_id) || g(e.lead_en_id);
}

const band = (s) => (s >= 80 ? "high" : s >= 60 ? "mid" : "low");

export function scoreBadge(e) {
  return h("span", { class: "score", dataset: { band: band(e.score) }, title: scoreTitle(e), "aria-label": L(`درجة الأهمية ${e.score} من 100`, `Importance ${e.score} out of 100`) },
    h("b", { class: "num" }, String(e.score)), h("small", {}, "/100"));
}

export function statusChips(e) {
  const st = STATUS[e.status] || STATUS.developing;
  return [
    e.is_breaking ? h("span", { class: "chip breaking" }, L("عاجل", "Breaking")) : null,
    h("span", { class: `chip st-${e.status}`, title: st.hint }, st.label),
    e.status === "updated" && e.confirmed ? h("span", { class: "chip st-confirmed", title: STATUS.confirmed.hint }, STATUS.confirmed.label) : null,
    e.single_source ? h("span", { class: "chip v-developing", title: L("لم تؤكده بعد جهة نشر مستقلة ثانية. يُعرض لأن مصدره عالي الموثوقية.", "Not yet corroborated by a second independent publisher. Shown because its source is highly reliable.") },
      L("تقرير من مصدر واحد", "Single-source report")) : null,
  ];
}

export function placeChips(e) {
  const cs = (e.countries || []).slice(0, 2);
  return h("span", { class: "place" },
    cs.length ? cs.map((c, i) => [i ? "، " : "", h("a", { href: `index.html?country=${c}`, title: L("كل أخبار ", "All news from ") + countryName(c) }, flag(c), " ", countryName(c))])
      : [flag(null), " ", L("دولي", "International")],
    e.region ? [" · ", h("a", { class: "region", href: `breaking.html?region=${e.region}` }, REGION_NAME[e.region] || "")] : null);
}

export function coverageText(e) {
  const n = e.independent_count, m = e.publisher_count;
  const ind = EN ? `${n} independent publisher${n === 1 ? "" : "s"}` : n === 1 ? "جهة نشر واحدة" : n === 2 ? "جهتا نشر مستقلتان" : n <= 10 ? `${n} جهات نشر مستقلة` : `${n} جهة نشر مستقلة`;
  const extra = m > n ? L(` (${m} وسيلة؛ نسخ الوكالات تُحسب مرة واحدة)`, ` (${m} outlets; wire copies counted once)`) : "";
  return ind + extra;
}

/** Full event card for the Global Breaking section. */
export function eventCard(e, sources, { rank = true } = {}) {
  const a = eventHead(e);
  const first = e.arts.get(e.first_article_id) || a;
  const firstSrc = sources.get(first.source_id);
  const otherLang = EN ? !a.title_en : a.language !== "ar";
  const updatedLater = new Date(e.last_seen) - new Date(e.first_seen) > 5 * 60_000;
  return h("li", { class: "gev" + (e.is_breaking ? " is-breaking" : ""), dataset: { key: e.key } },
    rank ? h("div", { class: "gev-rank num", "aria-hidden": "true" }, String(e.rank)) : null,
    h("div", { class: "gev-body" },
      h("div", { class: "meta-row", style: "margin:0" }, ...statusChips(e),
        otherLang ? h("span", { class: "chip lang" }, EN ? "Arabic" : "بالإنجليزية") : null),
      h("h3", { dir: titleDir(a) }, h("a", { href: `article.html?id=${a.id}` }, titleOf(a))),
      h("div", { class: "gev-meta" },
        placeChips(e),
        h("span", { class: "num", title: new Date(e.first_seen).toISOString() }, time(e.first_seen), " · ", ago(e.first_seen),
          updatedLater ? L(" · آخر تحديث ", " · latest ") + ago(e.last_seen) : "")),
      h("div", { class: "gev-meta" },
        h("span", {}, L("المصدر الأصلي: ", "Original source: "),
          h("a", { href: first.url, target: "_blank", rel: "noopener noreferrer nofollow" }, srcName(firstSrc) || L("المصدر", "source"), " ↗")),
        h("span", { class: "more-src" }, coverageText(e)))),
    scoreBadge(e));
}

/** Compact row for side panels. */
export function eventRow(e) {
  const a = eventHead(e);
  return h("li", {},
    h("a", { href: `article.html?id=${a.id}`, dir: titleDir(a) }, flag(e.countries?.[0]), " ", titleOf(a)),
    h("span", { class: "t num", title: scoreTitle(e) }, `${e.score} · ${ago(e.first_seen)}`));
}
