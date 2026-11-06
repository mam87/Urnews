// Language-independent event signals for global ranking:
//  * event type (Arabic + English keywords) and its base global impact (0..30)
//  * wire attribution (Reuters/AP/AFP copies are not independent confirmation)
//  * a cross-language "same event" test (an Arabic and an English report of the same quake)
// No country is worth more than another here: impact depends on WHAT happened, never WHERE.
import { normalizeArabic, termPattern } from "./text.ts";
import { detectCountries } from "./geo.ts";

export type EventType =
  | "tsunami" | "earthquake" | "volcano" | "storm" | "disaster" | "coup" | "assassination" | "leader"
  | "war" | "ceasefire" | "attack" | "crash" | "intl_decision" | "health_emergency" | "energy" | "economy"
  | "election" | "government" | "science" | "sports_major" | "routine" | "general";

interface TypeDef { base: number; discrete: boolean; terms: string[] }

/** Base global impact (max 30). "discrete" = a single, datable occurrence (one quake, one coup), safe to
 *  match across languages on type + country + time alone. Order matters: first match wins. */
const TYPES: [EventType, TypeDef][] = [
  ["earthquake", { base: 18, discrete: true, terms: ["earthquake", "quake", "magnitude", "seismic", "زلزال", "هزة أرضية", "هزة ارضية", "الزلزال", "زلزالا"] }],
  ["tsunami", { base: 27, discrete: true, terms: ["tsunami", "تسونامي", "موجات مد عاتية"] }],
  ["volcano", { base: 18, discrete: true, terms: ["volcano", "volcanic eruption", "eruption", "بركان", "ثوران بركان", "ثوران"] }],
  ["storm", { base: 20, discrete: true, terms: ["hurricane", "typhoon", "cyclone", "tropical storm", "tornado", "إعصار", "اعصار", "عاصفة استوائية", "إعصار مداري", "تورنادو"] }],
  ["coup", { base: 27, discrete: true, terms: ["coup", "military takeover", "seized power", "انقلاب", "انقلابا", "استولى الجيش على السلطة"] }],
  ["assassination", { base: 26, discrete: true, terms: ["assassinated", "assassination", "اغتيال", "اغتيل"] }],
  ["leader", { base: 24, discrete: true, terms: ["resigns", "resignation of president", "prime minister resigns", "president dies", "president-elect", "wins presidential election", "sworn in as president", "impeached", "coalition collapses", "coalition collapse", "government collapses", "government collapse", "snap election", "dissolves parliament", "يستقيل", "استقالة رئيس", "استقالة الحكومة", "وفاة الرئيس", "وفاة رئيس", "الرئيس المنتخب", "يفوز بالرئاسة", "فوزه بالانتخابات الرئاسية", "أداء اليمين", "عزل الرئيس", "انهيار الحكومة", "انهيار الائتلاف", "انتخابات مبكرة", "حل البرلمان"] }],
  ["crash", { base: 20, discrete: true, terms: ["plane crash", "plane crashed", "airliner", "train crash", "derailed", "ship sank", "ferry capsized", "تحطم طائرة", "سقوط طائرة", "تحطم مروحية", "خروج قطار", "تصادم قطارين", "غرق سفينة", "غرق عبارة", "غرق مركب"] }],
  ["ceasefire", { base: 23, discrete: false, terms: ["ceasefire", "truce", "peace deal", "peace agreement", "armistice", "وقف إطلاق النار", "وقف اطلاق النار", "هدنة", "اتفاق سلام", "اتفاق السلام"] }],
  ["war", { base: 21, discrete: false, terms: ["airstrike", "air strike", "airstrikes", "missile", "missiles", "ballistic", "drone attack", "drone strike", "invasion", "invade", "shelling", "offensive", "troops", "military operation", "declares war", "warplanes", "warships", "military drills", "naval drills", "war games", "غارة", "غارات", "قصف", "صاروخ", "صواريخ", "صاروخية", "باليستي", "طائرة مسيرة", "طائرات مسيرة", "هجوم بمسيرة", "بمسيرات", "اجتياح", "غزو", "هجوم عسكري", "عملية عسكرية", "توغل", "اشتباكات", "حرب", "الحرب", "إعلان الحرب", "مناورات عسكرية", "مناورات بحرية"] }],
  ["attack", { base: 21, discrete: false, terms: ["terror attack", "terrorist attack", "suicide bombing", "bombing", "mass shooting", "gunmen", "hostage", "hostages", "explosion", "blast", "stabbing attack", "هجوم إرهابي", "عملية إرهابية", "تفجير انتحاري", "تفجير", "انفجار", "إطلاق نار جماعي", "مسلحون", "رهائن", "احتجاز رهائن", "عملية طعن"] }],
  ["health_emergency", { base: 20, discrete: false, terms: ["pandemic", "epidemic", "outbreak", "public health emergency", "world health organization declares", "cholera", "ebola", "mpox", "bird flu", "avian flu", "جائحة", "وباء", "تفشي", "طوارئ صحية", "الكوليرا", "إيبولا", "جدري القردة", "إنفلونزا الطيور"] }],
  ["intl_decision", { base: 19, discrete: false, terms: ["security council", "un resolution", "general assembly", "sanctions", "nato", "g7", "g20", "eu summit", "nato summit", "g7 summit", "g20 summit", "european council", "international court", "icc", "icj", "treaty", "مجلس الأمن", "قرار أممي", "الجمعية العامة", "عقوبات", "الناتو", "حلف شمال الأطلسي", "مجموعة السبع", "مجموعة العشرين", "قمة الناتو", "القمة العربية", "قمة مجموعة", "القمة الأوروبية", "المحكمة الجنائية الدولية", "محكمة العدل الدولية", "معاهدة"] }],
  ["energy", { base: 17, discrete: false, terms: ["opec", "oil prices", "crude", "brent", "energy crisis", "gas supply", "blackout", "power outage", "أوبك", "أسعار النفط", "النفط الخام", "برنت", "أزمة الطاقة", "إمدادات الغاز", "انقطاع الكهرباء", "انقطاع التيار"] }],
  ["economy", { base: 15, discrete: false, terms: ["interest rate", "rate cut", "rate hike", "federal reserve", "the fed", "central bank", "ecb", "recession", "inflation", "stock market", "stocks plunge", "market crash", "default", "tariffs", "gdp", "imf", "world bank", "الفائدة", "سعر الفائدة", "الاحتياطي الفيدرالي", "البنك المركزي", "المركزي الأوروبي", "ركود", "الركود", "التضخم", "البورصة", "الأسهم", "انهيار الأسواق", "تعثر", "رسوم جمركية", "الرسوم الجمركية", "الناتج المحلي", "صندوق النقد", "البنك الدولي"] }],
  ["disaster", { base: 15, discrete: false, terms: ["floods", "flooding", "flash flood", "landslide", "wildfire", "wildfires", "heatwave", "famine", "drought", "avalanche", "فيضانات", "فيضان", "سيول", "انهيار أرضي", "انهيارات أرضية", "حرائق غابات", "حرائق الغابات", "موجة حر", "مجاعة", "جفاف", "انهيار ثلجي"] }],
  ["election", { base: 15, discrete: false, terms: ["election", "elections", "vote", "referendum", "polls open", "ballot", "انتخابات", "الانتخابات", "استفتاء", "الاقتراع", "التصويت"] }],
  ["science", { base: 12, discrete: false, terms: ["breakthrough", "scientists discover", "first ever", "spacecraft", "rocket launch", "moon landing", "mars", "nasa", "spacex", "artificial intelligence", "quantum", "gene therapy", "اختراق علمي", "اكتشاف", "علماء", "مركبة فضائية", "إطلاق صاروخ", "القمر", "المريخ", "ناسا", "الذكاء الاصطناعي", "الكمومي", "العلاج الجيني"] }],
  ["sports_major", { base: 10, discrete: false, terms: ["world cup", "olympics", "olympic", "champions league final", "super bowl", "grand slam", "world championship", "كأس العالم", "الأولمبياد", "الألعاب الأولمبية", "نهائي دوري أبطال", "بطولة العالم"] }],
  ["government", { base: 12, discrete: false, terms: ["president", "prime minister", "chancellor", "government announces", "cabinet", "parliament", "decree", "الرئيس", "رئيس الوزراء", "المستشار", "الحكومة", "مجلس الوزراء", "البرلمان", "مرسوم", "يعلن", "أعلن", "أعلنت"] }],
  ["routine", { base: 4, discrete: false, terms: ["traffic", "road closure", "roadworks", "municipality", "weather forecast", "exam results", "appointed", "celebrity", "box office", "recipe", "horoscope", "match preview", "transfer news", "حادث سير", "حوادث السير", "تحويلة", "إغلاق طريق", "البلدية", "أمانة عمان", "النشرة الجوية", "حالة الطقس", "الطقس", "نتائج الامتحانات", "نتائج التوجيهي", "تعيين", "تعيينات", "إحالات على التقاعد", "التشكيلة المتوقعة", "انتقالات", "وصفة", "الأبراج", "فنانة", "فنان", "مسلسل", "حفل زفاف", "الدوري الأردني", "مباراة"] }],
];

const TYPE_RE: [EventType, TypeDef, RegExp][] = TYPES.map(([t, d]) => [t, d,
  new RegExp(`(?:^|\\s)(?:${d.terms.map((x) => termPattern(normalizeArabic(x))).join("|")})(?=\\s|$)`)]);
export const TYPE_INFO = Object.fromEntries(TYPES) as Record<EventType, TypeDef>;

const INTL_BODIES = new RegExp(`(?:^|\\s)(?:${["united nations", "un", "nato", "european union", "eu", "g7", "g20", "imf", "world bank", "world health organization", "opec", "icc", "icj", "security council", "african union", "arab league", "asean", "الأمم المتحدة", "الامم المتحدة", "الناتو", "الاتحاد الأوروبي", "مجموعة السبع", "مجموعة العشرين", "صندوق النقد", "البنك الدولي", "منظمة الصحة العالمية", "أوبك", "مجلس الأمن", "الاتحاد الأفريقي", "الجامعة العربية", "آسيان"].map((x) => termPattern(normalizeArabic(x))).join("|")})(?=\\s|$)`);

const CASUALTY = new RegExp(`(?:^|\\s)(?:${["killed", "kills", "kill", "dies", "dead", "deaths", "death toll", "died", "casualties", "injured", "wounded", "missing", "قتيل", "قتيلا", "يقتل", "تقتل", "أشخاص", "شخصا", "قتلى", "مقتل", "شهيد", "شهيدا", "شهداء", "ضحايا", "ضحية", "وفاة", "وفيات", "مصاب", "مصابا", "إصابة", "جرحى", "جريح", "مفقود", "مفقودين"].map((x) => termPattern(normalizeArabic(x))).join("|")})(?=\\s|$)`);

/** Commentary, analysis and explainers are not breaking events, whatever they discuss. */
const ANALYSIS = new RegExp(`(?:^|\\s)(?:${["analysis", "opinion", "explainer", "explained", "what we know", "why", "how", "what to know", "comment", "column", "podcast", "review", "interview", "خبراء", "خبير", "تحليل", "رأي", "مقال", "لماذا", "كيف", "ماذا", "قراءة في", "سيناريو", "سيناريوهات", "مقابلة", "حوار"].map((x) => termPattern(normalizeArabic(x))).join("|")})(?=\\s|$)`);
const NO_TSUNAMI = /no tsunami|tsunami (?:warning|alert|threat) (?:lifted|cancelled|canceled)|لا (?:خطر|تحذير)\s*(?:من\s*)?(?:حدوث\s*)?تسونامي|دون تحذير من تسونامي/i;
/** Sections where stories are soft news unless a hard-news type is detected (a "قمة" there is a big match). */
const SOFT_CATEGORIES = new Set(["sports", "entertainment", "education"]);
const HARD_TYPES = new Set<EventType>(["tsunami", "earthquake", "volcano", "storm", "disaster", "coup", "assassination", "attack", "crash", "health_emergency"]);

const ALLEGED = /(?:^|\s)(?:alleged|allegedly|reportedly|unconfirmed|claims|مزاعم|يزعم|تزعم|ادعاء|غير مؤكده?|انباء عن|تقارير عن)(?=\s|$)/;

/** Numbers that are not years (1900-2100) and not tiny ordinals; used for casualty size. */
function quantities(norm: string): number[] {
  const out: number[] = [];
  for (const m of norm.replace(/(\d)[,٬](\d{3})\b/g, "$1$2").matchAll(/\d+(?:\.\d+)?/g)) {
    const n = Number(m[0]);
    if (!Number.isFinite(n) || (n >= 1900 && n <= 2100 && !m[0].includes("."))) continue;
    out.push(n);
  }
  return out;
}

/** Earthquake magnitude: "magnitude 7.4", "M 6.1", "7.4-magnitude", «بقوة 7.4 درجات». */
export function magnitudeOf(text: string): number | null {
  const t = text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/٫/g, ".");
  const m = t.match(/(?:magnitude|mag\.?|\bm|بقوة|قوتها|شدتها)\s*[-:]?\s*(\d(?:\.\d)?)\b/i) || t.match(/\b(\d(?:\.\d)?)\s*[- ]?\s*magnitude/i)
    || t.match(/(\d(?:\.\d)?)\s*(?:درجات|درجة)\s*(?:على مقياس ريختر|بمقياس ريختر)?/);
  const v = m ? Number(m[1]) : NaN;
  return v >= 2 && v <= 9.9 ? v : null;
}

export interface EventSignals {
  eventType: EventType;
  impact: number;          // 0..30, the "global impact" ranking component
  intlBodies: boolean;
  casualties: number;      // largest casualty-like number in the text (0 if none)
  magnitude: number | null;
}

/** Global impact of a story, from its own words. `countries` = detected countries (only their COUNT matters). */
export function eventSignals(title: string, excerpt: string, countries: string[], category?: string | null): EventSignals {
  const t = normalizeArabic(title);
  const all = normalizeArabic(title + " " + excerpt.slice(0, 400));
  let eventType: EventType = "general";
  let def: TypeDef = { base: 8, discrete: false, terms: [] };
  // The headline decides the type; the excerpt only if the headline matched nothing.
  for (const src of [t, all]) {
    const hit = TYPE_RE.find(([, , re]) => re.test(src));
    if (hit) { [eventType, def] = [hit[0], hit[1]]; break; }
  }
  if (eventType === "general" && /^m\s?\d(?:\.\d)?\s*-/i.test(title.trim())) [eventType, def] = ["earthquake", TYPE_INFO.earthquake]; // USGS "M 6.1 - 144 km SE of …"
  if (eventType === "tsunami" && NO_TSUNAMI.test(title)) [eventType, def] = ["earthquake", TYPE_INFO.earthquake];
  let impact = def.base;
  const magnitude = eventType === "earthquake" || eventType === "tsunami" ? magnitudeOf(title + " " + excerpt.slice(0, 300)) : null;
  if (eventType === "earthquake" && magnitude !== null) {
    impact = magnitude >= 7.5 ? 30 : magnitude >= 7 ? 27 : magnitude >= 6.5 ? 24 : magnitude >= 6 ? 20 : magnitude >= 5 ? 11 : 6;
  }
  const casualties = CASUALTY.test(all) ? Math.max(0, ...quantities(all).filter((n) => Number.isInteger(n) && n < 1_000_000)) : 0;
  if (casualties >= 1000) impact += 8; else if (casualties >= 100) impact += 6; else if (casualties >= 10) impact += 3;
  const intlBodies = INTL_BODIES.test(t);
  if (intlBodies && eventType !== "routine") impact += 3;
  // Countries named in the HEADLINE (an excerpt listing several countries does not make a story global).
  const inTitle = countries.length ? detectCountries(title).length : 0;
  if (inTitle >= 3) impact += 3; else if (inTitle === 2) impact += 2;
  if (ALLEGED.test(t)) impact -= 4;
  // Routine items stay routine, wherever they happen, unless people were killed.
  if (eventType === "routine" && casualties < 10) impact = Math.min(impact, 6);
  // Commentary and soft-news sections are never breaking-grade.
  if (ANALYSIS.test(t) || /[?؟]\s*$/.test(title.trim())) impact = Math.min(impact, 10);
  if (category && SOFT_CATEGORIES.has(category) && !HARD_TYPES.has(eventType)) impact = Math.min(impact, eventType === "sports_major" ? 12 : 8);
  return { eventType, impact: Math.max(0, Math.min(30, Math.round(impact))), intlBodies, casualties, magnitude };
}

/* ---------- wire syndication ---------- */
const WIRES: [string, RegExp][] = [
  ["reuters", /\breuters\b|رويترز/i],
  ["ap", /\(ap\)|\bassociated press\b|أسوشيتد برس|اسوشيتد برس|أسوشيتدبرس/i],
  ["afp", /\bafp\b|\bagence france[- ]presse\b|فرانس برس|وكالة الصحافة الفرنسية|وكالة الأنباء الفرنسية/i],
  ["anadolu", /\banadolu\b|الأناضول/i],
  ["xinhua", /\bxinhua\b|شينخوا/i],
  ["tass", /\btass\b|تاس(?=\s|$)/i],
  ["efe", /\befe\b/],
  ["dpa", /\bdpa\b/],
];

/** The wire service a report is copied from or attributed to ("(Reuters) -", "according to AP",
 *  «بحسب رويترز»). Such reports count as ONE independent source per wire, however many outlets run them. */
export function wireOf(title: string, excerpt: string): string | null {
  const text = `${title} ${excerpt.slice(0, 300)}`;
  for (const [k, re] of WIRES) if (re.test(text)) return k;
  return null;
}

/* ---------- cross-language event matching ---------- */
export interface Signature { language: string; countries: string[]; eventType: EventType; digits: Set<string>; publishedAt: number; magnitude?: number | null }

/** Is a report in one language about the same event as a report in another? Conservative: the type must be
 *  a real event type, both must name the same main country, they must be within 3 hours, numbers must not
 *  conflict; continuous situations (war, protests…) additionally need a shared number to anchor them. */
export function crossLanguageSame(a: Signature, b: Signature): boolean {
  if (a.eventType !== b.eventType || a.eventType === "general" || a.eventType === "routine" || a.eventType === "government") return false;
  if (!a.countries.length || !b.countries.length) return false;
  const main = (s: Signature) => s.countries.slice(0, 2);
  if (!main(a).some((c) => main(b).includes(c))) return false;
  if (Math.abs(a.publishedAt - b.publishedAt) > 3 * 3600_000) return false;
  // Two quakes in one country are different events unless their magnitudes agree (aftershocks are separate).
  if (a.eventType === "earthquake" && a.magnitude != null && b.magnitude != null && Math.abs(a.magnitude - b.magnitude) > 0.3) return false;
  const big = (s: Set<string>) => [...s].filter((d) => d.length >= 2 && !(Number(d) >= 1900 && Number(d) <= 2100));
  const da = big(a.digits), db = big(b.digits);
  const shared = da.some((d) => db.includes(d));
  if (da.length && db.length && !shared && !TYPE_INFO[a.eventType].discrete) return false;
  if (TYPE_INFO[a.eventType].discrete) return da.length === 0 || db.length === 0 || shared || a.eventType === "earthquake";
  return shared;
}
