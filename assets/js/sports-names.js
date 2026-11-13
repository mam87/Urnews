// Competitions the sports centre features (slugs verified against the provider; Nations League and the World Cup /
// Euro qualifiers on 2026-11-13), their grouping, and Arabic names for teams, competitions and the provider's
// short English phrases (status, groups, rounds). Anything not listed is shown exactly as the provider spells it —
// we never guess a translation. Team aliases are also used to find related Lahza news.
import { COUNTRIES } from "./countries.js";

export const SPORTS = [
  ["football", "كرة القدم", "Football", "⚽"],
  ["basketball", "كرة السلة", "Basketball", "🏀"],
  ["tennis", "التنس", "Tennis", "🎾"],
  ["cricket", "الكريكيت", "Cricket", "🏏"],
];

// how the day list and the competition menu are organised
export const COMP_GROUPS = [
  ["intl", "المنتخبات", "National teams"],
  ["europe", "بطولات أوروبا للأندية", "European club competitions"],
  ["leagues", "الدوريات الكبرى", "Top leagues"],
  ["arab", "الدوريات العربية", "Arab leagues"],
];

// slug, provider name (as it appears in fixture lists), Arabic, English, has table, has bracket, group
export const COMPETITIONS = [
  ["uefa-nations-league", "UEFA Nations League", "دوري الأمم الأوروبية", "UEFA Nations League", true, false, "intl"],
  ["fifa-world-cup", "FIFA World Cup", "كأس العالم", "FIFA World Cup", false, true, "intl"],
  ["fifa-world-cup-qualification-afc", "FIFA World Cup qualification (AFC)", "تصفيات كأس العالم — آسيا", "World Cup Qualifiers — Asia", true, false, "intl"],
  ["fifa-world-cup-qualification-caf", "FIFA World Cup qualification (CAF)", "تصفيات كأس العالم — أفريقيا", "World Cup Qualifiers — Africa", true, false, "intl"],
  ["fifa-world-cup-qualification-uefa", "FIFA World Cup qualification (UEFA)", "تصفيات كأس العالم — أوروبا", "World Cup Qualifiers — Europe", true, false, "intl"],
  ["fifa-world-cup-qualification-conmebol", "FIFA World Cup qualification (CONMEBOL)", "تصفيات كأس العالم — أمريكا الجنوبية", "World Cup Qualifiers — South America", true, false, "intl"],
  ["uefa-european-championship-qualification", "UEFA European Championship qualification", "تصفيات كأس أمم أوروبا", "Euro Qualifiers", true, false, "intl"],
  ["uefa-champions-league", "UEFA Champions League", "دوري أبطال أوروبا", "Champions League", true, false, "europe"],
  ["uefa-europa-league", "UEFA Europa League", "الدوري الأوروبي", "Europa League", true, false, "europe"],
  ["english-premier-league", "English Premier League", "الدوري الإنجليزي الممتاز", "Premier League", true, false, "leagues"],
  ["spanish-la-liga", "Spanish La Liga", "الدوري الإسباني", "La Liga", true, false, "leagues"],
  ["italian-serie-a", "Italian Serie A", "الدوري الإيطالي", "Serie A", true, false, "leagues"],
  ["bundesliga", "Bundesliga", "الدوري الألماني", "Bundesliga", true, false, "leagues"],
  ["french-ligue-1", "French Ligue 1", "الدوري الفرنسي", "Ligue 1", true, false, "leagues"],
  ["saudi-professional-league", "Saudi Professional League", "الدوري السعودي للمحترفين", "Saudi Pro League", true, false, "arab"],
  ["jordan-premier-league", "Jordan Premier League", "الدوري الأردني للمحترفين", "Jordanian Pro League", true, false, "arab"],
];
export const COMP_BY_SLUG = Object.fromEntries(COMPETITIONS.map((c) => [c[0], c]));
export const COMP_BY_NAME = Object.fromEntries(COMPETITIONS.map((c) => [c[1].toLowerCase(), c]));

// ---------- normalisation ----------
const fold = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9()]+/g, " ").trim();
const DROP = new Set(["fc", "cf", "sc", "ac", "afc", "ssc", "sl", "cd", "ud", "rcd", "sd", "as", "ss", "us", "calcio", "club"]);
/** "FC Barcelona" / "Barcelona" / "F.C. Barcelona" → "barcelona" */
const core = (name) => { const t = fold(name).split(" ").filter((w) => !DROP.has(w)); return t.join(" ") || fold(name); };

// ---------- clubs: core name → [Arabic, extra Arabic spellings for the news search] ----------
const CLUBS = {
  // England
  "arsenal": ["أرسنال", "آرسنال"], "aston villa": ["أستون فيلا"], "bournemouth": ["بورنموث"], "brentford": ["برينتفورد"], "brighton": ["برايتون"],
  "brighton hove albion": ["برايتون"], "burnley": ["بيرنلي"], "chelsea": ["تشيلسي"], "crystal palace": ["كريستال بالاس"], "everton": ["إيفرتون"],
  "fulham": ["فولهام"], "leeds united": ["ليدز يونايتد"], "liverpool": ["ليفربول"], "manchester city": ["مانشستر سيتي"], "manchester united": ["مانشستر يونايتد"],
  "newcastle united": ["نيوكاسل يونايتد", "نيوكاسل"], "nottingham forest": ["نوتنغهام فورست"], "sunderland": ["سندرلاند"], "tottenham hotspur": ["توتنهام"],
  "tottenham": ["توتنهام"], "west ham united": ["وست هام"], "wolverhampton wanderers": ["وولفرهامبتون"], "wolves": ["وولفرهامبتون"],
  "leicester city": ["ليستر سيتي"], "southampton": ["ساوثهامبتون"], "ipswich town": ["إيبسويتش تاون"], "sheffield united": ["شيفيلد يونايتد"],
  // Spain
  "barcelona": ["برشلونة"], "real madrid": ["ريال مدريد"], "atletico madrid": ["أتلتيكو مدريد", "أتلتيكو"], "sevilla": ["إشبيلية"],
  "real betis": ["ريال بيتيس", "بيتيس"], "real sociedad": ["ريال سوسيداد"], "villarreal": ["فياريال"], "athletic": ["أتلتيك بلباو"],
  "athletic bilbao": ["أتلتيك بلباو"], "valencia": ["فالنسيا"], "getafe": ["خيتافي"], "girona": ["جيرونا"], "celta vigo": ["سيلتا فيغو"],
  "celta de vigo": ["سيلتا فيغو"], "osasuna": ["أوساسونا"], "rayo vallecano": ["رايو فاييكانو"], "mallorca": ["ريال مايوركا", "مايوركا"],
  "espanyol": ["إسبانيول"], "alaves": ["ألافيس"], "deportivo alaves": ["ألافيس"], "las palmas": ["لاس بالماس"], "leganes": ["ليغانيس"],
  "real valladolid": ["بلد الوليد"], "levante": ["ليفانتي"], "elche": ["إلتشي"], "real oviedo": ["ريال أوفييدو"],
  // Italy
  "inter": ["إنتر ميلان"], "inter milan": ["إنتر ميلان"], "internazionale": ["إنتر ميلان"], "milan": ["ميلان"], "juventus": ["يوفنتوس"],
  "napoli": ["نابولي"], "roma": ["روما"], "lazio": ["لاتسيو"], "atalanta": ["أتالانتا"], "fiorentina": ["فيورنتينا"], "bologna": ["بولونيا"],
  "torino": ["تورينو"], "udinese": ["أودينيزي"], "genoa": ["جنوى"], "como": ["كومو"], "parma": ["بارما"], "cagliari": ["كالياري"],
  "lecce": ["ليتشي"], "verona": ["هيلاس فيرونا"], "hellas verona": ["هيلاس فيرونا"], "sassuolo": ["ساسولو"], "monza": ["مونزا"], "empoli": ["إمبولي"],
  // Germany
  "bayern munich": ["بايرن ميونخ", "البايرن"], "bayern munchen": ["بايرن ميونخ", "البايرن"], "borussia dortmund": ["بوروسيا دورتموند", "دورتموند"],
  "bayer leverkusen": ["باير ليفركوزن", "ليفركوزن"], "bayer 04 leverkusen": ["باير ليفركوزن", "ليفركوزن"], "rb leipzig": ["لايبزيغ"], "leipzig": ["لايبزيغ"],
  "eintracht frankfurt": ["آينتراخت فرانكفورت"], "vfb stuttgart": ["شتوتغارت"], "stuttgart": ["شتوتغارت"], "borussia monchengladbach": ["بوروسيا مونشنغلادباخ"],
  "vfl wolfsburg": ["فولفسبورغ"], "wolfsburg": ["فولفسبورغ"], "freiburg": ["فرايبورغ"], "hoffenheim": ["هوفنهايم"], "union berlin": ["يونيون برلين"],
  "werder bremen": ["فيردر بريمن"], "mainz": ["ماينز"], "mainz 05": ["ماينز"], "augsburg": ["أوغسبورغ"], "koln": ["كولن"], "hamburger sv": ["هامبورغ"], "st pauli": ["سانت باولي"],
  // France
  "paris saint germain": ["باريس سان جيرمان"], "psg": ["باريس سان جيرمان"], "marseille": ["مارسيليا"], "olympique marseille": ["مارسيليا"],
  "olympique de marseille": ["مارسيليا"], "monaco": ["موناكو"], "lyon": ["ليون"], "olympique lyonnais": ["ليون"], "olympique lyon": ["ليون"],
  "lille": ["ليل"], "losc lille": ["ليل"], "nice": ["نيس"], "lens": ["لانس"], "rennes": ["رين"], "stade rennais": ["رين"], "nantes": ["نانت"],
  "strasbourg": ["ستراسبورغ"], "toulouse": ["تولوز"], "brest": ["بريست"],
  // rest of Europe
  "galatasaray": ["غلطة سراي"], "galatasaray istanbul": ["غلطة سراي"], "fenerbahce": ["فنربخشة"], "fenerbahce istanbul": ["فنربخشة"], "besiktas": ["بشكتاش"],
  "porto": ["بورتو"], "benfica": ["بنفيكا"], "sporting cp": ["سبورتنغ لشبونة"], "sporting lisbon": ["سبورتنغ لشبونة"], "psv eindhoven": ["آيندهوفن"], "psv": ["آيندهوفن"],
  "ajax": ["أياكس"], "feyenoord": ["فينورد"], "celtic": ["سلتيك"], "rangers": ["رينجرز"], "brugge": ["كلوب بروج"], "red bull salzburg": ["سالزبورغ"],
  "shakhtar donetsk": ["شاختار دونيتسك"], "dinamo zagreb": ["دينامو زغرب"], "olympiacos": ["أولمبياكوس"], "inter miami": ["إنتر ميامي"],
  // Saudi Arabia
  "al hilal": ["الهلال"], "al nassr": ["النصر"], "al ittihad": ["الاتحاد"], "al ahli": ["الأهلي"], "al ahli saudi": ["الأهلي"], "al shabab": ["الشباب"],
  "al ettifaq": ["الاتفاق"], "al taawoun": ["التعاون"], "al fateh": ["الفتح"], "al qadsiah": ["القادسية"], "al khaleej": ["الخليج"], "al riyadh": ["الرياض"],
  "al fayha": ["الفيحاء"], "damac": ["ضمك"], "al okhdood": ["الأخدود"], "al wehda": ["الوحدة"], "neom": ["نيوم"], "al najma": ["النجمة"], "al hazem": ["الحزم"], "al kholood": ["الخلود"],
  // Jordan
  "al wehdat": ["الوحدات"], "al faisaly": ["الفيصلي"], "al faisaly amman": ["الفيصلي"], "al ramtha": ["الرمثا"], "al hussein": ["الحسين إربد"],
  "al hussein irbid": ["الحسين إربد"], "al baqaa": ["البقعة"], "al jazeera amman": ["الجزيرة"], "al salt": ["السلط"], "shabab al ordon": ["شباب الأردن"],
  "al ahli amman": ["الأهلي"], "maan": ["معان"], "sahab": ["سحاب"], "al aqaba": ["العقبة"], "al sareeh": ["الصريح"],
  // Egypt and North Africa
  "al ahly": ["الأهلي المصري", "الأهلي"], "zamalek": ["الزمالك"], "pyramids": ["بيراميدز"], "al masry": ["المصري"], "ismaily": ["الإسماعيلي"],
  "esperance tunis": ["الترجي التونسي", "الترجي"], "wydad casablanca": ["الوداد", "الوداد البيضاوي"], "raja casablanca": ["الرجاء", "الرجاء البيضاوي"],
};

// ---------- national teams: every country name in the site's own list, plus football-only names ----------
const NATIONS = Object.fromEntries(Object.values(COUNTRIES).map(([ar, en]) => [fold(en), ar]));
Object.assign(NATIONS, {
  "england": "إنجلترا", "scotland": "اسكتلندا", "wales": "ويلز", "northern ireland": "أيرلندا الشمالية", "republic of ireland": "جمهورية أيرلندا",
  "usa": "الولايات المتحدة", "south korea": "كوريا الجنوبية", "korea republic": "كوريا الجنوبية", "north korea": "كوريا الشمالية", "czech republic": "التشيك", "czechia": "التشيك",
  "turkey": "تركيا", "turkiye": "تركيا", "ivory coast": "ساحل العاج", "cote d ivoire": "ساحل العاج", "bosnia and herzegovina": "البوسنة والهرسك", "bosnia herzegovina": "البوسنة والهرسك",
  "north macedonia": "مقدونيا الشمالية", "faroe islands": "جزر فارو", "kosovo": "كوسوفو", "gibraltar": "جبل طارق", "dr congo": "الكونغو الديمقراطية", "cape verde": "الرأس الأخضر",
  "uae": "الإمارات", "united arab emirates": "الإمارات", "palestine": "فلسطين", "chinese taipei": "تايوان", "hong kong": "هونغ كونغ", "netherlands": "هولندا", "holland": "هولندا",
  "ir iran": "إيران", "iran": "إيران", "russia": "روسيا", "syria": "سوريا", "moldova": "مولدوفا", "san marino": "سان مارينو", "liechtenstein": "ليختنشتاين", "andorra": "أندورا",
});
const NATION_ALT = { "jordan": ["النشامى"], "egypt": ["الفراعنة"], "morocco": ["أسود الأطلس"], "saudi arabia": ["الأخضر"] };
const SUFFIX = [[/\s+u\s?(\d{2})$/, (m) => ` تحت ${m[1]}`], [/\s+(women|w|\(w\))$/, () => " (سيدات)"], [/\s+olympic$/, () => " الأولمبي"], [/\s+(b|ii)$/, () => " (الرديف)"]];

function lookup(name) {
  const k = core(name);
  if (CLUBS[k]) return CLUBS[k];
  const f = fold(name);
  if (CLUBS[f]) return CLUBS[f];
  if (NATIONS[f]) return [NATIONS[f], ...(NATION_ALT[f] || [])];
  for (const [re, suffix] of SUFFIX) {
    const m = re.exec(f);
    if (m) { const base = lookup(f.slice(0, m.index)); if (base) return [base[0] + suffix(m)]; }
  }
  return null;
}
/** Arabic name if we know it, else null. */
export const teamAr = (name) => lookup(name)?.[0] || null;
/** All spellings to look for in news headlines (provider name + Arabic names), safe for a PostgREST filter. */
export function teamAliases(name) {
  const out = new Set([name, ...(lookup(name) || []).filter((s) => !/[()]/.test(s))].filter(Boolean));
  // common short forms in English headlines: "FC Barcelona" → "Barcelona"
  const short = String(name || "").replace(/^(fc|cf|ac|as|ssc|sl|rb|al-|al )\s*/i, "").replace(/\s+(fc|cf|sc)$/i, "").trim();
  if (short.length >= 4) out.add(short);
  return [...out].map((s) => s.replace(/[,()*%\\"]/g, " ").trim()).filter((s) => s.length >= 3);
}

// ---------- competitions the provider lists but we do not feature: display names only ----------
const COMP_AR = {
  "international friendly": "مباريات ودية دولية", "international friendlies": "مباريات ودية دولية", "friendly international": "مباريات ودية دولية", "club friendlies": "مباريات ودية للأندية", "club friendly": "مباريات ودية للأندية",
  "uefa europa conference league": "دوري المؤتمر الأوروبي", "uefa conference league": "دوري المؤتمر الأوروبي", "uefa super cup": "كأس السوبر الأوروبي", "uefa european championship": "كأس أمم أوروبا",
  "fifa club world cup": "كأس العالم للأندية", "fifa arab cup": "كأس العرب", "arab cup": "كأس العرب", "arabian gulf cup": "كأس الخليج العربي", "gulf cup": "كأس الخليج العربي",
  "africa cup of nations": "كأس أمم أفريقيا", "caf africa cup of nations": "كأس أمم أفريقيا", "africa cup of nations qualification": "تصفيات كأس أمم أفريقيا", "caf champions league": "دوري أبطال أفريقيا", "caf confederation cup": "كأس الكونفدرالية الأفريقية",
  "afc asian cup": "كأس آسيا", "afc asian cup qualification": "تصفيات كأس آسيا", "afc champions league elite": "دوري أبطال آسيا للنخبة", "afc champions league": "دوري أبطال آسيا", "afc champions league two": "دوري أبطال آسيا 2",
  "copa america": "كوبا أمريكا", "conmebol copa libertadores": "كأس ليبرتادوريس", "copa libertadores": "كأس ليبرتادوريس", "concacaf nations league": "دوري أمم الكونكاكاف", "concacaf gold cup": "الكأس الذهبية",
  "fifa world cup qualification (concacaf)": "تصفيات كأس العالم — الكونكاكاف", "fifa world cup qualification (ofc)": "تصفيات كأس العالم — أوقيانوسيا",
  "english fa cup": "كأس الاتحاد الإنجليزي", "fa cup": "كأس الاتحاد الإنجليزي", "english football league cup": "كأس الرابطة الإنجليزية", "efl cup": "كأس الرابطة الإنجليزية", "english league cup": "كأس الرابطة الإنجليزية",
  "english football league championship": "دوري البطولة الإنجليزية", "english championship": "دوري البطولة الإنجليزية", "spanish copa del rey": "كأس ملك إسبانيا", "copa del rey": "كأس ملك إسبانيا",
  "spanish segunda division": "دوري الدرجة الثانية الإسباني", "italian coppa italia": "كأس إيطاليا", "coppa italia": "كأس إيطاليا", "italian serie b": "دوري الدرجة الثانية الإيطالي",
  "german dfb pokal": "كأس ألمانيا", "dfb pokal": "كأس ألمانيا", "german bundesliga 2": "دوري الدرجة الثانية الألماني", "2 bundesliga": "دوري الدرجة الثانية الألماني", "french coupe de france": "كأس فرنسا", "coupe de france": "كأس فرنسا", "french ligue 2": "دوري الدرجة الثانية الفرنسي",
  "netherlands eredivisie": "الدوري الهولندي", "dutch eredivisie": "الدوري الهولندي", "eredivisie": "الدوري الهولندي", "portuguese primeira liga": "الدوري البرتغالي", "liga portugal": "الدوري البرتغالي",
  "turkish super lig": "الدوري التركي", "turkish super league": "الدوري التركي", "scottish premiership": "الدوري الاسكتلندي", "belgian pro league": "الدوري البلجيكي", "usa major league soccer": "الدوري الأمريكي", "major league soccer": "الدوري الأمريكي",
  "brazilian serie a": "الدوري البرازيلي", "argentine division 1": "الدوري الأرجنتيني", "argentine primera division": "الدوري الأرجنتيني",
  "egyptian premier league": "الدوري المصري الممتاز", "egypt premier league": "الدوري المصري الممتاز", "qatar stars league": "دوري نجوم قطر", "uae pro league": "دوري المحترفين الإماراتي", "uae league": "دوري المحترفين الإماراتي",
  "iraqi stars league": "دوري نجوم العراق", "iraq stars league": "دوري نجوم العراق", "kuwait premier league": "الدوري الكويتي", "bahrain premier league": "الدوري البحريني", "oman professional league": "دوري عمانتل", "lebanese premier league": "الدوري اللبناني",
  "moroccan botola pro": "البطولة الاحترافية المغربية", "morocco botola pro": "البطولة الاحترافية المغربية", "tunisian ligue 1": "الرابطة التونسية الأولى", "algerian ligue 1": "الدوري الجزائري", "saudi king cup": "كأس خادم الحرمين الشريفين", "saudi super cup": "كأس السوبر السعودي",
  "jordan cup": "كأس الأردن", "jordan shield cup": "درع الاتحاد الأردني", "jordan super cup": "كأس السوبر الأردني",
  "nba": "دوري السلة الأمريكي NBA", "euroleague": "يوروليغ", "atp": "بطولات ATP", "wta": "بطولات WTA",
};
/** Arabic display name of a competition we do not feature, or null. */
export const compAr = (name) => COMP_AR[String(name || "").toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim()] || null;

// ---------- the provider's short phrases (status, table groups, promotion labels, knockout rounds) ----------
const PHRASES = {
  "not started": "لم تبدأ", "half time": "استراحة", "halftime": "استراحة", "ht": "استراحة", "1st half": "الشوط الأول", "first half": "الشوط الأول", "2nd half": "الشوط الثاني", "second half": "الشوط الثاني",
  "finished": "انتهت", "ended": "انتهت", "ft": "انتهت", "full time": "انتهت", "postponed": "مؤجلة", "cancelled": "ملغاة", "canceled": "ملغاة", "abandoned": "أُوقفت", "interrupted": "متوقفة", "suspended": "معلّقة",
  "delayed": "متأخرة", "extra time": "وقت إضافي", "aet": "بعد الوقت الإضافي", "after extra time": "بعد الوقت الإضافي", "penalties": "ركلات الترجيح", "after penalties": "بعد ركلات الترجيح", "live": "مباشر", "break": "استراحة", "awaiting updates": "بانتظار التحديث",
  "final": "النهائي", "finals": "النهائيات", "semi finals": "نصف النهائي", "semifinals": "نصف النهائي", "semi final": "نصف النهائي", "quarter finals": "ربع النهائي", "quarterfinals": "ربع النهائي", "quarter final": "ربع النهائي",
  "round of 16": "دور الـ16", "1 8 finals": "دور الـ16", "round of 32": "دور الـ32", "1 16 finals": "دور الـ32", "third place": "المركز الثالث", "3rd place": "المركز الثالث", "third place play off": "مباراة المركز الثالث",
  "group stage": "دور المجموعات", "league phase": "مرحلة الدوري", "play offs": "الملحق", "playoffs": "الملحق", "knockout round play offs": "ملحق الأدوار الإقصائية", "qualification": "التصفيات", "preliminary round": "الدور التمهيدي",
  "promotion": "الصعود", "relegation": "الهبوط", "promotion play offs": "ملحق الصعود", "promotion playoffs": "ملحق الصعود", "relegation play offs": "ملحق الهبوط", "relegation playoffs": "ملحق الهبوط",
  "champions league": "دوري أبطال أوروبا", "champions league qualification": "تصفيات دوري أبطال أوروبا", "uefa champions league": "دوري أبطال أوروبا", "europa league": "الدوري الأوروبي", "uefa europa league": "الدوري الأوروبي",
  "europa league qualification": "تصفيات الدوري الأوروبي", "conference league": "دوري المؤتمر الأوروبي", "conference league qualification": "تصفيات دوري المؤتمر", "uefa conference league": "دوري المؤتمر الأوروبي",
  "afc champions league": "دوري أبطال آسيا", "afc champions league elite": "دوري أبطال آسيا للنخبة", "afc champions league two": "دوري أبطال آسيا 2", "next round": "التأهل للدور التالي", "championship round": "مجموعة التتويج", "relegation round": "مجموعة الهبوط",
  "home": "على أرضه", "away": "خارج أرضه", "overall": "الإجمالي",
};
/** Arabic for a short provider phrase ("Group B", "Half-time", "Relegation"); the original when unknown. */
export function phraseAr(s) {
  const t = String(s || "").trim();
  if (!t) return t;
  const k = t.toLowerCase().replace(/[-–/.:]+/g, " ").replace(/\s+/g, " ").trim();
  if (PHRASES[k]) return PHRASES[k];
  let m;
  if ((m = /^group ([a-z0-9]{1,2})$/.exec(k))) return "المجموعة " + m[1].toUpperCase();
  if ((m = /^league ([a-d])(?:[, ]+group (\d))?$/.exec(k))) return "المستوى " + m[1].toUpperCase() + (m[2] ? " — المجموعة " + m[2] : "");
  if ((m = /^(?:round|matchday|week|gameweek) (\d{1,2})$/.exec(k))) return "الجولة " + m[1];
  if ((m = /^(\d{1,2})(?:st|nd|rd|th) round$/.exec(k))) return "الدور " + m[1];
  return compAr(t) || t;
}
