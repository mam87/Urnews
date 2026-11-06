// Global breaking-news ranking: hypothetical stories from 8 countries, scored by the real detection code.
import { assert, assertEquals } from "./assert.ts";
import { articleCountries, detectCountries, regionOf } from "../lib/geo.ts";
import { crossLanguageSame, eventSignals, magnitudeOf, wireOf } from "../lib/events.ts";
import { BREAKING_MIN, rankEvents, Report, scoreEvent } from "../lib/rank.ts";
import { digitsIn } from "../lib/ai.ts";
import { titleTokens } from "../lib/text.ts";

const NOW = Date.parse("2026-11-06T12:00:00Z");
const min = (m: number) => NOW - m * 60_000;
let nextId = 1;

/** A report as the pipeline would store it: countries, event type, impact and wire all detected from text. */
function rep(cluster: number | null, publisher: string, reliability: number, title: string, agoMin: number,
  o: { excerpt?: string; official?: boolean; verification?: string } = {}): Report {
  const excerpt = o.excerpt ?? "";
  const countries = articleCountries(title, excerpt);
  const sig = eventSignals(title, excerpt, countries);
  const ar = /[؀-ۿ]/.test(title);
  return {
    id: nextId++, clusterId: cluster, sourceId: nextId, publisher, reliability, official: !!o.official,
    publishedAt: min(agoMin), language: ar ? "ar" : "en", hasArabic: ar, hasEnglish: !ar, countries,
    eventType: sig.eventType, impact: sig.impact, wire: wireOf(title, excerpt), verification: o.verification ?? "reported",
    tokens: titleTokens(title),
  };
}

function scenario(): Report[] {
  nextId = 1;
  return [
    // USA — Fed surprise cut: 3 own reports + the SAME Reuters copy run by 3 outlets (counts once).
    rep(1, "npr", 4, "Federal Reserve cuts interest rates by half a point in surprise move", 25),
    rep(1, "guardian", 4, "Fed makes surprise half-point interest rate cut as US economy slows", 22),
    rep(1, "cbs", 4, "Federal Reserve announces emergency interest rate cut", 18),
    rep(1, "thenational", 4, "US Fed cuts rates by 50 basis points", 15, { excerpt: "WASHINGTON (Reuters) - The Federal Reserve cut..." }),
    rep(1, "cna", 4, "US Federal Reserve slashes rates by 50 basis points", 14, { excerpt: "(Reuters) - The U.S. Federal Reserve on Friday..." }),
    rep(1, "scmp", 4, "Fed cuts rates by 50 basis points in surprise move", 12, { excerpt: "Reuters reported the Federal Reserve..." }),
    // China — drills around Taiwan, Arabic + English.
    rep(2, "bbc", 5, "China launches large-scale military drills around Taiwan", 35),
    rep(2, "scmp", 4, "PLA warplanes and warships encircle Taiwan in major drills", 30),
    rep(2, "aljazeera", 4, "الصين تبدأ مناورات عسكرية واسعة حول تايوان", 28),
    // Germany — coalition collapse.
    rep(3, "dw", 4, "German chancellor's coalition collapses, snap election expected", 50),
    rep(3, "euronews", 4, "Germany heads for snap election after coalition collapse", 45),
    // Ukraine — missile strike on Kyiv, Arabic + English, 4 publishers.
    rep(4, "bbc", 5, "Russian missile strike on Kyiv kills 23", 15),
    rep(4, "dw", 4, "Russia hits Kyiv with ballistic missiles, at least 23 killed", 12),
    rep(4, "skynews-ar", 4, "مقتل 23 شخصا في قصف صاروخي روسي على كييف", 10),
    rep(4, "france24", 4, "Kyiv: 23 dead after Russian missile barrage", 8),
    // Japan — M7.4 quake: official USGS + BBC + Japan Times + Al Jazeera Arabic.
    rep(5, "usgs", 5, "M 7.4 - 80 km E of Miyako, Japan", 12, { official: true }),
    rep(5, "bbc", 5, "Magnitude 7.4 earthquake strikes off northern Japan, tsunami advisory issued", 9),
    rep(5, "japantimes", 4, "Strong 7.4 magnitude quake jolts northeastern Japan", 8),
    rep(5, "aljazeera", 4, "زلزال بقوة 7.4 درجات يضرب شمال شرق اليابان", 6),
    // Brazil — single credible source, important but not breaking-grade.
    rep(null, "agenciabrasil", 4, "Brazil's Lula announces new Amazon protection plan", 40),
    // South Africa — deadly floods, two outlets.
    rep(6, "africanews", 4, "Floods in Durban kill 12 as South Africa declares disaster", 30),
    rep(6, "bbc", 5, "South Africa floods: 12 dead in KwaZulu-Natal", 25),
    // Jordan — ROUTINE local story from two Jordanian outlets, very fresh.
    rep(7, "roya", 3, "أمانة عمان تعلن إغلاق طريق في عمان للصيانة", 5),
    rep(7, "jo24", 3, "إغلاق طريق رئيسي في عمان لأعمال الصيانة وتحويلة مرورية", 4),
  ];
}

Deno.test("geo: countries and regions are detected in Arabic and English", () => {
  assertEquals(detectCountries("Strong earthquake strikes northern Japan"), ["JP"]);
  assertEquals(detectCountries("زلزال يضرب شمال اليابان"), ["JP"]);
  assertEquals(detectCountries("مساعدات للأردن"), ["JO"]);
  assertEquals(detectCountries("South Sudan clashes"), ["SS"]); // not "Sudan"
  assertEquals(detectCountries("دعم مالي جديد"), []); // «مالي» = financial, not Mali
  assertEquals(regionOf("UA"), "europe");
  assertEquals(regionOf("BR"), "south_america");
  assertEquals(regionOf("ZA"), "sub_saharan_africa");
  assertEquals(regionOf("JO"), "middle_east");
  assertEquals(regionOf("CN"), "east_asia");
  assertEquals(articleCountries("Parliament passes budget", "", "PK"), ["PK"]);
});

Deno.test("events: quake magnitude, casualties, wires", () => {
  assertEquals(magnitudeOf("Magnitude 7.4 earthquake strikes"), 7.4);
  assertEquals(magnitudeOf("M 6.1 - 20 km SSW of Town"), 6.1);
  assertEquals(magnitudeOf("زلزال بقوة 5.8 درجات"), 5.8);
  const big = eventSignals("Magnitude 7.4 earthquake strikes Japan", "", ["JP"]);
  const small = eventSignals("Magnitude 4.2 earthquake felt in Japan", "", ["JP"]);
  assertEquals(big.eventType, "earthquake");
  assert(big.impact > small.impact + 15, `7.4 (${big.impact}) should far outweigh 4.2 (${small.impact})`);
  assert(eventSignals("Russian missile strike on Kyiv kills 23", "", ["RU", "UA"]).casualties === 23);
  assertEquals(wireOf("Fed cuts rates", "WASHINGTON (Reuters) - The Federal Reserve"), "reuters");
  assertEquals(wireOf("الفيدرالي يخفض الفائدة", "بحسب وكالة رويترز"), "reuters");
  assertEquals(wireOf("Fed cuts rates", "Our correspondent reports"), null);
  assertEquals(eventSignals("أمانة عمان تعلن إغلاق طريق للصيانة", "", ["JO"]).eventType, "routine");
});

Deno.test("events: Arabic and English reports of the same quake are grouped; different events are not", () => {
  const sig = (t: string, ago: number) => {
    const c = detectCountries(t);
    return { language: /[؀-ۿ]/.test(t) ? "ar" : "en", countries: c, eventType: eventSignals(t, "", c).eventType, digits: digitsIn(t), publishedAt: min(ago) };
  };
  assert(crossLanguageSame(sig("Magnitude 7.4 earthquake strikes northern Japan", 10), sig("زلزال بقوة 7.4 درجات يضرب شمال اليابان", 5)));
  assert(!crossLanguageSame(sig("Magnitude 7.4 earthquake strikes northern Japan", 10), sig("زلزال يضرب تركيا", 5)), "different country");
  assert(!crossLanguageSame(sig("Magnitude 7.4 earthquake strikes northern Japan", 400), sig("زلزال يضرب اليابان", 5)), "more than 3 h apart");
  assert(crossLanguageSame(sig("Russian missile strike on Kyiv kills 23", 10), sig("مقتل 23 شخصا في قصف صاروخي روسي على كييف", 5)));
  assert(!crossLanguageSame(sig("Russian missile strike on Kyiv kills 23", 10), sig("قصف روسي على كييف يقتل 4", 5)), "war needs a shared number");
});

Deno.test("rank: wire copies and syndicated text are not independent confirmation", () => {
  const rs = scenario().filter((r) => r.clusterId === 1);
  const e = scoreEvent("c1", rs, NOW);
  assertEquals(e.reportCount, 6);
  assertEquals(e.publisherCount, 6);
  assertEquals(e.independentCount, 4, "3 own reports + 1 Reuters (run by 3 outlets)");
});

Deno.test("rank: 8-country scenario — global events outrank a routine Jordanian story", () => {
  const ranked = rankEvents(scenario(), NOW);
  const byCountry = (iso: string) => ranked.find((e) => e.countries[0] === iso)!;
  const table = ranked.map((e) => `${e.countries.join(",").padEnd(9)} ${String(e.score).padStart(3)}  ${e.breaking ? "BREAKING" : "        "} ${e.status.padEnd(10)} ind=${e.independentCount} ${e.eventType}  ${JSON.stringify(e.parts)}`);
  console.log("\n" + table.join("\n"));

  const jordan = byCountry("JO"), japan = byCountry("JP"), ukraine = byCountry("UA");
  assert(japan && ukraine && jordan, "every story is ranked");
  for (const iso of ["US", "CN", "DE", "UA", "JP", "ZA"]) {
    assert(byCountry(iso).score > jordan.score, `${iso} (${byCountry(iso).score}) must outrank routine Jordan (${jordan.score})`);
  }
  assert(!jordan.breaking, "routine local news is never breaking, however fresh");
  assert(jordan.score < BREAKING_MIN);
  assert(japan.breaking && ukraine.breaking, "M7.4 quake and deadly strike are breaking");
  assertEquals(japan.region, "east_asia");
  assertEquals(ukraine.region, "europe");
  assertEquals(ranked[0].breaking, true);
  // The two biggest events lead, from different continents.
  assert(["JP", "UA"].includes(ranked[0].countries[0]) && ["JP", "UA"].includes(ranked[1].countries[0]), "quake and strike lead");
  // Multiple simultaneous breaking stories are allowed, but not everything is breaking.
  const nBreaking = ranked.filter((e) => e.breaking).length;
  assert(nBreaking >= 3 && nBreaking < ranked.length, `breaking count ${nBreaking}`);
  // Single credible source: ranked, labelled single-source, not confirmed.
  const brazil = byCountry("BR");
  assert(brazil.singleSource && !brazil.confirmed && brazil.status === "developing");
  // Corroborated by 3+ independent credible publishers => confirmed.
  assert(japan.confirmed && ukraine.confirmed);
  assertEquals(byCountry("DE").confirmed, false, "two publishers is not enough for 'confirmed'");
});

Deno.test("rank: no geographic bias — the same event scores the same in Jordan and in Brazil", () => {
  nextId = 1;
  const jo = scoreEvent("x", [rep(null, "a", 4, "Magnitude 6.2 earthquake strikes Jordan", 10), rep(null, "b", 4, "Strong earthquake hits Jordan", 8)], NOW);
  const br = scoreEvent("y", [rep(null, "a", 4, "Magnitude 6.2 earthquake strikes Brazil", 10), rep(null, "b", 4, "Strong earthquake hits Brazil", 8)], NOW);
  assertEquals(jo.score, br.score);
  assertEquals(jo.parts, br.parts);
});

Deno.test("rank: single-source alerts need an authoritative source; allegations never break", () => {
  nextId = 1;
  const strong = scoreEvent("s", [rep(null, "bbc", 5, "Magnitude 7.8 earthquake strikes Chile", 3)], NOW);
  assert(strong.breaking && strong.singleSource, `authoritative single source may alert (score ${strong.score})`);
  const weak = scoreEvent("w", [rep(null, "blog", 2, "Magnitude 7.8 earthquake strikes Chile", 3)], NOW);
  assert(!weak.breaking, "a low-reliability single source cannot trigger an alert");
  const alleged = scoreEvent("al", [
    rep(null, "a", 4, "Coup reportedly under way in Niger", 3, { verification: "allegation" }),
    rep(null, "b", 4, "Unconfirmed reports of coup in Niger", 2, { verification: "allegation" }),
  ], NOW);
  assert(!alleged.breaking && !alleged.confirmed);
});

Deno.test("rank: freshness decays and an old event drops out of breaking", () => {
  nextId = 1;
  const fresh = scoreEvent("f", [rep(null, "bbc", 5, "Coup in Gabon as army seizes power", 5), rep(null, "dw", 4, "Gabon military takes over in coup", 4)], NOW);
  nextId = 1;
  const old = scoreEvent("o", [rep(null, "bbc", 5, "Coup in Gabon as army seizes power", 420), rep(null, "dw", 4, "Gabon military takes over in coup", 415)], NOW);
  assert(fresh.score > old.score + 20);
  assert(fresh.breaking && !old.breaking);
});

Deno.test("events: regressions from the first live run (2026-11-06)", () => {
  const sig = (t: string, ex = "", cat: string | null = null) => eventSignals(t, ex, articleCountries(t, ex), cat);
  // "no tsunami alert" is an earthquake, not a tsunami
  const q = sig("Magnitude-6.1 earthquake hits off Tokyo, no tsunami alert: weather agency");
  assertEquals(q.eventType, "earthquake");
  assertEquals(q.impact, 20);
  // USGS titles
  assertEquals(sig("M 6.1 - 144 km SE of Hasaki, Japan").eventType, "earthquake");
  // a business conference is not an international decision; excerpt countries do not make it global
  assert(sig("Family Business Summit day 2 tackles US-China ties, Asean and geopolitical shifts",
    "Speakers from the United States, China and Russia discussed...").impact < 14);
  // «قمة» in sport is a big match
  assert(sig("ألفاريز في الواجهة.. قصة ميركاتو مؤجلة تشعل قمة أتلتيكو وبرشلونة", "", "sports").impact <= 8);
  // analysis / expert commentary
  assert(sig("خبراء: هذا السيناريو الأمريكي الأقرب تجاه إيران").impact <= 10);
  assert(sig("Why the midterm swing won't change the US-China rivalry").impact <= 10);
  // hard news in a soft section stays hard news
  assert(sig("Stadium explosion kills 14 during football match in Lagos", "", "sports").impact >= 21);
});

Deno.test("rank: a single outlet alone cannot raise an alert for a mid-level story", () => {
  nextId = 1;
  const mid = scoreEvent("m", [rep(null, "aj", 4, "سوريا.. قصف إسرائيلي يستهدف قرية في ريف القنيطرة", 7)], NOW);
  assert(!mid.breaking, `single-source shelling report (impact ${mid.parts.impact}, score ${mid.score}) is not an alert`);
  nextId = 1;
  const two = scoreEvent("t", [rep(1, "aj", 4, "سوريا.. قصف إسرائيلي يستهدف قرية في ريف القنيطرة", 7), rep(1, "bbc", 5, "Israeli shelling hits village in Syria's Quneitra", 5)], NOW);
  assert(two.breaking, "corroborated by a second independent publisher, it is");
});

Deno.test("rank: reports of one quake stored separately (USGS + news) are merged into one event", () => {
  nextId = 1;
  const ranked = rankEvents([
    rep(null, "usgs", 5, "M 6.1 - 144 km SE of Hasaki, Japan", 50, { official: true }),
    rep(null, "thehindu", 4, "Magnitude-6.1 earthquake hits off Tokyo, no tsunami alert: weather agency", 45),
    rep(null, "japantimes", 4, "Magnitude 6.1 quake hits off Tokyo, but no tsunami alert issued", 30),
    rep(null, "dw", 4, "Floods in northern Japan force evacuations", 20),
  ], NOW);
  const quake = ranked.find((e) => e.eventType === "earthquake")!;
  assertEquals(quake.reportCount, 3);
  assertEquals(quake.independentCount, 3);
  assertEquals(ranked.length, 2, "the flood is a different event");
});
