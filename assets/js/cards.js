// Article card rendering (shared by home, search and breaking pages).
import { h, CAT_NAME, time, ago, isToday, shortDate, verificationChip, srcName } from "./common.js";
import { EN, L, titleOf, titleDir, flag, countryName, isCountry } from "./i18n.js";

const placeChip = (a) => (isCountry(a.countries?.[0]) ? h("a", { class: "chip place-chip", href: `index.html?country=${a.countries[0]}` }, flag(a.countries[0]), " ", countryName(a.countries[0])) : null);

export function articleLink(a) { return `article.html?id=${a.id}`; }

export function card(a, src, { clusterSize = 1, isNew = false } = {}) {
  const allowImg = a.image_url && src?.allow_images;
  const li = h("li", {
    class: ["card", allowImg ? "has-img" : "", a.is_breaking && new Date(a.breaking_until) > new Date() ? "breaking" : "", a.pinned ? "pinned" : "", isNew ? "is-new" : ""].filter(Boolean).join(" "),
    dataset: { id: a.id, cluster: a.cluster_id ?? "" },
  },
    h("div", { class: "time num" }, h("b", {}, time(a.published_at)), isToday(a.published_at) ? ago(a.published_at) : shortDate(a.published_at)),
    h("div", {},
      h("div", { class: "meta-row", style: "margin:0" },
        h("span", { class: "chip cat", dataset: { cat: a.category } }, CAT_NAME[a.category] || ""),
        a.is_breaking && new Date(a.breaking_until) > new Date() ? h("span", { class: "chip breaking" }, L("عاجل", "Breaking")) : null,
        placeChip(a),
        verificationChip(a.verification),
        !EN && a.translated ? h("span", { class: "chip lang", title: "العنوان مترجم آلياً من " + (a.title_original || "") }, "مترجم") : null,
        !EN && a.language !== "ar" && !a.translated ? h("span", { class: "chip lang" }, a.language === "fr" ? "بالفرنسية" : "بالإنجليزية") : null),
      h("h3", { dir: titleDir(a) }, h("a", { href: articleLink(a) }, titleOf(a))),
      // English edition: the excerpt is shown only when it is in English (the original, not our Arabic translation).
      a.summary && (!EN || !a.translated) ? h("p", { dir: titleDir(a) }, a.summary) : null,
      h("div", { class: "meta-row" },
        h("span", { class: "src" }, srcName(src) || L("مصدر", "Source")),
        clusterSize > 1 ? h("span", { class: "more-src" }, EN ? `+ ${clusterSize - 1} more source${clusterSize > 2 ? "s" : ""}` : `+ ${clusterSize - 1} ${clusterSize - 1 === 1 ? "مصدر آخر" : clusterSize - 1 === 2 ? "مصدران آخران" : "مصادر أخرى"}`) : null)),
    allowImg ? h("img", { class: "img", src: a.image_url, alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer",
      title: L("الصورة: ", "Image: ") + (srcName(src) || L("المصدر", "source")),
      onerror: (e) => { li.classList.remove("has-img"); e.target.remove(); } }) : null);
  return li;
}

export function leadBlock(items, sources, clusterSizes) {
  if (!items.length) return null;
  const [main, ...rest] = items;
  const meta = (a) => h("div", { class: "meta-row" },
    h("span", { class: "chip cat", dataset: { cat: a.category } }, CAT_NAME[a.category] || ""), placeChip(a), verificationChip(a.verification),
    h("span", { class: "src" }, srcName(sources.get(a.source_id))), h("span", { class: "num" }, ago(a.published_at)),
    (clusterSizes.get(a.cluster_id) || 1) > 1 ? h("span", { class: "more-src" }, EN ? `${clusterSizes.get(a.cluster_id)} sources cover this` : clusterSizes.get(a.cluster_id) === 2 ? "مصدران يغطيان الخبر" : `${clusterSizes.get(a.cluster_id)} مصادر تغطي الخبر`) : null);
  return h("section", { class: "lead", "aria-label": L("الأبرز الآن", "Top stories now") },
    h("article", { class: "lead-main" },
      main.image_url && sources.get(main.source_id)?.allow_images
        ? h("a", { href: articleLink(main), class: "lead-img", tabindex: "-1", "aria-hidden": "true" },
            h("img", { src: main.image_url, alt: "", referrerpolicy: "no-referrer", decoding: "async", onerror: (e) => e.target.parentElement?.remove() }))
        : null,
      a_breaking(main) ? h("span", { class: "chip breaking" }, L("عاجل", "Breaking")) : null,
      h("h3", { dir: titleDir(main) }, h("a", { href: articleLink(main) }, titleOf(main))),
      main.summary && (!EN || !main.translated) ? h("p", { dir: titleDir(main) }, main.summary) : null,
      meta(main)),
    h("div", { class: "lead-side" }, rest.map((a) => h("article", {},
      h("div", {}, h("h3", { dir: titleDir(a) }, h("a", { href: articleLink(a) }, titleOf(a))), meta(a)),
      a.image_url && sources.get(a.source_id)?.allow_images
        ? h("img", { class: "thumb", src: a.image_url, alt: "", loading: "lazy", referrerpolicy: "no-referrer", onerror: (e) => e.target.remove() }) : null))));
}

/** Home-page block: top story with image + a few headlines for one category. */
export function sectionBlock(slug, items, sources) {
  if (!items.length) return null;
  const [top, ...rest] = items;
  const img = top.image_url && sources.get(top.source_id)?.allow_images;
  return h("section", { class: "sec", dataset: { cat: slug }, "aria-label": CAT_NAME[slug] },
    h("div", { class: "sec-head" }, h("h2", {}, CAT_NAME[slug]), h("a", { href: `index.html?cat=${slug}` }, L("المزيد ←", "More →"))),
    h("div", { class: "sec-top" + (img ? "" : " noimg") },
      h("div", {}, h("h3", { dir: titleDir(top) }, h("a", { href: articleLink(top) }, titleOf(top))),
        top.summary && (!EN || !top.translated) ? h("p", { dir: titleDir(top) }, top.summary) : null,
        h("div", { class: "meta-row" }, h("span", { class: "src" }, srcName(sources.get(top.source_id))), h("span", { class: "num" }, ago(top.published_at)))),
      img ? h("img", { src: top.image_url, alt: "", loading: "lazy", referrerpolicy: "no-referrer", onerror: (e) => { e.target.parentElement.classList.add("noimg"); e.target.remove(); } }) : null),
    h("ul", {}, rest.slice(0, 3).map((a) => h("li", {}, h("span", { class: "t num" }, time(a.published_at)), h("a", { href: articleLink(a), dir: titleDir(a) }, titleOf(a))))));
}
const a_breaking = (a) => a.is_breaking && new Date(a.breaking_until) > new Date();

/** Rank for "most important": importance + independent coverage + recency decay. */
export function rankScore(a, clusterSize = 1, now = Date.now()) {
  const hours = (now - new Date(a.published_at).getTime()) / 3600000;
  return (a.pinned ? 120 : 0) + (a_breaking(a) ? 30 : 0) + a.importance + 12 * Math.log2(clusterSize) - 5 * hours;
}
