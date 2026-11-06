// Full reports («تقارير كاملة»): shared queries and labels. Readers only ever receive published stories
// (Row Level Security in the database); editors signed in on the public site see drafts only as a labelled preview.
import { sb, h, ago } from "./common.js";
import { EN, L } from "./i18n.js";

export const STORY_COLS = "id,event_id,language,cluster_id,category,countries,region,title,dek,body,word_count,hero_image_url,hero_image_credit,hero_source_id,byline,origin,status,publish_at,published_at,content_updated_at,source_count,publisher_count,created_at";
export const STORY_LIST_COLS = "id,language,title,dek,category,countries,published_at,content_updated_at,source_count,publisher_count,word_count";
export const SITE_LANG = EN ? "en" : "ar";
export const storyHref = (id) => `article.html?story=${id}`;

/** Paragraph labels (what kind of information it is), by the story's own language. */
const KIND_EN = {
  fact:       { label: "Corroborated",          hint: "Reported consistently by independent sources, or by an official body about its own actions" },
  statement:  { label: "Official statement",    hint: "What a named person or body said, attributed to them" },
  allegation: { label: "Unverified claim",      hint: "A claim made by one party that has not been independently confirmed" },
  developing: { label: "Developing",            hint: "Reported by a single source, or details still changing" },
  analysis:   { label: "Editorial analysis",    hint: "Our explanation of the reported facts — contains no new facts" },
};
const KIND_AR = {
  fact:       { label: "وقائع متطابقة",       hint: "نقلتها مصادر مستقلة بشكل متطابق، أو أعلنتها جهة رسمية عن نفسها" },
  statement:  { label: "تصريح رسمي",          hint: "ما قاله شخص أو جهة مسمّاة، منسوباً إليها" },
  allegation: { label: "ادعاء غير مؤكد",       hint: "رواية طرف واحد لم تتأكد من مصادر مستقلة" },
  developing: { label: "معلومات أولية",        hint: "نقلها مصدر واحد أو ما زالت تفاصيلها تتغير" },
  analysis:   { label: "تحليل تحريري",         hint: "شرح من فريق التحرير للوقائع المنشورة — لا يضيف وقائع جديدة" },
};
export const kindLabels = (lang) => (lang === "en" ? KIND_EN : KIND_AR);
export const KIND = kindLabels(EN ? "en" : "ar");

/** Section headings, in the order the article uses them. */
const SECTION_EN = {
  event: "What happened", background: "Background", statements: "Official statements", reactions: "Reactions",
  impact: "Impact", next: "What happens next", disagreements: "Where sources differ", analysis: "Analysis",
};
const SECTION_AR = {
  event: "ماذا حدث", background: "الخلفية والسياق", statements: "التصريحات الرسمية", reactions: "ردود الفعل",
  impact: "التأثير", next: "ماذا بعد", disagreements: "روايات متباينة", analysis: "تحليل",
};
export const sectionLabels = (lang) => (lang === "en" ? SECTION_EN : SECTION_AR);
export const SECTION = sectionLabels(EN ? "en" : "ar");

export const STORY_STATUS = EN
  ? { draft: "Draft", approved: "Approved", scheduled: "Scheduled", published: "Published", rejected: "Rejected", unpublished: "Unpublished" }
  : { draft: "مسودة", approved: "معتمد", scheduled: "مجدول", published: "منشور", rejected: "مرفوض", unpublished: "سُحب من النشر" };

export const CORRECTION = EN
  ? { correction: "Correction", update: "Update", clarification: "Clarification" }
  : { correction: "تصحيح", update: "تحديث", clarification: "توضيح" };

export const bylineText = (b) => (!b || b === "editorial" ? L("فريق تحرير لحظة", "Lahza editorial team") : b);

/** Reading time in minutes (Arabic reads a little slower per word). */
export const readingMinutes = (words, lang) => Math.max(1, Math.round((words || 0) / (lang === "en" ? 230 : 180)));

/** Latest published reports in the reader's language. */
export async function fetchLatestStories({ limit = 5, category = null, country = null, excludeId = null } = {}) {
  if (!sb) return [];
  let qb = sb.from("news_stories").select(STORY_LIST_COLS).eq("status", "published").eq("language", SITE_LANG)
    .order("published_at", { ascending: false }).limit(limit + (excludeId ? 1 : 0));
  if (category) qb = qb.eq("category", category);
  if (country) qb = qb.contains("countries", [country]);
  const { data, error } = await qb;
  if (error) throw error;
  return (data || []).filter((s) => s.id !== excludeId).slice(0, limit);
}

/** The published report (in the reader's language) about a report cluster, if any. */
export async function storyForCluster(clusterId) {
  if (!sb || !clusterId) return null;
  const { data } = await sb.from("news_stories").select("id,title,language").eq("cluster_id", clusterId).eq("status", "published")
    .eq("language", SITE_LANG).limit(1);
  return data?.[0] || null;
}

export const storyListItem = (s) => h("li", {},
  h("a", { href: storyHref(s.id) }, s.title),
  h("span", { class: "t num" }, L(`${s.source_count} مصادر · `, `${s.source_count} sources · `) + ago(s.content_updated_at || s.published_at)));
