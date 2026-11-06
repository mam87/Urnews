// Article page: headline, labelled summary, attribution, link to original, related coverage.
import { sb, h, ARTICLE_COLS, CAT_NAME, VERIFICATION, SUMMARY_KIND, configured, loadSources, friendlyError, notConfiguredState, full, ago, verificationChip, toast } from "./common.js";
import { renderChrome, fetchStatus, ICONS } from "./layout.js";
import { EN, L, titleOf, titleDir, flag, countryName, isCountry, REGION_NAME } from "./i18n.js";
import { Live } from "./live.js";

const chrome = renderChrome({ active: "article" });
const root = document.getElementById("app");
const id = Number(new URLSearchParams(location.search).get("id"));

function notFound() {
  root.replaceChildren(h("div", { class: "state" }, h("h3", {}, L("الخبر غير متوفر", "Story not available")),
    L("ربما حُذف أو أُخفي من قبل التحرير، أو أن الرابط غير صحيح. ", "It may have been removed by the editors, or the link is wrong. "), h("a", { href: "index.html" }, L("العودة للرئيسية", "Back to home"))));
}

async function render() {
  const { data: a, error } = await sb.from("news_articles").select(ARTICLE_COLS).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!a) return notFound();
  const sources = await loadSources();
  const src = sources.get(a.source_id);
  const head = titleOf(a);
  document.title = `${head} — ${L("لحظة", "Lahza")}`;
  document.querySelector('meta[name="description"]')?.setAttribute("content", (!EN && a.summary) || head);

  let related = [];
  if (a.cluster_id) {
    const { data } = await sb.from("news_articles").select("id,title,title_en,language,translated,summary,source_id,published_at,url,verification")
      .eq("cluster_id", a.cluster_id).eq("status", "published").is("duplicate_of", null).neq("id", a.id)
      .order("published_at", { ascending: true }).limit(20);
    related = data || [];
  }
  const { data: moreCat } = await sb.from("news_articles").select("id,title,title_en,language,source_id,published_at,image_url")
    .eq("status", "published").is("duplicate_of", null).eq("category", a.category).neq("id", a.id)
    .order("published_at", { ascending: false }).limit(6);
  const breakingNow = a.is_breaking && new Date(a.breaking_until) > new Date();
  const v = VERIFICATION[a.verification] || VERIFICATION.reported;
  const dir = titleDir(a);
  const srcName = (EN ? src?.name_en || src?.name_ar : src?.name_ar) || L("المصدر", "the source");
  // English edition shows the publisher's English excerpt, never our Arabic translation of it.
  const summary = EN && a.translated ? null : a.summary;

  const share = async () => {
    const data = { title: head, url: location.href };
    try {
      if (navigator.share) await navigator.share(data);
      else { await navigator.clipboard.writeText(location.href); toast(L("تم نسخ الرابط", "Link copied")); }
    } catch { /* cancelled */ }
  };
  const readFull = (cls = "btn btn-primary") => h("a", { class: cls, href: a.url, target: "_blank", rel: "noopener noreferrer nofollow" }, L("اقرأ الخبر كاملاً لدى ", "Read the full story at ") + srcName, ICONS.ext());
  const KIND = EN ? { media: "News outlet", agency: "News agency", official: "Official body" } : { media: "وسيلة إعلام", agency: "وكالة أنباء", official: "جهة رسمية" };
  const place = (a.countries || []).filter(isCountry).slice(0, 3);

  const main = h("article", { class: "article" },
    h("div", { class: "kicker" },
      h("a", { class: "chip cat", dataset: { cat: a.category }, href: `index.html?cat=${a.category}` }, CAT_NAME[a.category] || ""),
      breakingNow ? h("span", { class: "chip breaking" }, L("عاجل", "Breaking")) : null,
      place.map((c) => h("a", { class: "chip place-chip", href: `index.html?country=${c}` }, flag(c), " ", countryName(c))),
      a.region && REGION_NAME[a.region] ? h("a", { class: "chip lang", href: `breaking.html?region=${a.region}` }, REGION_NAME[a.region]) : null,
      verificationChip(a.verification),
      !EN && a.translated ? h("span", { class: "chip lang" }, "مترجم آلياً") : null),
    h("h1", { dir }, head),
    !EN && a.translated && a.title_original ? h("p", { class: "note" }, "العنوان الأصلي: ", h("span", { dir: "auto" }, a.title_original)) : null,
    EN && !a.title_en ? h("p", { class: "note" }, "Reported in Arabic; no English version is available.") : null,
    h("div", { class: "byline" },
      h("span", {}, L("المصدر: ", "Source: "), h("b", {}, srcName)),
      h("span", { class: "num" }, L("نُشر: ", "Published: "), h("time", { datetime: a.published_at }, full(a.published_at)), a.published_estimated ? L(" (تقريبي — لم يحدد المصدر وقتاً)", " (approximate — the source gave no time)") : ""),
      h("span", { class: "num" }, L("جُلب: ", "Fetched: "), ago(a.fetched_at))),
    src?.allow_images && a.image_url ? h("figure", { class: "article-figure" }, h("img", { src: a.image_url, alt: "", referrerpolicy: "no-referrer", onerror: (e) => e.target.closest("figure")?.remove() }), h("figcaption", {}, L("الصورة: ", "Image: ") + srcName)) : null,
    summary ? [
      h("p", { class: "summary-box", dir }, summary),
      h("div", { class: "summary-label" }, "ℹ︎ ", SUMMARY_KIND[a.summary_kind] || SUMMARY_KIND.feed, a.edited ? L(" · عُدّل تحريرياً", " · edited") : ""),
    ] : h("p", { class: "note" }, L("لا يتوفر مقتطف لهذا الخبر في خلاصة المصدر.", "The source's feed has no excerpt for this story.")),
    h("div", { class: "cta" }, readFull(), h("button", { class: "btn", type: "button", onclick: share }, ICONS.share(), L("مشاركة", "Share"))),
    h("p", { class: "read-more-note" }, L("نعرض مقتطفاً فقط؛ النص الكامل والصور والفيديو متاحة على موقع " + srcName + " الرسمي.", "We show an excerpt only; the full text, images and video are on " + srcName + "'s own site.")),
    related.length ? h("section", { class: "coverage" },
      h("h2", {}, L(`ماذا تقول المصادر الأخرى؟ (${related.length})`, `What other sources say (${related.length})`)),
      related.map((r) => h("div", { class: "item" },
        h("div", { class: "who" }, h("b", {}, (EN ? sources.get(r.source_id)?.name_en : null) || sources.get(r.source_id)?.name_ar || ""), h("span", { class: "num" }, full(r.published_at)), verificationChip(r.verification)),
        h("h3", { dir: titleDir(r) }, h("a", { href: `article.html?id=${r.id}` }, titleOf(r))),
        r.summary && (!EN || !r.translated) ? h("p", { dir: titleDir(r) }, r.summary) : null,
        h("a", { class: "note", href: r.url, target: "_blank", rel: "noopener noreferrer nofollow" }, L("الخبر لدى ", "Story at ") + ((EN ? sources.get(r.source_id)?.name_en : null) || sources.get(r.source_id)?.name_ar || L("المصدر", "the source")) + " ↗")))) : null,
    h("div", { class: "notice" + (a.verification === "allegation" || a.verification === "developing" ? " warn" : "") },
      h("b", {}, v.label + ": "), v.hint + ". ",
      a.verification !== "confirmed" && a.verification !== "official" ? L("تكرار الخبر في عدة مواقع لا يعني تأكيده.", "A story repeated on many sites is not thereby confirmed.") : ""),
    h("div", { class: "sticky-cta" }, readFull()));

  const aside = h("aside", {},
    h("section", { class: "panel" },
      h("div", { class: "src-card", style: "margin:0 0 12px;border:0;padding:0;background:none" },
        h("span", { class: "avatar" }, srcName.trim().charAt(0)),
        h("div", {}, h("div", { class: "name" }, srcName), h("div", { class: "stars", title: L("تقييم موثوقية المصدر", "Source reliability rating") }, "★".repeat(src?.reliability || 3) + "☆".repeat(5 - (src?.reliability || 3))))),
      h("dl", { class: "facts" },
        h("dt", {}, L("نوع المصدر", "Source type")), h("dd", {}, KIND[src?.kind] || "—"),
        h("dt", {}, L("القسم", "Section")), h("dd", {}, CAT_NAME[a.category] || "—"),
        h("dt", {}, L("التحقق", "Verification")), h("dd", {}, v.label),
        h("dt", {}, L("تغطيات", "Coverage")), h("dd", { class: "num" }, related.length ? L(`${related.length + 1} مصادر`, `${related.length + 1} sources`) : L("مصدر واحد", "One source"))),
      src?.homepage ? h("a", { class: "btn", style: "margin-top:12px", href: src.homepage, target: "_blank", rel: "noopener noreferrer" }, L("موقع ", "") + srcName + L("", " website"), ICONS.ext()) : null),
    moreCat?.length ? h("section", { class: "panel" },
      h("h2", {}, L("المزيد من ", "More in ") + (CAT_NAME[a.category] || L("القسم", "this section"))),
      h("ul", { class: "mini-list" }, moreCat.filter((m) => (EN ? m.title_en : m.language === "ar")).map((m) => h("li", {}, h("a", { href: `article.html?id=${m.id}`, dir: titleDir(m) }, titleOf(m)), h("span", { class: "t num" }, ((EN ? sources.get(m.source_id)?.name_en : null) || sources.get(m.source_id)?.name_ar || "") + " · " + ago(m.published_at)))))) : null);

  root.replaceChildren(h("div", { class: "article-wrap" }, main, aside));
  // Mobile sticky "read full article" only once the in-page button has scrolled away.
  const sticky = main.querySelector(".sticky-cta"), inline = main.querySelector(".cta");
  if (sticky && inline && "IntersectionObserver" in window) {
    sticky.hidden = true;
    new IntersectionObserver(([e]) => { sticky.hidden = e.isIntersecting || e.boundingClientRect.top > 0; }).observe(inline);
  }
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
    root.replaceChildren(h("div", { class: "error-box" }, friendlyError(e), " ", h("button", { class: "btn", type: "button", onclick: boot }, L("إعادة المحاولة", "Try again"))));
  }
}
let live;
boot();
