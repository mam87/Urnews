// Rules-based categorisation, verification labelling and importance scoring.
// Deliberately conservative: nothing is ever auto-labelled "confirmed".
import { normalizeArabic } from "./text.ts";

export type Category = "jordan" | "palestine" | "arab" | "world" | "politics" | "economy" | "tech" | "health" | "sports" | "weather"
  | "entertainment" | "security" | "education" | "environment";
export type Verification = "official" | "statement" | "allegation" | "developing" | "reported" | "confirmed";

export const GEO: Category[] = ["jordan", "palestine", "arab", "world"];
export const TOPICAL: Category[] = ["weather", "sports", "tech", "health", "economy", "environment", "education", "entertainment", "politics"];
/** Secondary tags: added to `categories` when strong, but never chosen over a geographic section
 *  (otherwise every strike/raid headline would leave Palestine/World for "security"). */
export const SECONDARY: Category[] = ["politics", "security"];

const KEYWORDS: Record<Category, string[]> = {
  jordan: ["الأردن", "الاردن", "أردني", "أردنية", "الأردنيين", "الملك عبدالله الثاني", "الملك عبد الله الثاني", "ولي العهد الأمير الحسين", "الزرقاء", "إربد", "العقبة", "السلط", "الكرك", "معان", "مادبا", "جرش", "عجلون", "المفرق", "الطفيلة", "البلقاء", "النشامى", "مجلس النواب الأردني", "الحكومة الأردنية", "رئيس الوزراء جعفر حسان", "بترا", "Jordan", "Jordanian", "Amman"],
  palestine: ["فلسطين", "فلسطيني", "فلسطينية", "الفلسطينيين", "غزة", "قطاع غزة", "الضفة الغربية", "الضفة", "القدس", "الأقصى", "رام الله", "نابلس", "جنين", "طولكرم", "الخليل", "بيت لحم", "خان يونس", "رفح", "دير البلح", "الأونروا", "حماس", "السلطة الفلسطينية", "المستوطنين", "الاستيطان", "Gaza", "West Bank", "Palestinian", "Jerusalem"],
  arab: ["السعودية", "السعودي", "مصر", "المصري", "المصرية", "سوريا", "السوري", "لبنان", "اللبناني", "العراق", "العراقي", "الإمارات", "الإماراتي", "قطر", "القطري", "الكويت", "الكويتي", "البحرين", "سلطنة عمان", "مسقط", "اليمن", "اليمني", "الحوثي", "الحوثيين", "ليبيا", "الليبي", "تونس", "التونسي", "الجزائر", "الجزائري", "المغرب", "المغربي", "السودان", "السوداني", "موريتانيا", "الصومال", "جيبوتي", "جزر القمر", "الجامعة العربية", "الخليج", "الرياض", "القاهرة", "دمشق", "بيروت", "بغداد", "الدوحة", "أبوظبي", "دبي", "صنعاء", "طرابلس", "الخرطوم", "حزب الله", "Saudi", "Egypt", "Syria", "Lebanon", "Iraq", "Yemen", "Sudan", "Libya"],
  world: ["الولايات المتحدة", "أمريكا", "الأمريكي", "واشنطن", "البيت الأبيض", "ترامب", "روسيا", "الروسي", "موسكو", "بوتين", "أوكرانيا", "الأوكراني", "كييف", "الصين", "الصيني", "بكين", "أوروبا", "الأوروبي", "الاتحاد الأوروبي", "بريطانيا", "البريطاني", "لندن", "فرنسا", "الفرنسي", "باريس", "ألمانيا", "الألماني", "برلين", "إيران", "الإيراني", "طهران", "تركيا", "التركي", "أنقرة", "إسرائيل", "الإسرائيلي", "الهند", "باكستان", "اليابان", "كوريا", "الناتو", "الأمم المتحدة", "مجلس الأمن", "United States", "Russia", "Ukraine", "China", "Europe", "Iran", "Turkey", "NATO", "United Nations"],
  politics: ["الرئيس", "رئيس الوزراء", "الحكومة", "البرلمان", "مجلس النواب", "مجلس الشيوخ", "الانتخابات", "انتخابات", "وزير الخارجية", "الدبلوماسية", "مفاوضات", "اتفاق", "قمة", "عقوبات", "سفير", "وقف إطلاق النار", "الهدنة", "حزب", "معارضة", "استفتاء", "قرار أممي", "election", "president", "parliament", "minister", "ceasefire", "sanctions", "diplomatic"],
  economy: ["اقتصاد", "الاقتصاد", "اقتصادي", "اقتصادية", "البورصة", "الأسهم", "بورصة عمان", "النفط", "برنت", "الذهب", "الدولار", "الدينار", "اليورو", "التضخم", "الفائدة", "البنك المركزي", "الاحتياطي الفيدرالي", "صندوق النقد", "البنك الدولي", "الاستثمار", "الصادرات", "الواردات", "الموازنة", "العجز", "الناتج المحلي", "الأسعار", "المحروقات", "الضرائب", "الجمارك", "الشركات", "أرباح", "مليار دولار", "مليون دينار", "economy", "inflation", "stocks", "oil prices", "IMF", "GDP"],
  tech: ["الذكاء الاصطناعي", "تكنولوجيا", "التكنولوجيا", "تقنية", "التقنية", "تطبيق", "هاتف ذكي", "آيفون", "أندرويد", "آبل", "غوغل", "جوجل", "مايكروسوفت", "ميتا", "سامسونغ", "إنفيديا", "أوبن إيه آي", "تشات جي بي تي", "شات جي بي تي", "الأمن السيبراني", "اختراق", "قرصنة", "الإنترنت", "رقمي", "رقمية", "الروبوت", "الرقائق", "أشباه الموصلات", "ChatGPT", "OpenAI", "Nvidia", "Apple", "Google", "Microsoft", "AI ", "artificial intelligence", "cyber"],
  health: ["الصحة", "صحة", "صحي", "وزارة الصحة", "منظمة الصحة العالمية", "مستشفى", "المستشفيات", "مرض", "أمراض", "وباء", "فيروس", "لقاح", "اللقاحات", "السرطان", "السكري", "الكوليرا", "الحصبة", "دواء", "أدوية", "طبي", "طبية", "الأطباء", "علماء", "دراسة", "الباحثون", "العلوم", "الفضاء", "ناسا", "كوكب", "اكتشاف", "health", "WHO", "vaccine", "disease", "study finds", "scientists", "NASA"],
  weather: ["الطقس", "طقس", "حالة الطقس", "الأرصاد الجوية", "دائرة الأرصاد", "الأرصاد", "منخفض جوي", "المنخفض الجوي", "كتلة هوائية", "الكتلة الهوائية", "موجة حارة", "موجة حر", "موجة باردة", "أمطار", "الأمطار", "زخات", "ثلوج", "الثلوج", "تساقط الثلوج", "الصقيع", "عاصفة رملية", "عاصفة ثلجية", "عاصفة مطرية", "درجات الحرارة", "درجة مئوية", "الضباب", "السيول", "سيول", "الفيضانات", "إعصار", "الإعصار", "عاصفة استوائية", "عدم الاستقرار الجوي", "عواصف رعدية", "زخات رعدية", "مدى الرؤية", "weather", "heatwave", "snowfall", "rainfall", "hurricane", "typhoon", "storm", "floods"],
  environment: ["البيئة", "بيئي", "بيئية", "وزارة البيئة", "المناخ", "التغير المناخي", "تغير المناخ", "الاحتباس الحراري", "الانبعاثات", "انبعاثات الكربون", "التلوث", "تلوث", "التصحر", "الجفاف", "شح المياه", "المياه الجوفية", "الطاقة المتجددة", "الطاقة الشمسية", "طاقة الرياح", "الغابات", "حرائق الغابات", "التنوع البيولوجي", "الحياة البرية", "النفايات", "إعادة التدوير", "مؤتمر المناخ", "climate", "climate change", "emissions", "pollution", "renewable", "biodiversity", "drought", "wildfire", "deforestation", "COP30", "COP31"],
  education: ["التعليم", "تعليم", "التربية والتعليم", "وزارة التربية", "وزارة التعليم العالي", "التعليم العالي", "الجامعات", "جامعات", "الجامعة الأردنية", "جامعة اليرموك", "طلبة", "الطلبة", "الطلاب", "المدارس", "مدرسة", "المعلمين", "نقابة المعلمين", "التوجيهي", "امتحانات", "الامتحانات", "امتحان", "القبول الموحد", "منح دراسية", "المنح", "بعثات", "العام الدراسي", "الفصل الدراسي", "school", "schools", "students", "university", "universities", "education", "teachers", "exams"],
  entertainment: ["فن", "الفن", "فنان", "فنانة", "الفنان", "الفنانة", "فني", "فنية", "مهرجان", "المهرجان", "فيلم", "الفيلم", "أفلام", "سينما", "السينما", "مسلسل", "المسلسل", "مسلسلات", "دراما", "الدراما", "مطرب", "مطربة", "أغنية", "ألبوم", "حفل", "حفلة", "حفلات", "مسرح", "المسرح", "الممثل", "الممثلة", "ممثل", "ممثلة", "الأوسكار", "جائزة غرامي", "غرامي", "نتفليكس", "هوليوود", "Netflix", "Hollywood", "Oscar", "Oscars", "Grammy", "film", "movie", "actor", "actress", "singer", "album", "festival", "celebrity"],
  security: ["الأمن العام", "مديرية الأمن العام", "الشرطة", "شرطة", "الأجهزة الأمنية", "أمني", "أمنية", "جريمة", "جرائم", "الجريمة", "جنائي", "القبض", "القبض على", "مخدرات", "المخدرات", "تهريب", "مهربين", "إرهاب", "الإرهاب", "إرهابي", "إرهابية", "خلية", "اعتقال", "اعتقل", "حملة اعتقالات", "سرقة", "احتيال", "إطلاق نار", "الدفاع المدني", "حادث سير", "حوادث السير", "الأمن السيبراني", "هجوم سيبراني", "هجوم إلكتروني", "اختراق", "police", "arrested", "arrest", "crime", "terrorism", "terror", "smuggling", "drugs", "shooting", "cyberattack", "security forces"],
  sports: ["رياضة", "الرياضة", "رياضي", "كرة القدم", "كرة السلة", "مباراة", "المباراة", "الدوري", "دوري", "كأس", "بطولة", "منتخب", "المنتخب", "النشامى", "أهداف", "مدرب", "لاعب", "اللاعب", "نادي", "النادي", "الفيصلي", "الوحدات", "ريال مدريد", "برشلونة", "ليفربول", "مانشستر", "الهلال", "النصر", "الأهلي", "الزمالك", "ميسي", "رونالدو", "صلاح", "فيفا", "الاتحاد الآسيوي", "الأولمبية", "الأولمبياد", "فورمولا", "التنس", "Premier League", "FIFA", "football", "Olympic"],
};

const ALLEGATION = ["مزاعم", "يزعم", "تزعم", "زعم", "زعمت", "ادعاء", "ادعاءات", "يدعي", "ادعت", "اتهام", "اتهامات", "اتهم", "اتهمت", "يتهم", "تتهم", "أنباء عن", "تقارير عن", "أنباء غير مؤكدة", "غير مؤكد", "غير مؤكدة", "أنباء أولية", "مصادر", "شهود عيان", "نقلا عن مصادر", "يشتبه", "مشتبه", "reportedly", "alleged", "allegedly", "claims", "unconfirmed", "sources say", "accuses"];
const STATEMENT = ["بيان", "أعلن", "أعلنت", "تعلن", "يعلن", "المتحدث باسم", "الناطق باسم", "الناطق الرسمي", "صرح", "تصريح", "تصريحات", "أكد", "أكدت", "الديوان الملكي", "رئاسة الوزراء", "وزارة", "الأمن العام", "مديرية", "statement", "announced", "spokesperson", "ministry said", "official said"];
const DEVELOPING = ["عاجل", "خبر عاجل", "تطورات", "متابعة مستمرة", "قيد التطور", "لحظة بلحظة", "تحديث", "مباشر", "breaking", "developing", "live updates"];
const BREAKING = ["عاجل", "خبر عاجل", "breaking", "urgent"];
const HIGH_IMPACT = ["زلزال", "هزة أرضية", "انفجار", "اغتيال", "استشهاد", "شهداء", "شهيد", "قتلى", "قتيل", "مقتل", "ضحايا", "إصابات", "جرحى", "حريق", "غارة", "غارات", "قصف", "هجوم", "صواريخ", "صاروخ", "اجتياح", "حرب", "وقف إطلاق النار", "هدنة", "انقلاب", "إعصار", "فيضانات", "عاصفة", "منخفض جوي", "تحطم", "وفاة", "رحيل", "إخلاء", "طوارئ", "earthquake", "explosion", "killed", "attack", "airstrike", "ceasefire", "crash", "evacuation"];

function prep(list: string[]): RegExp {
  const parts = list.map((k) => normalizeArabic(k)).filter(Boolean).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // allow common attached prefixes before Arabic keywords (و ب ل ف ك ال وال بال لل)
  return new RegExp(`(?:^|\\s)(?:و|ف|ب|ل|ك|ال|وال|بال|لل|فال)?(?:${parts.join("|")})(?=\\s|$)`, "g");
}
const KW_RE = Object.fromEntries(Object.entries(KEYWORDS).map(([k, v]) => [k, prep(v)])) as Record<Category, RegExp>;
const ALLEGATION_RE = prep(ALLEGATION);
const STATEMENT_RE = prep(STATEMENT);
const DEVELOPING_RE = prep(DEVELOPING);
const BREAKING_RE = prep(BREAKING);
const IMPACT_RE = prep(HIGH_IMPACT);

function count(re: RegExp, s: string): number {
  re.lastIndex = 0;
  return (s.match(re) || []).length;
}

export interface SourceInfo {
  kind: "media" | "agency" | "official";
  reliability: number; // 1..5
  default_category: Category | null;
  topical: boolean; // source is a single-topic feed (e.g. a sports feed)
}

export interface Classification {
  category: Category;
  categories: Category[];
  verification: Verification;
  isBreakingKeyword: boolean;
  highImpact: boolean;
  importance: number;
}

export function classify(title: string, description: string, feedCategories: string[], src: SourceInfo): Classification {
  const t = normalizeArabic(title);
  const d = normalizeArabic(description.slice(0, 600));
  const fc = normalizeArabic(feedCategories.join(" "));
  const scores = {} as Record<Category, number>;
  for (const c of Object.keys(KEYWORDS) as Category[]) {
    scores[c] = count(KW_RE[c], t) * 3 + count(KW_RE[c], d) + count(KW_RE[c], fc) * 2;
  }
  if (src.default_category && src.topical) scores[src.default_category] += 4;

  const best = (list: Category[]) => list.reduce<Category | null>((a, c) => (scores[c] > 0 && (!a || scores[c] > scores[a]) ? c : a), null);
  const topical = best(TOPICAL.filter((c) => !SECONDARY.includes(c)));
  const geo = best(GEO);
  let primary: Category;
  if (topical && scores[topical] >= 3) primary = topical;
  else if (geo && scores[geo] >= 2) primary = geo;
  else if (scores.politics >= 3 || scores.security >= 3) primary = scores.security > scores.politics ? "security" : "politics";
  else primary = src.default_category ?? geo ?? topical ?? "world";

  const cats = new Set<Category>([primary]);
  for (const c of Object.keys(scores) as Category[]) if (scores[c] >= 3) cats.add(c);
  // Jordanian/Palestinian national news is shown in its own section; avoid double-listing as "arab".
  if (cats.has("arab") && scores.arab < Math.max(scores.jordan, scores.palestine)) cats.delete("arab");

  const isBreakingKeyword = count(BREAKING_RE, t) > 0 || count(BREAKING_RE, fc) > 0;
  const highImpact = count(IMPACT_RE, t) > 0;

  let verification: Verification;
  if (src.kind === "official") verification = "official";
  else if (count(ALLEGATION_RE, t + " " + d.slice(0, 200)) > 0) verification = "allegation";
  else if (count(STATEMENT_RE, t) > 0) verification = "statement";
  else if (isBreakingKeyword || count(DEVELOPING_RE, t) > 0) verification = "developing";
  else verification = "reported";

  let importance = src.reliability * 8;
  if (isBreakingKeyword) importance += 35;
  if (highImpact) importance += 15;
  if (src.kind === "official") importance += 10;
  // No country bonus: Jordan, Palestine and every other country are ranked on the same terms.

  return { category: primary, categories: [...cats], verification, isBreakingKeyword, highImpact, importance };
}

/** Strip a leading "عاجل |" / "Breaking:" marker from the display headline. */
export function cleanHeadline(title: string): string {
  return title.replace(/^\s*(?:خبر\s+)?(?:عاجل|breaking(?:\s+news)?|urgent)\s*[:|\-–—|]+\s*/i, "").replace(/\s*[|\-–—]\s*(?:عاجل)\s*$/, "").trim() || title;
}
