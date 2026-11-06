// Full-article composition: material selection, the writing prompt, and the validator that decides which
// sentences of a model's draft may be kept. Pure functions (no network, no database) so every rule is unit-tested.
//
// Ground rules enforced here (the database enforces the editorial workflow on top of this):
//  * Material = stored headlines + publisher-provided excerpts of ONE event. Nothing else is fetched.
//  * A paragraph is kept only if: it cites sources that exist; every number in it appears in those sources;
//    every quotation is verbatim in an untranslated source text (≤ 25 words); no run of 8+ words is copied
//    from any source; it contains no HTML. Otherwise it is dropped and listed for the editor.
//  * Labels are corrected, never upgraded: a claim citing an allegation is an allegation; a "fact" needs two
//    independent publishers or an official source, otherwise it is "developing".
//  * Too little material, or too much of the draft rejected → no article at all.
import { digitsIn } from "../../news-ingest/lib/ai.ts";
import { detectLanguage, normalizeArabic, stripHtml, titleTokens, truncate } from "../../news-ingest/lib/text.ts";
import { COUNTRIES } from "../../news-ingest/lib/geo.ts";

export type Lang = "ar" | "en";
export type Kind = "fact" | "statement" | "allegation" | "developing" | "analysis";
export const SECTION_KEYS = ["event", "background", "statements", "reactions", "impact", "next", "disagreements", "analysis"] as const;
export type SectionKey = typeof SECTION_KEYS[number];
const KINDS: Kind[] = ["fact", "statement", "allegation", "developing", "analysis"];

/** One stored report (row of news_story_material()). */
export interface MaterialRow {
  article_id: number; source_id: number; publisher: string; source_name_ar: string; source_name_en: string | null;
  source_kind: "media" | "agency" | "official"; reliability: number; license: string | null; url: string; title: string;
  title_original: string | null; title_en: string | null; summary: string | null; summary_kind: string; language: string;
  translated: boolean; verification: string; published_at: string; image_url: string | null; allow_images: boolean;
  wire: string | null; category: string; countries: string[]; region: string | null;
}

/** A numbered reference given to the model. */
export interface Ref {
  n: number; row: MaterialRow; name: string; independent: string; lang: string;
  /** everything we know (headline in all stored languages + excerpt) — numbers may come from here */
  text: string;
  /** publisher wording we hold verbatim (untranslated) — quotations must come from here */
  verbatim: string;
}

export interface Para { t: string; k: Kind; r: number[] }
export interface Section { key: SectionKey; paras: Para[] }
export interface TimelineEntry { at: string; t: string; r: number[] }
export interface Body { sections: Section[]; timeline: TimelineEntry[] }
export interface Issue { where: string; code: string; detail: string }

export interface Thresholds { minReports: number; minPublishers: number; minChars: number }
export const DEFAULT_THRESHOLDS: Thresholds = { minReports: 3, minPublishers: 2, minChars: 600 };

export const MAX_REFS = 16;
export const MAX_PER_PUBLISHER = 4;
export const QUOTE_MAX_WORDS = 25;
export const SHINGLE = 8;
export const MAX_REJECTED_SHARE = 0.4;

const independentKey = (r: MaterialRow) => (r.wire ? `wire:${r.wire}` : `pub:${r.publisher}`);

/** Untranslated publisher wording held for a report. */
function verbatimOf(r: MaterialRow): string {
  const parts: string[] = [];
  if (r.translated) { if (r.title_original) parts.push(r.title_original); }
  else {
    parts.push(r.title);
    if (r.summary && r.summary_kind === "feed") parts.push(r.summary);
  }
  if (r.title_en && r.title_en !== r.title && r.title_en !== r.title_original && r.language === "en") parts.push(r.title_en);
  return stripHtml(parts.join(" \n "));
}

/** Pick up to MAX_REFS reports, spreading across publishers (round-robin, most reliable first). */
export function selectRefs(rows: MaterialRow[], lang: Lang): Ref[] {
  const groups = new Map<string, MaterialRow[]>();
  for (const r of [...rows].sort((a, b) => b.reliability - a.reliability || Date.parse(a.published_at) - Date.parse(b.published_at))) {
    if (!/^https?:\/\//.test(r.url)) continue;
    const k = independentKey(r);
    const g = groups.get(k) ?? [];
    if (g.length < MAX_PER_PUBLISHER) g.push(r);
    groups.set(k, g);
  }
  const picked: MaterialRow[] = [];
  for (let i = 0; picked.length < MAX_REFS; i++) {
    let added = false;
    for (const g of groups.values()) if (g[i] && picked.length < MAX_REFS) { picked.push(g[i]); added = true; }
    if (!added) break;
  }
  picked.sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at));
  return picked.map((row, i) => ({
    n: i + 1, row, independent: independentKey(row), lang: row.translated ? "translated" : row.language,
    name: (lang === "en" ? row.source_name_en : null) || row.source_name_ar,
    text: stripHtml([row.title, row.title_original, row.title_en, row.summary].filter(Boolean).join(" \n ")),
    verbatim: verbatimOf(row),
  }));
}

export interface Sufficiency { ok: boolean; reason: string; publishers: number; chars: number }

/** Refuse to write when the stored material cannot support a full article. */
export function checkSufficiency(refs: Ref[], th: Thresholds = DEFAULT_THRESHOLDS): Sufficiency {
  const publishers = new Set(refs.map((r) => r.independent)).size;
  const chars = refs.reduce((s, r) => s + r.text.length, 0);
  const strong = refs.some((r) => r.row.reliability >= 4 || r.row.source_kind === "official");
  const base = { publishers, chars };
  if (refs.length < th.minReports) return { ok: false, reason: `only ${refs.length} usable reports (need ${th.minReports})`, ...base };
  if (publishers < th.minPublishers) return { ok: false, reason: `only ${publishers} independent publishers (need ${th.minPublishers})`, ...base };
  if (chars < th.minChars) return { ok: false, reason: `only ${chars} characters of source material (need ${th.minChars})`, ...base };
  if (!strong) return { ok: false, reason: "no highly reliable or official source among the reports", ...base };
  if (refs.every((r) => r.row.verification === "allegation")) return { ok: false, reason: "every report is an unverified allegation", ...base };
  return { ok: true, reason: "", ...base };
}

// ------------------------------------------------------------------------------------------------
// Prompt
// ------------------------------------------------------------------------------------------------
const LANG_NAME: Record<Lang, string> = { ar: "Modern Standard Arabic", en: "English" };
const V_LABEL: Record<string, string> = {
  official: "official body", statement: "attributed statement", allegation: "UNVERIFIED ALLEGATION", developing: "developing",
  reported: "as reported", confirmed: "editor-verified",
};

export function systemPrompt(lang: Lang): string {
  return `You are a senior wire-service editor writing an ORIGINAL news article in ${LANG_NAME[lang]} for the global news site Lahza.
You receive numbered source reports about ONE event: each is a headline and a short excerpt published by a news organisation.
These reports are your ONLY knowledge. Write in your own words.

Hard rules (a draft that breaks them is discarded):
1. Use only facts stated in the reports. Do not add names, titles, numbers, dates, places, quotes, causes, casualty figures,
   history or context that the reports do not state — not even well-known background. If a section cannot be supported, leave it out.
2. Every paragraph cites the reports it relies on in "r" (numbers). Only cite reports that actually state what the paragraph says.
3. Never copy sentences. Never reuse 8 or more consecutive words from a report, except inside a short quotation.
4. Quotations: only when a report contains the exact words, copied exactly (max ${QUOTE_MAX_WORDS} words), attributed to the speaker
   and cited. Never translate a quotation and present it in quotation marks — use reported speech instead.
5. Label every paragraph with "k":
   "fact" = stated consistently by two or more independent reports, or by an official body about its own actions;
   "statement" = what a named person or body said, attributed ("X said…");
   "allegation" = a claim one party makes that is not independently confirmed — say who makes it;
   "developing" = reported by a single source, or details still changing — say so ("according to…", "initial reports…");
   "analysis" = careful editorial explanation of what the reported facts mean, with no new facts. Analysis goes ONLY in the "analysis" section.
6. If reports disagree (numbers, who is responsible, what happened), do not pick one: describe the disagreement in a
   "disagreements" section and cite each side.
7. Attribute: "according to [publisher]", "[body] said". Never present a claim from one side of a conflict as established fact.
8. Neutral, precise, no sensationalism, no speculation about the future beyond what the reports say is planned or expected.
9. Plain text only. No markdown, no HTML, no emojis, no source names in brackets — citations go only in "r".
10. If the reports do not contain enough substance for a real article (beyond restating one headline), return {"insufficient": true, "reason": "..."}.

Sections (use the keys, in this order, omit any you cannot support):
 "event" (what happened — the core, most detail), "background" (context stated in the reports), "statements" (official statements),
 "reactions" (international or other reactions), "impact" (economic or political impact, only if reported),
 "next" (what happens next, only scheduled/announced steps), "disagreements", "analysis" (at most 2 short paragraphs).
"timeline": the sequence of developments as the reports describe them, oldest first, one short line each, each citing the report(s).

Return JSON only:
{"title":"headline (max 110 characters, original wording, not a copy of any report headline)",
 "dek":"one or two sentence introduction (max 300 characters)",
 "sections":[{"key":"event","paras":[{"t":"...","k":"fact","r":[1,3]}]}],
 "timeline":[{"t":"...","r":[2]}]}`;
}

export function userPrompt(refs: Ref[], lang: Lang, ctx: { countries: string[]; now: Date }): string {
  const lines = refs.map((r) => {
    const v = V_LABEL[r.row.verification] ?? "as reported";
    const kind = r.row.source_kind === "official" ? "official body" : r.row.source_kind === "agency" ? "news agency" : "news outlet";
    const head = r.row.translated && r.row.title_original ? `${r.row.title_original}\n   (machine translation: ${r.row.title})` : r.row.title;
    const other = r.row.title_en && r.row.title_en !== r.row.title && r.row.title_en !== r.row.title_original ? `\n   English headline: ${r.row.title_en}` : "";
    const ex = r.row.summary ? `\n   Excerpt${r.row.translated ? " (machine translation)" : ""}: ${truncate(stripHtml(r.row.summary), 700)}` : "";
    return `[${r.n}] ${r.name} (${kind}; ${v}; published ${r.row.published_at})\n   Headline: ${head}${other}${ex}`;
  });
  return `Write the article in ${LANG_NAME[lang]}. Current time (UTC): ${ctx.now.toISOString()}.
Countries tagged on this event: ${ctx.countries.join(", ") || "none"}.

SOURCE REPORTS:
${lines.join("\n\n")}`;
}

// ------------------------------------------------------------------------------------------------
// Validation
// ------------------------------------------------------------------------------------------------
// Matched pairs only, so an unmatched mark cannot swallow the text between two quotations.
const QUOTE_RE = /"([^"]{1,400})"|“([^”“]{1,400})”|«([^»«]{1,400})»|„([^“”„]{1,400})[“”]/g;

export function quotesIn(s: string): string[] {
  return [...s.matchAll(QUOTE_RE)].map((m) => (m[1] ?? m[2] ?? m[3] ?? m[4]).trim()).filter((q) => q.split(/\s+/).length >= 2);
}

const norm = (s: string) => normalizeArabic(stripHtml(s));
const words = (s: string) => norm(s).split(" ").filter(Boolean);

export function shingles(s: string, size = SHINGLE): Set<string> {
  const w = words(s);
  const out = new Set<string>();
  for (let i = 0; i + size <= w.length; i++) out.add(w.slice(i, i + size).join(" "));
  return out;
}

/** Longest run of consecutive words shared with the source text (outside quotations). */
export function copiedRun(text: string, sourceShingles: Set<string>): string | null {
  for (const sh of shingles(text.replace(QUOTE_RE, " … "))) if (sourceShingles.has(sh)) return sh;
  return null;
}

const EN_STOP_CAPS = new Set([
  "The", "A", "An", "In", "On", "At", "By", "For", "From", "With", "After", "Before", "During", "As", "It", "Its", "This", "That",
  "These", "Those", "He", "She", "They", "We", "His", "Her", "Their", "But", "And", "Or", "If", "When", "While", "According",
  "Officials", "Authorities", "President", "Prime", "Minister", "Ministry", "Government", "Army", "Police", "Monday", "Tuesday",
  "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December", "UN", "EU", "US", "UK", "Lahza", "Arabic", "English", "Israeli",
  "Palestinian", "Arab", "Western", "European", "African", "Asian", "International", "Foreign", "Defence", "Defense", "State",
  "Department", "Council", "Security", "General", "Secretary", "Spokesperson", "Spokesman", "Spokeswoman", "Office", "Agency",
]);
// Country names and demonyms only (the gazetteer also lists cities and leaders, which must not be whitelisted:
// a leader's name in an article has to come from the reports).
const DEMONYM = /(?:ans?|ians?|ese|ish|is|i)$/;
const GAZETTEER = new Set(COUNTRIES.flatMap((c) => c.en.filter((n, i) => i === 0 || (DEMONYM.test(n) && !n.includes(" ")))
  .flatMap((n) => n.toLowerCase().split(/\s+/))));

/** English proper-name candidates: capitalised words not at a sentence start. */
export function nameCandidates(s: string): string[] {
  const out: string[] = [];
  for (const sentence of s.replace(QUOTE_RE, " ").split(/(?<=[.!?;:])\s+/)) {
    const toks = sentence.split(/\s+/).map((t) => t.replace(/['’]s$/u, "").replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "")).filter(Boolean);
    toks.forEach((t, i) => {
      if (i === 0 || !/^\p{Lu}[\p{Ll}\p{Lu}'-]+$/u.test(t)) return;
      if (EN_STOP_CAPS.has(t) || GAZETTEER.has(t.toLowerCase())) return;
      out.push(t);
    });
  }
  return [...new Set(out)];
}

interface Ctx {
  refs: Map<number, Ref>; lang: Lang; allShingles: Set<string>; allText: string; allTextNorm: string;
  issues: { rejected: Issue[]; warnings: Issue[]; relabelled: Issue[] };
}

function refsOf(raw: unknown, ctx: Ctx): number[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && ctx.refs.has(n)))].sort((a, b) => a - b);
}

function yearsOf(refs: Ref[]): string[] {
  return refs.flatMap((r) => { const d = new Date(r.row.published_at); return isNaN(+d) ? [] : [String(d.getUTCFullYear())]; });
}

/** Check one piece of text against the cited references. Returns a rejection code or null. */
function checkText(text: string, cited: Ref[], where: string, ctx: Ctx, opts: { anyRef?: boolean } = {}): string | null {
  const pool = opts.anyRef || !cited.length ? [...ctx.refs.values()] : cited;
  if (/<[a-zA-Z/!]/.test(text)) return "html";
  if (/[א-ת]/.test(text)) return "untranslated_hebrew";
  const outLang = detectLanguage(text);
  if (ctx.lang === "ar" ? outLang !== "ar" : outLang !== "en" && outLang !== "fr") return "wrong_language";
  // Numbers: every number must appear in the cited material (dates of the cited reports count).
  const allowed = new Set<string>([...pool.flatMap((r) => [...digitsIn(r.text)]), ...yearsOf(pool)]);
  for (const d of digitsIn(text)) if (!allowed.has(d)) return `number_not_in_sources:${d}`;
  // Quotations: verbatim in an untranslated source text, short.
  for (const q of quotesIn(text)) {
    if (q.split(/\s+/).length > QUOTE_MAX_WORDS) return "quote_too_long";
    const nq = norm(q);
    if (!nq || !pool.some((r) => norm(r.verbatim).includes(nq))) return "quote_not_verbatim_in_sources";
  }
  // Copying: no 8-word run from any source outside quotations.
  const run = copiedRun(text, ctx.allShingles);
  if (run) return `copied_from_source:${run}`;
  // Names (English output): a capitalised name must appear somewhere in the material.
  if (ctx.lang === "en") {
    const unknown = nameCandidates(text).filter((n) => !ctx.allTextNorm.includes(n.toLowerCase()));
    if (unknown.length) {
      const englishBacked = pool.some((r) => r.lang === "en");
      if (englishBacked) return `name_not_in_sources:${unknown.slice(0, 3).join(",")}`;
      ctx.issues.warnings.push({ where, code: "transliterated_names", detail: `Names not found verbatim (sources are not in English): ${unknown.slice(0, 5).join(", ")}` });
    }
  }
  return null;
}

/** Same-language support: share of the paragraph's content words found in its cited reports. */
function support(text: string, cited: Ref[]): number | null {
  const toks = titleTokens(text).filter((t) => t.length >= 4);
  if (toks.length < 4) return null;
  const pool = new Set(cited.flatMap((r) => titleTokens(r.text)));
  return toks.filter((t) => pool.has(t)).length / toks.length;
}

function fixKind(k: Kind, cited: Ref[], where: string, ctx: Ctx): Kind {
  if (k === "analysis") return k;
  if ((k === "fact" || k === "statement" || k === "developing") && cited.some((r) => r.row.verification === "allegation")) {
    ctx.issues.relabelled.push({ where, code: "allegation_source", detail: `${k} → allegation (cites a report labelled as an unverified allegation)` });
    return "allegation";
  }
  if (k === "fact") {
    const independent = new Set(cited.map((r) => r.independent)).size;
    const official = cited.some((r) => r.row.source_kind === "official" || r.row.verification === "official");
    if (independent < 2 && !official) {
      ctx.issues.relabelled.push({ where, code: "single_source_fact", detail: "fact → developing (only one independent publisher)" });
      return "developing";
    }
  }
  return k;
}

export interface ComposeResult {
  ok: boolean;
  reason: string;
  title: string;
  dek: string;
  body: Body;
  /** references actually cited, renumbered 1..k in the order they are first cited */
  refs: Ref[];
  warnings: Issue[];
  rejected: Issue[];
  relabelled: Issue[];
  stats: { paras_in: number; paras_kept: number; publishers_cited: number; words: number };
}

export function extractJson(s: string): unknown {
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

const fail = (reason: string, partial: Partial<ComposeResult> = {}): ComposeResult => ({
  ok: false, reason, title: "", dek: "", body: { sections: [], timeline: [] }, refs: [], warnings: [], rejected: [], relabelled: [],
  stats: { paras_in: 0, paras_kept: 0, publishers_cited: 0, words: 0 }, ...partial,
});

/** Validate a model draft against the references. Never throws. */
export function validateDraft(raw: unknown, refs: Ref[], lang: Lang): ComposeResult {
  if (!raw || typeof raw !== "object") return fail("model output is not JSON");
  const o = raw as Record<string, unknown>;
  if (o.insufficient === true) return fail("model: insufficient information — " + String(o.reason ?? "").slice(0, 300));
  const allText = refs.map((r) => r.text + " " + r.verbatim).join(" \n ");
  // Publisher names may be used for attribution ("according to the BBC") even when not in the report text.
  const names = refs.flatMap((r) => [r.name, r.row.source_name_en ?? "", r.row.source_name_ar, r.row.publisher]).join(" ");
  const ctx: Ctx = {
    refs: new Map(refs.map((r) => [r.n, r])), lang, allText,
    allTextNorm: (allText + " " + names).toLowerCase(),
    allShingles: new Set(refs.flatMap((r) => [...shingles(r.verbatim), ...shingles(r.text)])),
    issues: { rejected: [], warnings: [], relabelled: [] },
  };
  const clean = (v: unknown) => (typeof v === "string" ? stripHtml(v).replace(/\s+/g, " ").trim() : "");

  // Headline + introduction (cite the whole material).
  const title = truncate(clean(o.title), 160);
  const dek = truncate(clean(o.dek), 400);
  if (title.length < 10) return fail("missing headline");
  if (dek.length < 20) return fail("missing introduction");
  const tProblem = checkText(title, [], "title", ctx, { anyRef: true });
  if (tProblem) return fail(`headline rejected: ${tProblem}`, { rejected: [{ where: "title", code: tProblem, detail: title }] });
  const dProblem = checkText(dek, [], "dek", ctx, { anyRef: true });
  if (dProblem) return fail(`introduction rejected: ${dProblem}`, { rejected: [{ where: "dek", code: dProblem, detail: dek }] });
  const nt = norm(title);
  if (refs.some((r) => norm(r.row.title) === nt || (r.row.title_original && norm(r.row.title_original) === nt))) {
    ctx.issues.warnings.push({ where: "title", code: "headline_matches_source", detail: "The headline is identical to a source headline — rewrite it." });
  }

  // Sections.
  const sectionsIn = Array.isArray(o.sections) ? o.sections : [];
  const sections: Section[] = [];
  let parasIn = 0;
  for (const sRaw of sectionsIn) {
    const s = sRaw as Record<string, unknown>;
    const key = String(s?.key ?? "") as SectionKey;
    if (!SECTION_KEYS.includes(key)) continue;
    const kept: Para[] = [];
    (Array.isArray(s.paras) ? s.paras : []).forEach((pRaw: unknown, i: number) => {
      parasIn++;
      const p = (pRaw ?? {}) as Record<string, unknown>;
      const where = `${key}#${i + 1}`;
      const t = clean(p.t);
      let k = (KINDS.includes(p.k as Kind) ? p.k : "developing") as Kind;
      if (key === "analysis") k = "analysis";
      const r = refsOf(p.r, ctx);
      if (t.length < 2) return;
      if (t.length > 2500) { ctx.issues.rejected.push({ where, code: "too_long", detail: t.slice(0, 120) }); return; }
      if (k === "analysis" && key !== "analysis") { ctx.issues.rejected.push({ where, code: "analysis_outside_analysis", detail: t.slice(0, 160) }); return; }
      if (k !== "analysis" && !r.length) { ctx.issues.rejected.push({ where, code: "no_valid_source", detail: t.slice(0, 160) }); return; }
      if (k === "analysis" && quotesIn(t).length) { ctx.issues.rejected.push({ where, code: "quote_in_analysis", detail: t.slice(0, 160) }); return; }
      const cited = r.map((n) => ctx.refs.get(n)!);
      const problem = checkText(t, cited, where, ctx, { anyRef: k === "analysis" });
      if (problem) { ctx.issues.rejected.push({ where, code: problem, detail: t.slice(0, 160) }); return; }
      const fixed = fixKind(k, cited, where, ctx);
      const sameLang = cited.every((c) => c.lang === lang);
      const sup = k !== "analysis" && sameLang ? support(t, cited) : null;
      if (sup !== null && sup < 0.25) ctx.issues.warnings.push({ where, code: "low_overlap", detail: `Only ${Math.round(sup * 100)}% of the paragraph's key words appear in its sources — check it says what they say.` });
      kept.push({ t, k: fixed, r });
    });
    if (kept.length) {
      const existing = sections.find((x) => x.key === key);
      if (existing) existing.paras.push(...kept); else sections.push({ key, paras: kept });
    }
  }
  sections.sort((a, b) => SECTION_KEYS.indexOf(a.key) - SECTION_KEYS.indexOf(b.key));

  // Timeline: the time shown is when the earliest cited report was published (never a model-supplied time).
  const timeline: TimelineEntry[] = [];
  (Array.isArray(o.timeline) ? o.timeline : []).slice(0, 40).forEach((eRaw: unknown, i: number) => {
    const e = (eRaw ?? {}) as Record<string, unknown>;
    const where = `timeline#${i + 1}`;
    const t = truncate(clean(e.t), 400);
    const r = refsOf(e.r, ctx);
    if (t.length < 2) return;
    if (!r.length) { ctx.issues.rejected.push({ where, code: "no_valid_source", detail: t }); return; }
    const cited = r.map((n) => ctx.refs.get(n)!);
    const problem = checkText(t, cited, where, ctx);
    if (problem) { ctx.issues.rejected.push({ where, code: problem, detail: t }); return; }
    const at = new Date(Math.min(...cited.map((c) => Date.parse(c.row.published_at)))).toISOString();
    timeline.push({ at, t, r });
  });
  timeline.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  // Sufficiency after validation.
  const kept = sections.flatMap((s) => s.paras);
  const factual = kept.filter((p) => p.k !== "analysis");
  const eventParas = sections.find((s) => s.key === "event")?.paras.length ?? 0;
  const citedNums = new Set([...kept.flatMap((p) => p.r), ...timeline.flatMap((e) => e.r)]);
  const publishersCited = new Set([...citedNums].map((n) => ctx.refs.get(n)!.independent)).size;
  const stats = { paras_in: parasIn, paras_kept: kept.length, publishers_cited: publishersCited, words: 0 };
  const issues = { warnings: ctx.issues.warnings, rejected: ctx.issues.rejected, relabelled: ctx.issues.relabelled };
  if (parasIn && ctx.issues.rejected.filter((x) => !x.where.startsWith("timeline")).length / parasIn > MAX_REJECTED_SHARE) {
    return fail(`too much of the draft failed the fact checks (${ctx.issues.rejected.length} of ${parasIn} paragraphs)`, { ...issues, stats });
  }
  if (eventParas < 2 || factual.length < 3) return fail(`not enough verifiable content (${factual.length} sourced paragraphs)`, { ...issues, stats });
  if (publishersCited < 2) return fail("the article relies on a single publisher", { ...issues, stats });

  // Renumber cited references 1..k in order of first citation.
  const order: number[] = [];
  const see = (n: number) => { if (!order.includes(n)) order.push(n); };
  sections.forEach((s) => s.paras.forEach((p) => p.r.forEach(see)));
  timeline.forEach((e) => e.r.forEach(see));
  const map = new Map(order.map((old, i) => [old, i + 1]));
  const re = (r: number[]) => r.map((n) => map.get(n)!).sort((a, b) => a - b);
  const body: Body = {
    sections: sections.map((s) => ({ key: s.key, paras: s.paras.map((p) => ({ ...p, r: re(p.r) })) })),
    timeline: timeline.map((e) => ({ ...e, r: re(e.r) })),
  };
  const outRefs = order.map((old, i) => ({ ...ctx.refs.get(old)!, n: i + 1 }));
  if (outRefs.some((r) => r.lang !== lang)) {
    issues.warnings.push({ where: "article", code: "cross_language", detail: lang === "ar"
      ? "Some sources are not in Arabic: check the spelling of names and that translated details match the originals."
      : "Some sources are not in English: check the spelling of names and that translated details match the originals." });
  }
  stats.words = [title, dek, ...kept.map((p) => p.t)].join(" ").split(/\s+/).filter(Boolean).length;
  return { ok: true, reason: "", title, dek, body, refs: outRefs, ...issues, stats };
}

/** The payload stored with each source reference. */
export function sourcePayload(r: Ref, lang: Lang) {
  return {
    article_id: r.row.article_id, source_id: r.row.source_id, publisher_name: r.name, url: r.row.url,
    title: truncate(lang === "en" ? (r.row.title_en || r.row.title_original || r.row.title) : r.row.title, 400),
    language: r.row.translated ? (r.row.language === "ar" ? "translated" : r.row.language) : r.row.language,
    published_at: r.row.published_at, verification: r.row.verification, license: r.row.license,
  };
}

/** Hero image: only a thumbnail the publisher supplied in its feed, from a source cleared for images, credited. */
export function heroImage(refs: Ref[]): { url: string; credit: string; source_id: number } | null {
  const r = refs.find((x) => x.row.allow_images && x.row.image_url && /^https:\/\//.test(x.row.image_url));
  return r ? { url: r.row.image_url!, credit: r.name, source_id: r.row.source_id } : null;
}

/** Most common category among the reports (ties: the lead report's). */
export function majorityCategory(rows: MaterialRow[]): string {
  const n = new Map<string, number>();
  for (const r of rows) n.set(r.category, (n.get(r.category) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "world";
}
