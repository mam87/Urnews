// Article page: headline, labelled summary, attribution, link to original, related coverage.
import { sb, h, ARTICLE_COLS, CAT_NAME, VERIFICATION, SUMMARY_KIND, configured, loadSources, friendlyError, notConfiguredState, full, ago, verificationChip, toast } from "./common.js";
import { renderChrome, fetchStatus, ICONS } from "./layout.js";
import { Live } from "./live.js";

const chrome = renderChrome({ active: "article" });
const root = document.getElementById("app");
const id = Number(new URLSearchParams(location.search).get("id"));

function notFound() {
  root.replaceChildren(h("div", { class: "state" }, h("h3", {}, "الخبر غير متوفر"),
    "ربما حُذف أو أُخفي من قبل التحرير، أو أن الرابط غير صحيح. ", h("a", { href: "index.html" }, "العودة للرئيسية")));
}

async function render() {
  const { data: a, error } = await sb.from("news_articles").select(ARTICLE_COLS).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!a) return notFound();
  const sources = await loadSources();
  const src = sources.get(a.source_id);
  document.title = `${a.title} — نبض الأخبار`;
  document.querySelector('meta[name="description"]')?.setAttribute("content", a.summary || a.title);

  let related = [];
  if (a.cluster_id) {
    const { data } = await sb.from("news_articles").select("id,title,source_id,published_at,url,verification")
      .eq("cluster_id", a.cluster_id).eq("status", "published").is("duplicate_of", null).neq("id", a.id)
      .order("published_at", { ascending: true }).limit(20);
    related = data || [];
  }
  const breakingNow = a.is_breaking && new Date(a.breaking_until) > new Date();
  const v = VERIFICATION[a.verification] || VERIFICATION.reported;
  const foreign = a.language !== "ar" && !a.translated;

  const share = async () => {
    const data = { title: a.title, url: location.href };
    try {
      if (navigator.share) await navigator.share(data);
      else { await navigator.clipboard.writeText(location.href); toast("تم نسخ الرابط"); }
    } catch { /* cancelled */ }
  };

  root.replaceChildren(h("article", { class: "article" },
    h("div", { class: "kicker" },
      h("a", { class: "chip cat", href: `index.html?cat=${a.category}` }, CAT_NAME[a.category] || ""),
      breakingNow ? h("span", { class: "chip breaking" }, "عاجل") : null,
      verificationChip(a.verification),
      a.translated ? h("span", { class: "chip lang" }, "مترجم آلياً") : null),
    h("h1", { dir: foreign ? "ltr" : null }, a.title),
    a.translated && a.title_original ? h("p", { class: "note", dir: "ltr", lang: "en" }, "العنوان الأصلي: " + a.title_original) : null,
    h("div", { class: "byline" },
      h("span", {}, "المصدر: ", h("b", {}, src?.name_ar || "غير معروف")),
      h("span", { class: "num" }, "نُشر: ", h("time", { datetime: a.published_at }, full(a.published_at)), a.published_estimated ? " (تقريبي — لم يحدد المصدر وقتاً)" : ""),
      h("span", { class: "num" }, "جُلب: ", ago(a.fetched_at))),
    src?.allow_images && a.image_url ? h("figure", { class: "article-figure" }, h("img", { src: a.image_url, alt: "", referrerpolicy: "no-referrer" }), h("figcaption", {}, "الصورة: " + (src?.name_ar || "المصدر"))) : null,
    a.summary ? [
      h("p", { class: "summary-box", dir: foreign ? "ltr" : null }, a.summary),
      h("div", { class: "summary-label" }, "ℹ︎ ", SUMMARY_KIND[a.summary_kind] || SUMMARY_KIND.feed, a.edited ? " · عُدّل تحريرياً" : ""),
    ] : h("p", { class: "note" }, "لا يتوفر ملخص لهذا الخبر. اقرأ التفاصيل لدى المصدر الأصلي."),
    h("div", { class: "cta" },
      h("a", { class: "btn btn-primary", href: a.url, target: "_blank", rel: "noopener noreferrer nofollow" }, "اقرأ الخبر كاملاً لدى " + (src?.name_ar || "المصدر"), ICONS.ext()),
      h("button", { class: "btn", type: "button", onclick: share }, ICONS.share(), "مشاركة")),
    h("div", { class: "notice" + (a.verification === "allegation" || a.verification === "developing" ? " warn" : "") },
      h("b", {}, v.label + ": "), v.hint + ". ",
      a.verification !== "confirmed" && a.verification !== "official" ? "تكرار الخبر في عدة مواقع لا يعني تأكيده." : ""),
    related.length ? h("section", { class: "related" },
      h("h2", {}, `تغطيات أخرى للحدث نفسه (${related.length})`),
      h("ul", {}, related.map((r) => h("li", {},
        h("a", { href: `article.html?id=${r.id}` }, r.title),
        h("div", { class: "meta-row" }, h("span", { class: "src" }, sources.get(r.source_id)?.name_ar || ""), h("span", { class: "num" }, full(r.published_at)), verificationChip(r.verification)))))) : null));
}

async function boot() {
  if (!configured) return notConfiguredState(root);
  if (!Number.isInteger(id) || id <= 0) return notFound();
  try {
    await render();
    const status = await fetchStatus().catch(() => null);
    chrome.setLiveState("connecting", status?.last_run_at);
    chrome.refreshTicker();
    live = new Live({
      onTick: async () => { chrome.refreshTicker(); const s = await fetchStatus().catch(() => null); chrome.setLiveState(live.state(), s?.last_run_at); },
      onChanged: (changed) => { if (changed === id) render().catch(() => {}); chrome.refreshTicker(); },
      onState: (s) => chrome.setLiveState(s),
    });
    live.start();
  } catch (e) {
    root.replaceChildren(h("div", { class: "error-box" }, friendlyError(e), " ", h("button", { class: "btn", type: "button", onclick: boot }, "إعادة المحاولة")));
  }
}
let live;
boot();
