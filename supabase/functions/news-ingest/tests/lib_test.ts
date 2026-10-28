import { assert, assertEquals, assertFalse, assertThrows } from "./assert.ts";
import { decodeEntities, detectLanguage, jaccard, normalizeArabic, stripHtml, titleTokens, truncate } from "../lib/text.ts";
import { canonicalUrl, safeUrl, sha256Hex } from "../lib/url.ts";
import { FeedParseError, parseDate, parseFeed } from "../lib/feed.ts";
import { classify, cleanHeadline, SourceInfo } from "../lib/classify.ts";
import { backoffMinutes, isTransientStatus, retryAfterSeconds, robotsAllows } from "../lib/robots.ts";
import { aiConfigFromEnv, validateAIOutput } from "../lib/ai.ts";
import { decodeBody, sameEvent } from "../lib/pipeline.ts";

const media: SourceInfo = { kind: "media", reliability: 4, default_category: null, topical: false };

// ---------------- text ----------------
Deno.test("stripHtml removes tags, scripts, entities and bidi overrides", () => {
  assertEquals(stripHtml("<p>مرحبا&nbsp;<b>بالعالم</b></p><script>alert(1)</script>"), "مرحبا بالعالم");
  assertEquals(stripHtml("&lt;img src=x onerror=alert(1)&gt; نص"), "نص");
  assertEquals(stripHtml("a‮b"), "ab");
  assertEquals(stripHtml("<![CDATA[<b>عاجل</b>]]>"), "عاجل");
  assertEquals(decodeEntities("&#1593;&#x0631;&#1576;"), "عرب");
});

Deno.test("normalizeArabic unifies alef/ya/ta-marbuta, drops harakat and tatweel, arabic digits", () => {
  assertEquals(normalizeArabic("إِعلانُ الحكومـــة ٢٠٢٦"), "اعلان الحكومه 2026");
  assertEquals(normalizeArabic("مستشفى"), "مستشفي");
});

Deno.test("titleTokens strips stopwords and the article prefix", () => {
  const t = titleTokens("عاجل: الحكومة الأردنية تعلن عن خطة جديدة للنقل في عمّان");
  assert(t.includes("حكومه"));
  assertFalse(t.includes("عاجل"));
  assertFalse(t.includes("في"));
});

Deno.test("truncate respects word boundaries", () => {
  const s = truncate("كلمة ".repeat(100), 50);
  assert(s.length <= 51 && s.endsWith("…"));
});

Deno.test("detectLanguage", () => {
  assertEquals(detectLanguage("مرحبا"), "ar");
  assertEquals(detectLanguage("Hello world"), "en");
  assertEquals(detectLanguage("Le président est arrivé"), "fr");
});

// ---------------- url ----------------
Deno.test("safeUrl rejects dangerous schemes and credentials", () => {
  assertEquals(safeUrl("javascript:alert(1)"), null);
  assertEquals(safeUrl("data:text/html,x"), null);
  assertEquals(safeUrl("https://user:pw@x.com/"), null);
  assertEquals(safeUrl("/news/1", "https://site.com/feed"), "https://site.com/news/1");
});

Deno.test("canonicalUrl strips tracking params, fragments, www and trailing slash", async () => {
  const a = canonicalUrl("http://www.Example.com/news/1/?utm_source=x&id=5#top");
  const b = canonicalUrl("https://example.com/news/1?id=5&fbclid=abc");
  assertEquals(a, b);
  assertEquals(await sha256Hex(a), await sha256Hex(b));
});

// ---------------- feeds ----------------
const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><title>Test</title>
<item><title><![CDATA[عاجل | زلزال بقوة 5 درجات يضرب جنوب الأردن]]></title>
<link>https://news.example/a/1?utm_source=rss</link><guid isPermaLink="false">id-1</guid>
<description><![CDATA[<p>أفاد مركز الرصد <b>بوقوع</b> هزة.</p><img src="https://img.example/1.jpg">]]></description>
<pubDate>Sat, 17 Oct 2026 08:00:00 +0300</pubDate><category>عاجل</category>
<media:content url="https://img.example/m.jpg" medium="image"/></item>
<item><title>خبر بدون تاريخ</title><link>/rel/2</link></item>
<item><title>بلا رابط</title></item>
</channel></rss>`;

Deno.test("parseFeed RSS 2.0: fields, CDATA, media, relative links, invalid items dropped", () => {
  const items = parseFeed(RSS, "https://news.example/rss");
  assertEquals(items.length, 2);
  assertEquals(items[0].title, "عاجل | زلزال بقوة 5 درجات يضرب جنوب الأردن");
  assertEquals(items[0].guid, "id-1");
  assertEquals(items[0].description, "أفاد مركز الرصد بوقوع هزة.");
  assertEquals(items[0].image, "https://img.example/m.jpg");
  assertEquals(items[0].publishedAt?.toISOString(), "2026-10-17T05:00:00.000Z");
  assertEquals(items[0].categories, ["عاجل"]);
  assertEquals(items[1].url, "https://news.example/rel/2");
  assertEquals(items[1].publishedAt, null);
});

Deno.test("parseFeed Atom", () => {
  const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>x</title>
  <entry><id>tag:1</id><title type="html">&lt;b&gt;خبر&lt;/b&gt; أتوم</title><link rel="alternate" href="https://a.example/1"/>
  <link rel="enclosure" href="https://a.example/1.mp3"/><updated>2026-10-17T07:30:00Z</updated><summary>ملخص</summary></entry></feed>`;
  const items = parseFeed(atom, "https://a.example/feed");
  assertEquals(items.length, 1);
  assertEquals(items[0].title, "خبر أتوم");
  assertEquals(items[0].url, "https://a.example/1");
  assertEquals(items[0].publishedAt?.toISOString(), "2026-10-17T07:30:00.000Z");
});

Deno.test("parseFeed RDF and JSON Feed", () => {
  const rdf = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="x"><title>t</title></channel><item rdf:about="https://r.example/1"><title>عنوان</title><link>https://r.example/1</link><dc:date>2026-10-17T10:00:00+03:00</dc:date></item></rdf:RDF>`;
  const r = parseFeed(rdf, "https://r.example/");
  assertEquals(r[0].publishedAt?.toISOString(), "2026-10-17T07:00:00.000Z");
  const j = parseFeed(JSON.stringify({ version: "https://jsonfeed.org/version/1.1", items: [{ id: "1", url: "https://j.example/1", title: "جيسون", date_published: "2026-10-17T00:00:00Z" }] }), "https://j.example/");
  assertEquals(j[0].title, "جيسون");
});

Deno.test("parseFeed rejects malformed / hostile input", () => {
  assertThrows(() => parseFeed("<html><body>not a feed</body></html>", "https://x/"), FeedParseError);
  assertThrows(() => parseFeed("Service Unavailable", "https://x/"), FeedParseError);
  assertThrows(() => parseFeed(`<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "aaaa">]><rss><channel><item><title>&a;</title></item></channel></rss>`, "https://x/"), FeedParseError);
  assertThrows(() => parseFeed("{not json", "https://x/"), FeedParseError);
  assertEquals(parseFeed(`<rss><channel><title>empty</title></channel></rss>`, "https://x/"), []);
});

Deno.test("parseFeed tolerates single item and unclosed-but-recoverable text", () => {
  const one = parseFeed(`<rss><channel><item><title>واحد</title><link>https://x.example/1</link></item></channel></rss>`, "https://x.example/");
  assertEquals(one.length, 1);
});

Deno.test("decodeBody honours windows-1256 (legacy Arabic CMS)", () => {
  // "خبر" in windows-1256 = 0xCE 0xC8 0xD1
  const bytes = new Uint8Array([...new TextEncoder().encode('<?xml version="1.0" encoding="windows-1256"?><t>'), 0xce, 0xc8, 0xd1, ...new TextEncoder().encode("</t>")]);
  assert(decodeBody(bytes, "text/xml").includes("خبر"));
  assert(decodeBody(bytes, "text/xml; charset=windows-1256").includes("خبر"));
});

// ---------------- time zones ----------------
Deno.test("parseDate: RFC822 with offset, named zones, ISO, and zone-less local time", () => {
  assertEquals(parseDate("Sat, 17 Oct 2026 10:00:00 +0300")?.toISOString(), "2026-10-17T07:00:00.000Z");
  assertEquals(parseDate("Sat, 17 Oct 2026 07:00:00 GMT")?.toISOString(), "2026-10-17T07:00:00.000Z");
  assertEquals(parseDate("17 Oct 2026 07:00 EST")?.toISOString(), "2026-10-17T12:00:00.000Z");
  assertEquals(parseDate("2026-10-17T10:00:00+03:00")?.toISOString(), "2026-10-17T07:00:00.000Z");
  assertEquals(parseDate("2026-10-17 10:00:00", 180)?.toISOString(), "2026-10-17T07:00:00.000Z"); // Amman CMS without zone
  assertEquals(parseDate("2026-10-17 10:00:00")?.toISOString(), "2026-10-17T10:00:00.000Z");
  assertEquals(parseDate("garbage"), null);
  assertEquals(parseDate("1970-01-01T00:00:00Z"), null);
});

Deno.test("Asia/Amman display is UTC+3 all year (no DST since 2022)", () => {
  const fmt = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Amman", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  assertEquals(fmt("2026-01-15T07:00:00Z"), "10:00");
  assertEquals(fmt("2026-07-15T07:00:00Z"), "10:00");
  assertEquals(fmt("2026-10-16T21:30:00Z"), "00:30"); // crosses midnight into next local day
});

// ---------------- classification ----------------
Deno.test("classify: categories", () => {
  assertEquals(classify("المنتخب الأردني يفوز على العراق في تصفيات كأس العالم", "", [], media).category, "sports");
  assertEquals(classify("ارتفاع أسعار النفط وبرنت يتجاوز 90 دولاراً", "", [], media).category, "economy");
  assertEquals(classify("الحكومة الأردنية تقر موازنة جديدة", "", [], media).categories.includes("jordan"), true);
  assertEquals(classify("غارات على قطاع غزة", "", [], media).category, "palestine");
  assertEquals(classify("OpenAI تطلق نموذجاً جديداً للذكاء الاصطناعي", "", [], media).category, "tech");
  assertEquals(classify("منظمة الصحة العالمية تحذر من انتشار الكوليرا", "", [], media).category, "health");
  assertEquals(classify("زيارة رسمية لسلطنة عمان", "", [], media).category, "arab"); // Oman is not Jordan
});

Deno.test("classify: verification is conservative and never 'confirmed'", () => {
  assertEquals(classify("مزاعم عن هجوم على قافلة", "", [], media).verification, "allegation");
  assertEquals(classify("أنباء عن انفجار في الميناء", "", [], media).verification, "allegation");
  assertEquals(classify("وزارة الداخلية تعلن إغلاق الطريق", "", [], media).verification, "statement");
  assertEquals(classify("عاجل: انقطاع الكهرباء عن عدة مناطق", "", [], media).verification, "developing");
  assertEquals(classify("افتتاح معرض الكتاب", "", [], media).verification, "reported");
  assertEquals(classify("افتتاح معرض الكتاب", "", [], { ...media, kind: "official" }).verification, "official");
  for (const t of ["تأكيد رسمي لعدد الضحايا", "10 مصادر تؤكد الخبر", "confirmed reports"]) {
    assert(classify(t, "", [], media).verification !== "confirmed");
  }
});

Deno.test("classify: breaking detection and headline cleaning", () => {
  const c = classify("عاجل | زلزال يضرب جنوب الأردن", "", [], media);
  assert(c.isBreakingKeyword && c.highImpact);
  assert(c.importance > classify("افتتاح معرض", "", [], media).importance);
  assertEquals(cleanHeadline("عاجل | زلزال يضرب جنوب الأردن"), "زلزال يضرب جنوب الأردن");
  assertEquals(cleanHeadline("Breaking: Quake hits"), "Quake hits");
  assertEquals(cleanHeadline("عاجل"), "عاجل");
});

// ---------------- dedup / clustering ----------------
Deno.test("sameEvent groups paraphrases from different outlets", () => {
  const a = titleTokens("زلزال بقوة 5.1 درجات يضرب جنوب الأردن");
  const b = titleTokens("هزة أرضية بقوة 5.1 درجات تضرب جنوب الأردن صباح اليوم");
  const v = sameEvent(a, b, new Set(["5", "1"]), new Set(["5", "1"]));
  assert(v.related);
});

Deno.test("sameEvent does NOT merge unrelated stories sharing generic words", () => {
  const a = titleTokens("الحكومة الأردنية تقر نظام الخدمة المدنية");
  const b = titleTokens("الحكومة الأردنية تعلن أسعار المحروقات للشهر المقبل");
  assertFalse(sameEvent(a, b, new Set(), new Set()).related);
  // conflicting numbers (different matches / different tolls) must not merge
  const c = titleTokens("الأردن يفوز على العراق 2-1 في تصفيات كأس العالم");
  const d = titleTokens("الأردن يفوز على العراق 3-0 في تصفيات كأس العالم");
  assertFalse(sameEvent(c, d, new Set(["2", "1"]), new Set(["3", "0"])).related);
});

Deno.test("jaccard edge cases", () => {
  assertEquals(jaccard([], ["a"]).score, 0);
  assertEquals(jaccard(["a", "b"], ["a", "b"]).score, 1);
});

// ---------------- robots / backoff ----------------
Deno.test("robots.txt evaluation", () => {
  const txt = "User-agent: *\nDisallow: /private\nAllow: /private/rss\n\nUser-agent: BadBot\nDisallow: /";
  assert(robotsAllows(txt, "LahzaNewsBot/1.0", "/rss.xml"));
  assertFalse(robotsAllows(txt, "LahzaNewsBot/1.0", "/private/x"));
  assert(robotsAllows(txt, "LahzaNewsBot/1.0", "/private/rss"));
  assertFalse(robotsAllows("User-agent: lahzanewsbot\nDisallow: /", "LahzaNewsBot/1.0", "/feed"));
  assert(robotsAllows("User-agent: *\nDisallow:", "LahzaNewsBot/1.0", "/feed"));
  assertFalse(robotsAllows("User-agent: *\nDisallow: /*.xml$", "x", "/feed.xml"));
});

Deno.test("exponential backoff is capped", () => {
  assertEquals(backoffMinutes(5, 0), 5);
  assertEquals(backoffMinutes(5, 1), 10);
  assertEquals(backoffMinutes(5, 3), 40);
  assertEquals(backoffMinutes(5, 20), 360);
  assert(isTransientStatus(503) && isTransientStatus(429) && !isTransientStatus(404));
  assertEquals(retryAfterSeconds("120"), 120);
  assertEquals(retryAfterSeconds(new Date(Date.now() + 60_000).toUTCString()) !== null, true);
});

// ---------------- AI guard rails ----------------
Deno.test("AI disabled by default; output validation blocks invented numbers/quotes/non-Arabic", () => {
  assertEquals(aiConfigFromEnv(() => undefined).provider, "none");
  assertEquals(aiConfigFromEnv((k) => (k === "AI_PROVIDER" ? "anthropic" : undefined)).provider, "none"); // no key
  const input = "العنوان: Earthquake of magnitude 5 hits Jordan\nالنص: Officials said no injuries.";
  assert(validateAIOutput(input, { title: "زلزال بقوة 5 درجات يضرب الأردن", summary: "قال مسؤولون إنه لا إصابات." }));
  assertEquals(validateAIOutput(input, { title: "زلزال بقوة 5 درجات يقتل 12 شخصاً", summary: "" }), null);
  assertEquals(validateAIOutput(input, { title: "Earthquake hits", summary: "" }), null);
  assertEquals(validateAIOutput(input, { title: "زلزال يضرب الأردن", summary: "قال الوزير: \"لا إصابات\"" }), null);
  assertEquals(validateAIOutput(input, "not json"), null);
});

Deno.test("parseDate: forced offset fixes feeds that mislabel UTC as +03:00", () => {
  assertEquals(parseDate("Sat, 17 Oct 2026 06:07:56 +0300", 180, 0)?.toISOString(), "2026-10-17T06:07:56.000Z");
  assertEquals(parseDate("Sat, 17 Oct 2026 06:07:56 +0300", 180, null)?.toISOString(), "2026-10-17T03:07:56.000Z");
  assertEquals(parseFeed(`<rss><channel><item><title>خبر</title><link>https://x.example/1</link><pubDate>Sat, 17 Oct 2026 06:07:56 +0300</pubDate></item></channel></rss>`, "https://x.example/", 180, 0)[0].publishedAt?.toISOString(), "2026-10-17T06:07:56.000Z");
});

// ---------------- Hebrew ----------------
Deno.test("detectLanguage recognises Hebrew", () => {
  assertEquals(detectLanguage("ראש הממשלה נפגש עם שר החוץ"), "he");
  assertEquals(detectLanguage("דיווח: 3 נפגעים ב-Tel Aviv"), "he");
  assertEquals(detectLanguage("رئيس الوزراء يلتقي وزير الخارجية"), "ar");
});

Deno.test("validateAIOutput rejects output that still contains Hebrew", () => {
  const input = "העוצר הוסר בצפון";
  assertEquals(validateAIOutput(input, { title: "رفع حظر التجول في الشمال", summary: "" })?.title, "رفع حظر التجول في الشمال");
  assertEquals(validateAIOutput(input, { title: "رفع حظر التجول في הצפון", summary: "" }), null);
});

Deno.test("aiConfigFromEnv infers the provider from the key alone", () => {
  const cfg = (env: Record<string, string>) => aiConfigFromEnv((k) => env[k]);
  assertEquals(cfg({}).provider, "none");
  const g = cfg({ AI_API_KEY: "AIzaTEST" });
  assertEquals([g.provider, g.baseUrl, g.model], ["openai", "https://generativelanguage.googleapis.com/v1beta/openai", "gemini-flash-lite-latest"]);
  assertEquals(cfg({ AI_API_KEY: "AQ.Ab8test" }).baseUrl, "https://generativelanguage.googleapis.com/v1beta/openai");
  assertEquals(cfg({ AI_API_KEY: "sk-ant-x" }).provider, "anthropic");
  assertEquals(cfg({ AI_API_KEY: "gsk_x" }).baseUrl, "https://api.groq.com/openai/v1");
  assertEquals(cfg({ AI_API_KEY: "sk-x" }).baseUrl, "https://api.openai.com/v1");
  assertEquals(cfg({ AI_API_KEY: "AIzaTEST", AI_MODEL: "m", AI_BASE_URL: "https://x/v1/" }).baseUrl, "https://x/v1");
});

Deno.test("classify puts weather news in the weather section", () => {
  const c = classify("الأرصاد: منخفض جوي وأمطار غزيرة على المملكة غداً", "تتأثر المملكة بكتلة هوائية باردة", [], media);
  assertEquals(c.category, "weather");
  assertEquals(classify("ارتفاع أسعار النفط في الأسواق العالمية", "", [], media).category, "economy");
});
