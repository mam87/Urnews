// Competitions the sports centre features (slugs verified against the provider on 2026-11-07),
// and Arabic names for well-known teams. Names not listed are shown exactly as the provider spells them —
// we never guess a translation. Aliases are also used to find related Lahza news about a team.

export const SPORTS = [
  ["football", "كرة القدم", "Football", "⚽"],
  ["basketball", "كرة السلة", "Basketball", "🏀"],
  ["tennis", "التنس", "Tennis", "🎾"],
  ["cricket", "الكريكيت", "Cricket", "🏏"],
];

// slug, provider name (as it appears in fixture lists), Arabic, English, has table, has bracket
export const COMPETITIONS = [
  ["uefa-champions-league", "UEFA Champions League", "دوري أبطال أوروبا", "Champions League", true, false],
  ["english-premier-league", "English Premier League", "الدوري الإنجليزي الممتاز", "Premier League", true, false],
  ["spanish-la-liga", "Spanish La Liga", "الدوري الإسباني", "La Liga", true, false],
  ["italian-serie-a", "Italian Serie A", "الدوري الإيطالي", "Serie A", true, false],
  ["bundesliga", "Bundesliga", "الدوري الألماني", "Bundesliga", true, false],
  ["french-ligue-1", "French Ligue 1", "الدوري الفرنسي", "Ligue 1", true, false],
  ["uefa-europa-league", "UEFA Europa League", "الدوري الأوروبي", "Europa League", true, false],
  ["saudi-professional-league", "Saudi Professional League", "الدوري السعودي للمحترفين", "Saudi Pro League", true, false],
  ["jordan-premier-league", "Jordan Premier League", "الدوري الأردني للمحترفين", "Jordanian Pro League", true, false],
  ["fifa-world-cup", "FIFA World Cup", "كأس العالم", "FIFA World Cup", false, true],
];
export const COMP_BY_SLUG = Object.fromEntries(COMPETITIONS.map((c) => [c[0], c]));
export const COMP_BY_NAME = Object.fromEntries(COMPETITIONS.map((c) => [c[1].toLowerCase(), c]));

// provider team name (lower-case) → Arabic name. Extra Arabic spellings help the news search.
const TEAMS = {
  "fc barcelona": ["برشلونة"], "real madrid": ["ريال مدريد"], "atletico madrid": ["أتلتيكو مدريد", "أتلتيكو"],
  "sevilla fc": ["إشبيلية"], "real betis": ["ريال بيتيس", "بيتيس"], "real sociedad": ["ريال سوسيداد"], "villarreal cf": ["فياريال"],
  "athletic club": ["أتلتيك بلباو"], "athletic bilbao": ["أتلتيك بلباو"], "valencia cf": ["فالنسيا"], "getafe": ["خيتافي"],
  "manchester city": ["مانشستر سيتي"], "manchester united": ["مانشستر يونايتد"], "liverpool": ["ليفربول"], "liverpool fc": ["ليفربول"],
  "arsenal": ["أرسنال", "آرسنال"], "chelsea": ["تشيلسي"], "tottenham hotspur": ["توتنهام"], "newcastle united": ["نيوكاسل"], "aston villa": ["أستون فيلا"],
  "fc bayern munich": ["بايرن ميونخ", "البايرن"], "borussia dortmund": ["بوروسيا دورتموند", "دورتموند"], "bayer leverkusen": ["باير ليفركوزن", "ليفركوزن"], "rb leipzig": ["لايبزيغ"],
  "inter milan": ["إنتر ميلان"], "inter": ["إنتر ميلان"], "ac milan": ["ميلان"], "juventus": ["يوفنتوس"], "ssc napoli": ["نابولي"], "napoli": ["نابولي"], "as roma": ["روما"], "como": ["كومو"],
  "paris saint germain": ["باريس سان جيرمان"], "paris saint-germain": ["باريس سان جيرمان"], "olympique de marseille": ["مارسيليا"], "as monaco": ["موناكو"], "olympique lyonnais": ["ليون"],
  "al hilal": ["الهلال"], "al-hilal": ["الهلال"], "al nassr": ["النصر"], "al-nassr": ["النصر"], "al ittihad": ["الاتحاد"], "al-ittihad": ["الاتحاد"], "al ahli": ["الأهلي"], "al-ahli saudi": ["الأهلي"],
  "al wehdat": ["الوحدات"], "al-faisaly amman": ["الفيصلي"], "al-ramtha sc": ["الرمثا"], "al-hussein irbid": ["الحسين إربد"], "al-baqaa": ["البقعة"],
  "jordan": ["الأردن", "النشامى"], "saudi arabia": ["السعودية"], "morocco": ["المغرب"], "egypt": ["مصر"], "qatar": ["قطر"], "iraq": ["العراق"],
  "spain": ["إسبانيا"], "france": ["فرنسا"], "germany": ["ألمانيا"], "england": ["إنجلترا"], "portugal": ["البرتغال"], "brazil": ["البرازيل"], "argentina": ["الأرجنتين"], "italy": ["إيطاليا"], "netherlands": ["هولندا"],
  "galatasaray istanbul": ["غلطة سراي"], "fenerbahce istanbul": ["فنربخشة"], "fc porto": ["بورتو"], "sl benfica": ["بنفيكا"], "sporting cp": ["سبورتنغ لشبونة"], "psv eindhoven": ["آيندهوفن"], "ajax": ["أياكس"],
};

const key = (s) => String(s || "").toLowerCase().trim();
/** Arabic name if we know it, else null. */
export const teamAr = (name) => TEAMS[key(name)]?.[0] || null;
/** All spellings to look for in news headlines (provider name + Arabic names), safe for a PostgREST filter. */
export function teamAliases(name) {
  const out = new Set([name, ...(TEAMS[key(name)] || [])].filter(Boolean));
  // common short forms in English headlines: "FC Barcelona" → "Barcelona"
  const short = String(name || "").replace(/^(fc|cf|ac|as|ssc|sl|rb|al-|al )\s*/i, "").replace(/\s+(fc|cf|sc)$/i, "").trim();
  if (short.length >= 4) out.add(short);
  return [...out].map((s) => s.replace(/[,()*%\\"]/g, " ").trim()).filter((s) => s.length >= 3);
}
