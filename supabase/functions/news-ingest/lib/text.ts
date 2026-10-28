// Text utilities: HTML stripping, entity decoding, Arabic normalization, tokenization.

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»",
  hellip: "…", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  rlm: "", lrm: "", zwnj: "", zwj: "",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
      try { return String.fromCodePoint(code); } catch { return ""; }
    }
    const v = NAMED_ENTITIES[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

/** Remove tags, scripts, styles, CDATA wrappers; decode entities; collapse whitespace. */
export function stripHtml(input: unknown): string {
  if (input === null || input === undefined) return "";
  let s = typeof input === "string" ? input : typeof input === "object" && "#text" in (input as Record<string, unknown>)
    ? String((input as Record<string, unknown>)["#text"]) : String(input);
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  s = s.replace(/<(script|style|iframe|noscript)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<br\s*\/?>/gi, " ").replace(/<\/p>/gi, " ");
  s = s.replace(/<[^>]*>/g, " ");
  s = decodeEntities(decodeEntities(s)); // some feeds double-encode
  s = s.replace(/<[^>]*>/g, " "); // tags revealed by decoding
  // drop control chars & bidi overrides that could be abused for spoofing
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g, "");
  return s.replace(/\s+/g, " ").trim();
}

/** Truncate at a word boundary, adding an ellipsis. */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s،,.:;\-–—]+$/, "") + "…";
}

const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g; // harakat + tatweel

/** Normalize Arabic for matching (not for display). Mirrors SQL news_normalize(). */
export function normalizeArabic(s: string): string {
  return s
    .toLowerCase()
    .replace(DIACRITICS, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set([
  "في", "من", "علي", "الي", "عن", "مع", "ان", "او", "ثم", "لا", "ما", "هل", "قد", "تم", "كان", "كانت", "هذا",
  "هذه", "ذلك", "تلك", "التي", "الذي", "الذين", "بعد", "قبل", "عند", "حتي", "بين", "خلال", "منذ", "اليوم",
  "امس", "غدا", "عاجل", "بالفيديو", "فيديو", "صور", "شاهد", "انفوغراف", "مباشر", "و", "ب", "ل", "يا", "لم",
  "لن", "كل", "اي", "غير", "ضد", "نحو", "حول", "عبر", "دون", "وفق", "جديد", "جديده", "يوم",
  "the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "is", "are", "at", "by", "with", "as", "from",
  "breaking", "live", "video", "update", "updates", "after", "over", "says",
]);

function stem(t: string): string {
  // very light prefix stripping so "والحكومة" ~ "الحكومة" ~ "حكومة"
  let w = t;
  if (w.length > 4 && /^(وال|بال|كال|فال|لل)/.test(w)) w = w.slice(3);
  else if (w.length > 3 && w.startsWith("ال")) w = w.slice(2);
  else if (w.length > 4 && w[0] === "و") w = w.slice(1); // conjunction و on long words only
  return w;
}

/** Content tokens for near-duplicate detection. */
export function titleTokens(title: string): string[] {
  const n = normalizeArabic(title);
  const out: string[] = [];
  for (const raw of n.split(" ")) {
    if (!raw || STOPWORDS.has(raw)) continue;
    const t = stem(raw);
    if (t.length < 2 || STOPWORDS.has(t)) continue;
    out.push(t);
  }
  return [...new Set(out)];
}

export function jaccard(a: string[], b: string[]): { score: number; shared: number } {
  if (!a.length || !b.length) return { score: 0, shared: 0 };
  const sa = new Set(a);
  let shared = 0;
  for (const t of new Set(b)) if (sa.has(t)) shared++;
  const union = sa.size + new Set(b).size - shared;
  return { score: union ? shared / union : 0, shared };
}

/** Detect dominant script/language of a short text. */
export function detectLanguage(s: string): "ar" | "he" | "en" | "fr" | "other" {
  const ar = (s.match(/[؀-ۿ]/g) || []).length;
  const he = (s.match(/[\u05D0-\u05EA]/g) || []).length;
  const lat = (s.match(/[A-Za-zÀ-ÿ]/g) || []).length;
  if (ar >= lat && ar >= he && ar > 0) return "ar";
  if (he >= lat && he > 0) return "he";
  if (lat === 0) return "other";
  if (/[éèêàçùûôî]|\b(le|la|les|des|du|une|est)\b/i.test(s)) return "fr";
  return "en";
}
