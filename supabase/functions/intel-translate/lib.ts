// Pure helpers of intel-translate (same prompt and guard rails as news-translate) — unit-tested in tests/translate_test.ts.
export interface Item { id: number; title: string; summary: string | null; source_name: string; kind?: "video" | "trend" }
export interface Out { title: string; summary: string }

export const SYSTEM = `أنت محرر أخبار عربي دقيق. مهمتك فقط ترجمة العناوين والنصوص المعطاة إلى العربية الفصحى.
قواعد صارمة:
- لا تضف أي معلومة غير موجودة في النص: لا أسماء ولا أرقام ولا تواريخ ولا اقتباسات.
- حافظ على نسبة الأقوال والآراء لأصحابها، ولا تحوّل رأياً أو ادعاءً إلى حقيقة.
- اكتب أسماء الأماكن والأشخاص والكائنات بصيغتها العربية المتداولة.
- العنوان أقل من 120 حرفاً، والملخص جملة أو جملتان أقل من 280 حرفاً (واتركه فارغاً إن لم يكن هناك نص).
ستصلك عدة مواد مرقّمة، ترجم كل مادة على حدة ولا تخلط بينها.
أعد JSON فقط بالشكل: {"items":[{"i":1,"title":"...","summary":"..."}]} بعنصر واحد لكل مادة وبالرقم نفسه.`;

export function digitsIn(s: string): Set<string> {
  const norm = s.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/(\d)[,\u066c.](\d{3})\b/g, "$1$2");
  return new Set(norm.match(/\d+/g) || []);
}
const isArabic = (s: string) => { const ar = (s.match(/[؀-ۿ]/g) || []).length, la = (s.match(/[A-Za-z]/g) || []).length; return ar > 0 && ar >= la; };

/** Reject output that is not Arabic, too long, or carries numbers / quotations absent from the input. */
export function validate(input: string, raw: unknown): Out | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title.trim() : "";
  const summary = typeof o.summary === "string" ? o.summary.trim() : "";
  if (title.length < 3 || title.length > 200 || !isArabic(title)) return null;
  if (summary && (!isArabic(summary) || summary.length > 400)) return null;
  const allowed = digitsIn(input);
  for (const d of digitsIn(title + " " + summary)) if (!allowed.has(d)) return null;
  const quote = /["\u201c\u201d\u00ab\u00bb]/;
  if (quote.test(summary) && !quote.test(input)) return null;
  return { title, summary };
}

export function parseBatch(text: string): unknown[] {
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const j = JSON.parse(m[0]);
    if (Array.isArray(j)) return j;
    return Array.isArray(j?.items) ? j.items : [];
  } catch { return []; }
}

export const inputOf = (it: Item) => `العنوان: ${it.title}\nالنص: ${(it.summary || "").slice(0, 600)}`;

