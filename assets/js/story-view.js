// Full report page (article.html?story=ID): original article with labelled, cited paragraphs, timeline,
// corrections, source references, share/print, SEO metadata and NewsArticle structured data.
import { sb, h, full, ago, CAT_NAME, toast, friendlyError } from "./common.js";
import { EN, L, flag, countryName, isCountry, REGION_NAME } from "./i18n.js";
import { ICONS } from "./layout.js";
import { saveButton } from "./saved.js";
import {
  STORY_COLS, SITE_LANG, storyHref, kindLabels, sectionLabels, CORRECTION, STORY_STATUS, bylineText, readingMinutes, fetchLatestStories, storyListItem,
} from "./stories.js";

const SITE_URL_FALLBACK = "https://mam87.github.io/Urnews/";

function setMeta(attr, key, value) {
  let m = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!value) { m?.remove(); return; }
  if (!m) { m = document.createElement("meta"); m.setAttribute(attr, key); document.head.append(m); }
  m.setAttribute("content", value);
}
function setLink(rel, href) {
  let l = document.head.querySelector(`link[rel="${rel}"]`);
  if (!l) { l = document.createElement("link"); l.rel = rel; document.head.append(l); }
  l.href = href;
}
function absolute(path) {
  try { return new URL(path, location.href.startsWith("http") ? location.href : SITE_URL_FALLBACK).toString(); } catch { return path; }
}

/** SEO + social metadata and schema.org NewsArticle (a JSON data block, never executed). */
export function applySeo(s, sources, isPublic) {
  const url = absolute(storyHref(s.id));
  document.title = `${s.title} — ${L("لحظة", "Lahza")}`;
  setMeta("name", "description", s.dek);
  setMeta("name", "robots", isPublic ? "index, follow, max-image-preview:large" : "noindex, nofollow");
  setLink("canonical", url);
  setMeta("property", "og:type", "article");
  setMeta("property", "og:title", s.title);
  setMeta("property", "og:description", s.dek);
  setMeta("property", "og:url", url);
  setMeta("property", "og:site_name", L("لحظة", "Lahza"));
  setMeta("property", "og:locale", s.language === "en" ? "en_GB" : "ar_AR");
  setMeta("property", "og:image", s.hero_image_url || null);
  setMeta("property", "article:published_time", s.published_at || null);
  setMeta("property", "article:modified_time", s.content_updated_at || s.published_at || null);
  setMeta("property", "article:section", CAT_NAME[s.category] || null);
  setMeta("name", "twitter:card", s.hero_image_url ? "summary_large_image" : "summary");
  setMeta("name", "twitter:title", s.title);
  setMeta("name", "twitter:description", s.dek);
  const ld = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: s.title.slice(0, 110),
    description: s.dek,
    inLanguage: s.language,
    datePublished: s.published_at || undefined,
    dateModified: s.content_updated_at || s.published_at || undefined,
    articleSection: CAT_NAME[s.category] || undefined,
    wordCount: s.word_count || undefined,
    image: s.hero_image_url ? [s.hero_image_url] : undefined,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    author: { "@type": "Organization", name: bylineText(s.byline), url: absolute("sources.html") },
    publisher: { "@type": "Organization", name: L("لحظة", "Lahza"), logo: { "@type": "ImageObject", url: absolute("assets/icon.svg") } },
    contentLocation: (s.countries || []).filter(isCountry).map((c) => ({ "@type": "Place", name: countryName(c) })),
    isBasedOn: sources.map((x) => x.url),
    citation: sources.map((x) => ({ "@type": "CreativeWork", name: x.title || x.publisher_name, url: x.url, publisher: { "@type": "Organization", name: x.publisher_name } })),
  };
  let tag = document.getElementById("ld-article");
  if (!tag) { tag = document.createElement("script"); tag.type = "application/ld+json"; tag.id = "ld-article"; document.head.append(tag); }
  tag.textContent = JSON.stringify(ld).replace(/</g, "\\u003c");
}

function cite(nums, lang) {
  if (!nums?.length) return null;
  return h("sup", { class: "cite" }, nums.map((n, i) => [i ? h("span", { class: "sep" }, lang === "en" ? "," : "،") : null,
    h("a", { href: `#ref-${n}`, "aria-label": (lang === "en" ? "Source " : "المصدر ") + n }, String(n))]));
}

function shareBar(s) {
  const url = absolute(storyHref(s.id));
  const enc = encodeURIComponent;
  const text = enc(s.title);
  const native = async () => {
    try {
      if (navigator.share) await navigator.share({ title: s.title, text: s.dek, url });
      else { await navigator.clipboard.writeText(url); toast(L("تم نسخ الرابط", "Link copied")); }
    } catch { /* cancelled */ }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast(L("تم نسخ الرابط", "Link copied")); } catch { toast(url); } };
  const ext = (label, href) => h("a", { class: "btn", href, target: "_blank", rel: "noopener noreferrer" }, label);
  return h("div", { class: "story-tools no-print", role: "group", "aria-label": L("مشاركة وطباعة", "Share and print") },
    h("button", { class: "btn btn-primary", type: "button", onclick: native }, ICONS.share(), L("مشاركة", "Share")),
    ext("X", `https://x.com/intent/post?text=${text}&url=${enc(url)}`),
    ext("Facebook", `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`),
    ext("WhatsApp", `https://wa.me/?text=${text}%20${enc(url)}`),
    ext("Telegram", `https://t.me/share/url?url=${enc(url)}&text=${text}`),
    h("button", { class: "btn", type: "button", onclick: copy }, L("نسخ الرابط", "Copy link")),
    h("button", { class: "btn", type: "button", onclick: () => window.print() }, L("طباعة", "Print")),
    saveButton("story", s.id, s.title, toast));
}

export async function renderStory(root, id) {
  const { data: s, error } = await sb.from("news_stories").select(STORY_COLS).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!s) return false;
  const isPublic = s.status === "published" || (s.status === "scheduled" && s.publish_at && new Date(s.publish_at) <= new Date());

  // Reader's language: open the linked version of the same event when it is published.
  if (s.language !== SITE_LANG && isPublic) {
    const { data: sib } = await sb.from("news_stories").select("id").eq("event_id", s.event_id).eq("language", SITE_LANG).eq("status", "published").limit(1);
    if (sib?.[0]) { const u = new URL(location.href); u.searchParams.set("story", sib[0].id); location.replace(u.toString()); return true; }
  }
  const [{ data: sources, error: e2 }, { data: corrections, error: e3 }, { data: siblings }] = await Promise.all([
    sb.from("news_story_sources").select("n,publisher_name,url,title,language,published_at,verification,license,source_id").eq("story_id", id).eq("pending", false).order("n"),
    sb.from("news_story_corrections").select("id,kind,note,created_at").eq("story_id", id).eq("is_public", true).order("created_at", { ascending: false }),
    sb.from("news_stories").select("id,language,status").eq("event_id", s.event_id).neq("id", id).eq("status", "published"),
  ]);
  if (e2) throw e2;
  if (e3) throw e3;
  const lang = s.language;
  const T = (ar, en) => (lang === "en" ? en : ar);
  const dir = lang === "en" ? "ltr" : "rtl";
  const KIND = kindLabels(lang), SECTION = sectionLabels(lang);
  applySeo(s, sources || [], isPublic);

  const paras = (s.body?.sections || []).flatMap((x) => x.paras || []);
  const kindsUsed = [...new Set(paras.map((p) => p.k))];
  const minutes = readingMinutes(s.word_count, lang);
  const place = (s.countries || []).filter(isCountry).slice(0, 4);
  const sibling = (siblings || [])[0];

  const article = h("article", { class: "article story", lang, dir },
    !isPublic ? h("div", { class: "notice warn preview-banner" }, h("b", {}, L("معاينة تحريرية — غير منشور. ", "Editorial preview — not published. ")),
      L("الحالة: ", "Status: ") + (STORY_STATUS[s.status] || s.status) + ". ", L("لا يراها القراء حتى يعتمدها محرر.", "Readers cannot see this until an editor approves it.")) : null,
    h("div", { class: "kicker" },
      h("span", { class: "chip story-chip" }, T("تقرير كامل", "Full report")),
      h("a", { class: "chip cat", dataset: { cat: s.category }, href: `index.html?cat=${s.category}` }, CAT_NAME[s.category] || ""),
      place.map((c) => h("a", { class: "chip place-chip", href: `index.html?country=${c}` }, flag(c), " ", countryName(c))),
      s.region && REGION_NAME[s.region] ? h("a", { class: "chip lang", href: `breaking.html?region=${s.region}` }, REGION_NAME[s.region]) : null,
      kindsUsed.includes("developing") ? h("span", { class: "chip v-developing" }, T("قصة متطورة", "Developing story")) : null),
    h("h1", {}, s.title),
    h("p", { class: "dek" }, s.dek),
    h("div", { class: "byline" },
      h("span", {}, T("بقلم: ", "By ") , h("b", {}, bylineText(s.byline))),
      s.published_at ? h("span", { class: "num" }, T("نُشر: ", "Published: "), h("time", { datetime: s.published_at }, full(s.published_at))) : null,
      s.content_updated_at ? h("span", { class: "num updated" }, T("حُدّث: ", "Updated: "), h("time", { datetime: s.content_updated_at }, full(s.content_updated_at))) : null,
      h("span", { class: "num" }, T(`مدة القراءة: ${minutes} ${minutes === 1 ? "دقيقة" : minutes === 2 ? "دقيقتان" : minutes <= 10 ? "دقائق" : "دقيقة"}`, `${minutes} min read`)),
      h("span", { class: "num" }, T(`${s.source_count} مصادر من ${s.publisher_count} جهات نشر`, `${s.source_count} sources from ${s.publisher_count} publishers`))),
    s.hero_image_url ? h("figure", { class: "article-figure" },
      h("img", { src: s.hero_image_url, alt: "", referrerpolicy: "no-referrer", loading: "eager", onerror: (e) => e.target.closest("figure")?.remove() }),
      h("figcaption", {}, T("الصورة: ", "Image: ") + (s.hero_image_credit || ""))) : null,
    shareBar(s),
    sibling ? h("p", { class: "note no-print" }, h("a", { href: storyHref(sibling.id) + (sibling.language === "en" ? "&lang=en" : "&lang=ar") },
      sibling.language === "en" ? "Read this report in English →" : "اقرأ هذا التقرير بالعربية ←")) : null,
    lang !== SITE_LANG ? h("p", { class: "note" }, L("هذا التقرير متاح بالإنجليزية فقط.", "This report is available in Arabic only.")) : null,
    h("div", { class: "story-body" },
      (s.body?.sections || []).map((sec) => h("section", { class: "story-section" + (sec.key === "analysis" ? " is-analysis" : sec.key === "disagreements" ? " is-disagreement" : "") },
        h("h2", {}, sec.heading || SECTION[sec.key] || ""),
        (sec.paras || []).map((p) => h("p", { class: "para k-" + p.k },
          p.k !== "fact" && sec.key !== "analysis" ? h("span", { class: `kind-badge k-${p.k}`, title: KIND[p.k]?.hint }, KIND[p.k]?.label) : null,
          p.t, cite(p.r, lang)))))),
    s.body?.timeline?.length ? h("section", { class: "story-timeline" },
      h("h2", {}, T("التسلسل الزمني", "Timeline")),
      h("p", { class: "note" }, T("الأوقات هي أوقات نشر أول تقرير عن كل تطور (بتوقيت عمّان)، وليست بالضرورة وقت وقوعه.",
        "Times are when each development was first reported (Amman time), not necessarily when it happened.")),
      h("ol", { class: "tl" }, s.body.timeline.map((e) => h("li", {},
        h("time", { class: "num", datetime: e.at }, full(e.at).replace(/ \(.*\)$/, "")),
        h("span", {}, e.t, cite(e.r, lang)))))) : null,
    (corrections || []).length ? h("section", { class: "story-corrections", id: "corrections" },
      h("h2", {}, T("التصحيحات والتحديثات", "Corrections and updates")),
      h("ul", {}, corrections.map((c) => h("li", {}, h("b", {}, (CORRECTION[c.kind] || c.kind) + " · "), h("time", { class: "num", datetime: c.created_at }, full(c.created_at)), h("p", {}, c.note))))) : null,
    h("section", { class: "story-legend" },
      h("h2", {}, T("كيف تقرأ هذا التقرير", "How to read this report")),
      h("dl", {}, ["fact", "statement", "allegation", "developing", "analysis"].map((k) => [h("dt", {}, h("span", { class: `kind-badge k-${k}` }, KIND[k].label)), h("dd", {}, KIND[k].hint)])),
      h("p", { class: "note" }, s.origin === "ai"
        ? T("كُتب هذا التقرير بمساعدة الذكاء الاصطناعي اعتماداً حصرياً على العناوين والمقتطفات المنشورة في المصادر المذكورة أدناه، وراجعه محرر قبل النشر. كل فقرة تشير إلى مصادرها. إذا لاحظت خطأً فراسلنا.",
            "This report was drafted with AI assistance using only the headlines and excerpts published by the sources listed below, and was reviewed by an editor before publication. Every paragraph cites its sources. If you spot an error, tell us.")
        : T("كتب هذا التقرير فريق التحرير اعتماداً على المصادر المذكورة أدناه.", "Written by our editors from the sources listed below."))),
    h("section", { class: "story-sources", id: "sources" },
      h("h2", {}, T("المصادر", "Sources")),
      h("ol", {}, (sources || []).map((x) => h("li", { id: `ref-${x.n}`, value: x.n },
        h("b", {}, x.publisher_name), x.title ? [" — ", h("span", { dir: "auto" }, x.title)] : null,
        x.published_at ? h("span", { class: "num t" }, " · " + full(x.published_at).replace(/ \(.*\)$/, "")) : null,
        x.license ? h("span", { class: "t" }, " · " + T("الترخيص: ", "Licence: ") + x.license) : null,
        " ", h("a", { href: x.url, target: "_blank", rel: "noopener noreferrer nofollow", class: "src-link" }, T("التقرير الأصلي ↗", "Original report ↗")),
        h("span", { class: "print-url", dir: "ltr" }, x.url)))),
      h("p", { class: "note" }, T("لم ننسخ نصوص هذه المصادر؛ النصوص الكاملة والصور والفيديو متاحة على مواقع ناشريها.",
        "We do not reproduce these sources; their full text, images and video are on the publishers' own sites."))));

  const relatedList = h("ul", { class: "mini-list" });
  const coverageList = h("ul", { class: "mini-list" });
  const aside = h("aside", { class: "no-print" },
    h("section", { class: "panel" },
      h("dl", { class: "facts" },
        h("dt", {}, L("النوع", "Type")), h("dd", {}, L("تقرير كامل أصلي", "Original full report")),
        h("dt", {}, L("المصادر", "Sources")), h("dd", { class: "num" }, String(s.source_count)),
        h("dt", {}, L("جهات النشر", "Publishers")), h("dd", { class: "num" }, String(s.publisher_count)),
        h("dt", {}, L("الكلمات", "Words")), h("dd", { class: "num" }, String(s.word_count)),
        h("dt", {}, L("آخر تحديث", "Last update")), h("dd", {}, ago(s.content_updated_at || s.published_at || s.created_at)))),
    h("section", { class: "panel", hidden: true, id: "rel-stories" }, h("h2", {}, L("تقارير ذات صلة", "Related reports")), relatedList),
    h("section", { class: "panel", hidden: true, id: "rel-coverage" }, h("h2", {}, L("أحدث التغطيات لهذا الحدث", "Latest coverage of this event")), coverageList));

  root.replaceChildren(h("div", { class: "article-wrap" }, article, aside));

  // Related reports + latest raw coverage (best effort, never blocks the article).
  (async () => {
    try {
      const country = place[0] || null;
      let rel = await fetchLatestStories({ limit: 5, category: s.category, excludeId: s.id });
      if (rel.length < 3 && country) rel = [...rel, ...(await fetchLatestStories({ limit: 5, country, excludeId: s.id }))].filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i);
      if (rel.length) { relatedList.replaceChildren(...rel.slice(0, 5).map(storyListItem)); aside.querySelector("#rel-stories").hidden = false; }
      if (s.cluster_id) {
        const { data } = await sb.from("news_articles").select("id,title,title_en,language,published_at").eq("cluster_id", s.cluster_id)
          .eq("status", "published").is("duplicate_of", null).order("published_at", { ascending: false }).limit(6);
        const rows = (data || []).filter((r) => (EN ? r.title_en : r.language === "ar"));
        if (rows.length) {
          coverageList.replaceChildren(...rows.map((r) => h("li", {}, h("a", { href: `article.html?id=${r.id}` }, EN ? r.title_en : r.title), h("span", { class: "t num" }, ago(r.published_at)))));
          aside.querySelector("#rel-coverage").hidden = false;
        }
      }
    } catch (e) { console.warn(friendlyError(e)); }
  })();
  return true;
}
