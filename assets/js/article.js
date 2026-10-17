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
  document.title = `${a.title} — لحظة`;
  document.querySelector('meta[name="description"]')?.setAttribute("content", a.summary || a.title);

  let related = [];
  if (a.cluster_id) {
    const { data } = await sb.from("news_articles").select("id,title,summary,source_id,published_at,url,verification")
      .eq("cluster_id", a.cluster_id).eq("status", "published").is("duplicate_of", null).neq("id", a.id)
      .order("published_at", { ascending: true }).limit(20);
    related = data || [];
  }
  const { data: moreCat } = await sb.from("news_articles").select("id,title,source_id,published_at,image_url")
    .eq("status", "published").is("duplicate_of", null).eq("category", a.category).neq("id", a.id)
    .order("published_at", { ascending: false }).limit(6);
  const breakingNow = a.is_breaking && new Date(a.breaking_until) > new Date();
  const v = VERIFICATION[a.verification] || VERIFICATION.reported;
  const foreign = a.language !== "ar" && !a.translated;
  const srcName = src?.name_ar || "المصدر";

  const share = async () => {
    const data = { title: a.title, url: location.href };
    try {
      if (navigator.share) await navigator.share(data);
      else { await navigator.clipboard.writeText(location.href); toast("تم نسخ الرابط"); }
    } catch { /* cancelled */ }
  };
  const readFull = (cls = "btn btn-primary") => h("a", { class: cls, href: a.url, target: "_blank", rel: "noopener noreferrer nofollow" }, "اقرأ الخبر كاملاً لدى " + srcName, ICONS.ext());
  const KIND = { media: "وسيلة إعلام", agency: "وكالة أنباء", official: "جهة رسمية" };

  const main = h("article", { class: "article" },
    h("div", { class: "kicker" },
      h("a", { class: "chip cat", dataset: { cat: a.category }, href: `index.html?cat=${a.category}` }, CAT_NAME[a.category] || ""),
      breakingNow ? h("span", { class: "chip breaking" }, "عاجل") : null,
      verificationChip(a.verification),
      a.translated ? h("span", { class: "chip lang" }, "مترجم آلياً") : null),
    h("h1", { dir: foreign ? "ltr" : null }, a.title),
    a.translated && a.title_original ? h("p", { class: "note", dir: "ltr", lang: "en" }, "العنوان الأصلي: " + a.title_original) : null,
    h("div", { class: "byline" },
      h("span", {}, "المصدر: ", h("b", {}, srcName)),
      h("span", { class: "num" }, "نُشر: ", h("time", { datetime: a.published_at }, full(a.published_at)), a.published_estimated ? " (تقريبي — لم يحدد المصدر وقتاً)" : ""),
      h("span", { class: "num" }, "جُلب: ", ago(a.fetched_at))),
    src?.allow_images && a.image_url ? h("figure", { class: "article-figure" }, h("img", { src: a.image_url, alt: "", referrerpolicy: "no-referrer", onerror: (e) => e.target.closest("figure")?.remove() }), h("figcaption", {}, "الصورة: " + srcName)) : null,
    a.summary ? [
      h("p", { class: "summary-box", dir: foreign ? "ltr" : null }, a.summary),
      h("div", { class: "summary-label" }, "ℹ︎ ", SUMMARY_KIND[a.summary_kind] || SUMMARY_KIND.feed, a.edited ? " · عُدّل تحريرياً" : ""),
    ] : h("p", { class: "note" }, "لا يتوفر مقتطف لهذا الخبر في خلاصة المصدر."),
    h("div", { class: "cta" }, readFull(), h("button", { class: "btn", type: "button", onclick: share }, ICONS.share(), "مشاركة")),
    h("p", { class: "read-more-note" }, "نعرض مقتطفاً فقط؛ النص الكامل والصور والفيديو متاحة على موقع " + srcName + " الرسمي."),
    related.length ? h("section", { class: "coverage" },
      h("h2", {}, `ماذا تقول المصادر الأخرى؟ (${related.length})`),
      related.map((r) => h("div", { class: "item" },
        h("div", { class: "who" }, h("b", {}, sources.get(r.source_id)?.name_ar || ""), h("span", { class: "num" }, full(r.published_at)), verificationChip(r.verification)),
        h("h3", {}, h("a", { href: `article.html?id=${r.id}` }, r.title)),
        r.summary ? h("p", {}, r.summary) : null,
        h("a", { class: "note", href: r.url, target: "_blank", rel: "noopener noreferrer nofollow" }, "الخبر لدى " + (sources.get(r.source_id)?.name_ar || "المصدر") + " ↗")))) : null,
    h("div", { class: "notice" + (a.verification === "allegation" || a.verification === "developing" ? " warn" : "") },
      h("b", {}, v.label + ": "), v.hint + ". ",
      a.verification !== "confirmed" && a.verification !== "official" ? "تكرار الخبر في عدة مواقع لا يعني تأكيده." : ""),
    h("div", { class: "sticky-cta" }, readFull()));

  const aside = h("aside", {},
    h("section", { class: "panel" },
      h("div", { class: "src-card", style: "margin:0 0 12px;border:0;padding:0;background:none" },
        h("span", { class: "avatar" }, srcName.trim().charAt(0)),
        h("div", {}, h("div", { class: "name" }, srcName), h("div", { class: "stars", title: "تقييم موثوقية المصدر" }, "★".repeat(src?.reliability || 3) + "☆".repeat(5 - (src?.reliability || 3))))),
      h("dl", { class: "facts" },
        h("dt", {}, "نوع المصدر"), h("dd", {}, KIND[src?.kind] || "—"),
        h("dt", {}, "القسم"), h("dd", {}, CAT_NAME[a.category] || "—"),
        h("dt", {}, "التحقق"), h("dd", {}, v.label),
        h("dt", {}, "تغطيات"), h("dd", { class: "num" }, related.length ? `${related.length + 1} مصادر` : "مصدر واحد")),
      src?.homepage ? h("a", { class: "btn", style: "margin-top:12px", href: src.homepage, target: "_blank", rel: "noopener noreferrer" }, "موقع " + srcName, ICONS.ext()) : null),
    moreCat?.length ? h("section", { class: "panel" },
      h("h2", {}, "المزيد من " + (CAT_NAME[a.category] || "القسم")),
      h("ul", { class: "mini-list" }, moreCat.map((m) => h("li", {}, h("a", { href: `article.html?id=${m.id}` }, m.title), h("span", { class: "t num" }, (sources.get(m.source_id)?.name_ar || "") + " · " + ago(m.published_at)))))) : null);

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
    root.replaceChildren(h("div", { class: "error-box" }, friendlyError(e), " ", h("button", { class: "btn", type: "button", onclick: boot }, "إعادة المحاولة")));
  }
}
let live;
boot();
