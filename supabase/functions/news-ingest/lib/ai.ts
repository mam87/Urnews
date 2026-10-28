// Optional AI processing (translation / short summary). Disabled unless AI_PROVIDER and AI_API_KEY are set.
// Output is validated so the model cannot add numbers, and is never presented as a quotation.
import { detectLanguage, truncate } from "./text.ts";

export interface AIConfig {
  provider: "anthropic" | "openai" | "none";
  apiKey: string;
  model: string;
  baseUrl: string; // for openai-compatible providers (OpenAI, Gemini, Groq, OpenRouter...)
  timeoutMs: number;
}

export function aiConfigFromEnv(get: (k: string) => string | undefined): AIConfig {
  const provider = (get("AI_PROVIDER") || "none").toLowerCase();
  const apiKey = get("AI_API_KEY") || "";
  const p = (provider === "anthropic" || provider === "openai") && apiKey ? provider : "none";
  return {
    provider: p as AIConfig["provider"],
    apiKey,
    model: get("AI_MODEL") || (p === "anthropic" ? "claude-haiku-5-5" : "gpt-4o-mini"),
    baseUrl: (get("AI_BASE_URL") || "https://api.openai.com/v1").replace(/\/+$/, ""),
    timeoutMs: 20_000,
  };
}

export interface AIResult { title: string; summary: string }

const SYSTEM = `أنت محرر أخبار عربي دقيق. مهمتك فقط: ترجمة و/أو تلخيص النص المعطى إلى العربية الفصحى.
قواعد صارمة:
- لا تضف أي معلومة غير موجودة في النص: لا أسماء ولا أرقام ولا تواريخ ولا أعداد ضحايا ولا اقتباسات.
- حافظ على نسبة الأقوال لأصحابها ("قال"، "أفاد"، "بحسب"). لا تحول الادعاءات إلى حقائق.
- إن كان النص غير واضح فاكتفِ بترجمة حرفية قصيرة.
- عند الترجمة من مصدر عبري أو أجنبي: انقل الرواية كما وردت ونسبها للمصدر (مثل: "بحسب يديعوت أحرونوت")، ولا تقدّم رواية المصدر كحقيقة مؤكدة.
- اكتب أسماء الأماكن والأشخاص بصيغتها العربية المتداولة.
- العنوان أقل من 120 حرفاً، والملخص جملة أو جملتان أقل من 280 حرفاً.
أعد JSON فقط بالشكل: {"title":"...","summary":"..."}`;

export function digitsIn(s: string): Set<string> {
  const norm = s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/(\d)[,٬.](\d{3})\b/g, "$1$2");
  return new Set(norm.match(/\d+/g) || []);
}

/** Reject model output that is not Arabic, too long, or contains numbers absent from the input. */
export function validateAIOutput(input: string, out: unknown): AIResult | null {
  if (!out || typeof out !== "object") return null;
  const o = out as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title.trim() : "";
  const summary = typeof o.summary === "string" ? o.summary.trim() : "";
  if (!title || detectLanguage(title) !== "ar") return null;
  if (summary && detectLanguage(summary) !== "ar") return null;
  if (/[\u05D0-\u05EA]/.test(title + summary)) return null; // untranslated Hebrew left in the output
  const allowed = digitsIn(input);
  for (const d of digitsIn(title + " " + summary)) if (!allowed.has(d)) return null;
  if (/["“”«»]/.test(summary) && !/["“”«»]/.test(input)) return null; // no invented quotations
  return { title: truncate(title, 160), summary: truncate(summary, 320) };
}

function extractJson(s: string): unknown {
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

const LANG_AR: Record<string, string> = { he: "العبرية", en: "الإنجليزية", fr: "الفرنسية" };

export async function aiProcess(cfg: AIConfig, title: string, description: string, mode: "translate" | "summarize", opts: { lang?: string; sourceName?: string } = {}): Promise<AIResult | null> {
  if (cfg.provider === "none") return null;
  const input = `العنوان: ${title}\nالنص: ${truncate(description, 1500)}`;
  const from = opts.lang && LANG_AR[opts.lang] ? ` من ${LANG_AR[opts.lang]}` : "";
  const src = opts.sourceName ? ` المصدر: ${opts.sourceName}.` : "";
  const task = mode === "translate" ? `ترجم العنوان والنص${from} إلى العربية، واجعل الملخص ترجمة مختصرة للنص.${src}` : "اكتب ملخصاً عربياً موجزاً للنص، وأعد العنوان كما هو.";
  const user = `${task}\n\n${input}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    let text = "";
    if (cfg.provider === "anthropic") {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "content-type": "application/json", "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: cfg.model, max_tokens: 400, temperature: 0, system: SYSTEM, messages: [{ role: "user", content: user }] }),
      });
      if (!r.ok) throw new Error(`AI HTTP ${r.status}`);
      const j = await r.json();
      text = (j.content || []).map((c: { text?: string }) => c.text || "").join("");
    } else {
      const r = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ model: cfg.model, temperature: 0, max_tokens: 400, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }] }),
      });
      if (!r.ok) throw new Error(`AI HTTP ${r.status}`);
      const j = await r.json();
      text = j.choices?.[0]?.message?.content || "";
    }
    return validateAIOutput(input, extractJson(text));
  } finally {
    clearTimeout(timer);
  }
}
