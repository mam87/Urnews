// Bilingual (Arabic + English) gazetteer: which countries a headline is about, and their world region.
// Location is used ONLY for tagging and filtering. It never adds ranking points (see rank.ts): Jordan is
// treated exactly like every other country.
import { normalizeArabic, termPattern } from "./text.ts";

export type Region =
  | "north_america" | "south_america" | "europe" | "middle_east" | "north_africa" | "sub_saharan_africa"
  | "east_asia" | "south_asia" | "southeast_asia" | "central_asia" | "oceania";

export const REGIONS: Region[] = [
  "north_america", "south_america", "europe", "middle_east", "north_africa", "sub_saharan_africa",
  "east_asia", "south_asia", "southeast_asia", "central_asia", "oceania",
];

/* Table format, one country per line:  ISO | region | English terms , … | Arabic terms , …
 * An Arabic term ending in "*" is a demonym stem: «أمريكي*» also matches أمريكية / أمريكيين / أمريكيون.
 * Arabic attached prefixes (و ب ل ك ف ال …) are handled by the matcher, so «الصين» also matches «والصين».
 * Ambiguous words are left out on purpose: bare «عمان» (Amman vs Oman), "Georgia" (US state), "Chad" (name). */
const TABLE = `
US|north_america|united states,u.s.,usa,america,american,americans,washington,white house,pentagon,new york,california,texas,florida,los angeles,chicago|الولايات المتحدة,أمريكا,امريكا,أمريكي*,واشنطن,البيت الأبيض,البنتاغون,نيويورك,كاليفورنيا,تكساس,فلوريدا,لوس أنجلوس,شيكاغو
CA|north_america|canada,canadian,ottawa,toronto,montreal,vancouver|كندا,كندي*,أوتاوا,تورنتو,مونتريال,فانكوفر
MX|north_america|mexico,mexican,mexico city|المكسيك,مكسيكي*
GT|north_america|guatemala,guatemalan|غواتيمالا
HN|north_america|honduras,honduran|هندوراس
SV|north_america|el salvador,salvadoran|السلفادور
NI|north_america|nicaragua,nicaraguan|نيكاراغوا
CR|north_america|costa rica,costa rican|كوستاريكا
PA|north_america|panama,panamanian|بنما
CU|north_america|cuba,cuban,havana|كوبا,كوبي*,هافانا
HT|north_america|haiti,haitian,port-au-prince|هايتي
DO|north_america|dominican republic|جمهورية الدومينيكان,الدومينيكان
JM|north_america|jamaica,jamaican|جامايكا
PR|north_america|puerto rico|بورتوريكو
TT|north_america|trinidad|ترينيداد
BS|north_america|bahamas|جزر البهاما,الباهاما
BR|south_america|brazil,brazilian,brasilia,rio de janeiro,sao paulo,são paulo|البرازيل,برازيلي*,برازيليا,ريو دي جانيرو,ساو باولو
AR|south_america|argentina,argentine,argentinian,buenos aires|الأرجنتين,أرجنتيني*,بوينس آيرس
CL|south_america|chile,chilean,santiago|تشيلي,تشيلي*
CO|south_america|colombia,colombian,bogota,bogotá|كولومبيا,كولومبي*,بوغوتا
PE|south_america|peru,peruvian,lima|بيرو,البيرو
VE|south_america|venezuela,venezuelan,caracas|فنزويلا,فنزويلي*,كاراكاس
EC|south_america|ecuador,ecuadorian,quito|الإكوادور
BO|south_america|bolivia,bolivian,la paz|بوليفيا
PY|south_america|paraguay,paraguayan|باراغواي
UY|south_america|uruguay,uruguayan,montevideo|الأوروغواي,أوروغواي
GY|south_america|guyana|غيانا
SR|south_america|suriname|سورينام
GB|europe|united kingdom,uk,britain,british,england,english channel,scotland,wales,london,downing street|المملكة المتحدة,بريطانيا,بريطاني*,إنجلترا,إنكلترا,اسكتلندا,ويلز,لندن,داونينغ ستريت
IE|europe|ireland,irish,dublin|أيرلندا,إيرلندا,أيرلندي*,دبلن
FR|europe|france,french,paris,elysee,élysée,marseille,lyon|فرنسا,فرنسي*,باريس,الإليزيه,مارسيليا,ليون
DE|europe|germany,german,berlin,munich,frankfurt,hamburg,bundestag|ألمانيا,المانيا,ألماني*,الماني*,برلين,ميونخ,فرانكفورت,هامبورغ,البوندستاغ
IT|europe|italy,italian,rome,milan,naples|إيطاليا,ايطاليا,إيطالي*,روما,ميلانو,نابولي
ES|europe|spain,spanish,madrid,barcelona,catalonia|إسبانيا,اسبانيا,إسباني*,مدريد,برشلونة,كتالونيا
PT|europe|portugal,portuguese,lisbon|البرتغال,برتغالي*,لشبونة
NL|europe|netherlands,dutch,amsterdam,the hague|هولندا,هولندي*,أمستردام,لاهاي
BE|europe|belgium,belgian,brussels|بلجيكا,بلجيكي*,بروكسل
LU|europe|luxembourg|لوكسمبورغ
CH|europe|switzerland,swiss,geneva,zurich,bern|سويسرا,سويسري*,جنيف,زيورخ,برن
AT|europe|austria,austrian,vienna|النمسا,نمساوي*,فيينا
PL|europe|poland,polish,warsaw|بولندا,بولندي*,وارسو
CZ|europe|czech,czechia,prague|التشيك,تشيكي*,براغ
SK|europe|slovakia,slovak,bratislava|سلوفاكيا
HU|europe|hungary,hungarian,budapest|المجر,هنغاريا,مجري*,بودابست
RO|europe|romania,romanian,bucharest|رومانيا,روماني*,بوخارست
BG|europe|bulgaria,bulgarian,sofia|بلغاريا,بلغاري*,صوفيا
GR|europe|greece,greek,athens|اليونان,يوناني*,أثينا
CY|europe|cyprus,cypriot,nicosia|قبرص,قبرصي*,نيقوسيا
MT|europe|malta,maltese|مالطا
SE|europe|sweden,swedish,stockholm|السويد,سويدي*,ستوكهولم
NO|europe|norway,norwegian,oslo|النرويج,نرويجي*,أوسلو
DK|europe|denmark,danish,copenhagen,greenland|الدنمارك,دنماركي*,كوبنهاغن,غرينلاند
FI|europe|finland,finnish,helsinki|فنلندا,فنلندي*,هلسنكي
IS|europe|iceland,icelandic,reykjavik|آيسلندا,ايسلندا
EE|europe|estonia,estonian,tallinn|إستونيا
LV|europe|latvia,latvian,riga|لاتفيا
LT|europe|lithuania,lithuanian,vilnius|ليتوانيا
UA|europe|ukraine,ukrainian,ukrainians,kyiv,kiev,kharkiv,odesa,odessa,zaporizhzhia,donbas,donetsk,luhansk,zelensky,zelenskyy|أوكرانيا,اوكرانيا,أوكراني*,اوكراني*,كييف,خاركيف,أوديسا,زابوريجيا,دونباس,دونيتسك,لوغانسك,زيلينسكي
BY|europe|belarus,belarusian,minsk|بيلاروسيا,بيلاروس,مينسك
MD|europe|moldova,moldovan,chisinau|مولدوفا
RU|europe|russia,russian,russians,moscow,kremlin,putin,st petersburg|روسيا,روسي*,موسكو,الكرملين,بوتين,سان بطرسبرغ
RS|europe|serbia,serbian,belgrade|صربيا,صربي*,بلغراد
HR|europe|croatia,croatian,zagreb|كرواتيا
SI|europe|slovenia,slovenian,ljubljana|سلوفينيا
BA|europe|bosnia,sarajevo|البوسنة,سراييفو
ME|europe|montenegro|الجبل الأسود
MK|europe|north macedonia,skopje|مقدونيا الشمالية,مقدونيا
AL|europe|albania,albanian,tirana|ألبانيا
XK|europe|kosovo,pristina|كوسوفو
GE|europe|tbilisi|جورجيا,تبليسي
AM|europe|armenia,armenian,yerevan|أرمينيا,أرميني*,يريفان
AZ|europe|azerbaijan,azerbaijani,baku|أذربيجان,أذربيجاني*,باكو
VA|europe|vatican,pope|الفاتيكان,البابا
JO|middle_east|jordan,jordanian,amman,aqaba,irbid,zarqa|الأردن,الاردن,أردني*,اردني*,أمانة عمان,العاصمة عمان,العقبة,إربد,اربد,الزرقاء
PS|middle_east|palestine,palestinian,palestinians,gaza,west bank,ramallah,jenin,nablus,hebron,rafah,khan younis,east jerusalem|فلسطين,فلسطيني*,غزة,قطاع غزة,الضفة الغربية,رام الله,جنين,نابلس,الخليل,رفح,خان يونس,طولكرم,القدس الشرقية
IL|middle_east|israel,israeli,israelis,tel aviv,netanyahu,knesset|إسرائيل,اسرائيل,إسرائيلي*,اسرائيلي*,تل أبيب,نتنياهو,الكنيست
LB|middle_east|lebanon,lebanese,beirut,hezbollah|لبنان,لبناني*,بيروت,حزب الله
SY|middle_east|syria,syrian,damascus,aleppo,idlib,homs|سوريا,سورية,سوري*,دمشق,حلب,إدلب,حمص
IQ|middle_east|iraq,iraqi,baghdad,mosul,basra,erbil|العراق,عراقي*,بغداد,الموصل,البصرة,أربيل
IR|middle_east|iran,iranian,tehran,khamenei|إيران,ايران,إيراني*,ايراني*,طهران,خامنئي
SA|middle_east|saudi,saudi arabia,riyadh,jeddah,mecca,medina|السعودية,سعودي*,الرياض,جدة,مكة,المدينة المنورة
AE|middle_east|uae,united arab emirates,emirati,abu dhabi,dubai|الإمارات,الامارات,إماراتي*,اماراتي*,أبوظبي,أبو ظبي,دبي
QA|middle_east|qatar,qatari,doha|قطر,قطري*,الدوحة
KW|middle_east|kuwait,kuwaiti|الكويت,كويتي*
BH|middle_east|bahrain,bahraini,manama|البحرين,بحريني*,المنامة
OM|middle_east|oman,omani,muscat|سلطنة عمان,مسقط
YE|middle_east|yemen,yemeni,sanaa,houthi,houthis,aden|اليمن,يمني*,صنعاء,الحوثي,الحوثيين,الحوثيون,عدن
TR|middle_east|turkey,turkish,türkiye,turkiye,ankara,istanbul,erdogan|تركيا,تركي*,أنقرة,إسطنبول,اسطنبول,أردوغان
EG|north_africa|egypt,egyptian,cairo,alexandria,sinai,suez|مصر,مصري*,القاهرة,الإسكندرية,سيناء,السويس
LY|north_africa|libya,libyan,tripoli,benghazi|ليبيا,ليبي*,بنغازي
TN|north_africa|tunisia,tunisian,tunis|تونس,تونسي*
DZ|north_africa|algeria,algerian,algiers|الجزائر,جزائري*
MA|north_africa|morocco,moroccan,rabat,casablanca|المغرب,مغربي*,الرباط,الدار البيضاء
SD|north_africa|sudan,sudanese,khartoum,darfur,el fasher|السودان,سوداني*,الخرطوم,دارفور,الفاشر
MR|north_africa|mauritania,mauritanian,nouakchott|موريتانيا,موريتاني*,نواكشوط
EH|north_africa|western sahara|الصحراء الغربية
NG|sub_saharan_africa|nigeria,nigerian,abuja,lagos|نيجيريا,نيجيري*,أبوجا,لاغوس
ZA|sub_saharan_africa|south africa,south african,johannesburg,cape town,pretoria,durban|جنوب أفريقيا,جنوب افريقيا,جوهانسبرغ,كيب تاون,بريتوريا,ديربان
KE|sub_saharan_africa|kenya,kenyan,nairobi|كينيا,كيني*,نيروبي
ET|sub_saharan_africa|ethiopia,ethiopian,addis ababa,tigray|إثيوبيا,اثيوبيا,إثيوبي*,أديس أبابا,تيغراي
GH|sub_saharan_africa|ghana,ghanaian,accra|غانا
SN|sub_saharan_africa|senegal,senegalese,dakar|السنغال,سنغالي*,داكار
CI|sub_saharan_africa|ivory coast,côte d'ivoire,cote d'ivoire,abidjan|ساحل العاج,كوت ديفوار
CM|sub_saharan_africa|cameroon,cameroonian,yaounde|الكاميرون
CD|sub_saharan_africa|democratic republic of congo,dr congo,drc,kinshasa,goma|الكونغو الديمقراطية,كينشاسا,غوما
CG|sub_saharan_africa|republic of congo,brazzaville|الكونغو برازافيل,برازافيل
UG|sub_saharan_africa|uganda,ugandan,kampala|أوغندا
TZ|sub_saharan_africa|tanzania,tanzanian,dar es salaam,zanzibar|تنزانيا,زنجبار
RW|sub_saharan_africa|rwanda,rwandan,kigali|رواندا
BI|sub_saharan_africa|burundi|بوروندي
SO|sub_saharan_africa|somalia,somali,mogadishu,al-shabaab|الصومال,صومالي*,مقديشو,الشباب الصومالية
SS|sub_saharan_africa|south sudan,juba|جنوب السودان,جوبا
ER|sub_saharan_africa|eritrea,eritrean,asmara|إريتريا
DJ|sub_saharan_africa|djibouti|جيبوتي
ML|sub_saharan_africa|mali,malian,bamako|جمهورية مالي,باماكو
NE|sub_saharan_africa|niger,niamey|النيجر,نيامي
TD|sub_saharan_africa|n'djamena,chadian|تشاد,نجامينا
BF|sub_saharan_africa|burkina faso,ouagadougou|بوركينا فاسو
GN|sub_saharan_africa|guinea,conakry|غينيا,كوناكري
GW|sub_saharan_africa|guinea-bissau,guinea bissau|غينيا بيساو
GQ|sub_saharan_africa|equatorial guinea|غينيا الاستوائية
SL|sub_saharan_africa|sierra leone,freetown|سيراليون
LR|sub_saharan_africa|liberia,liberian,monrovia|ليبيريا
TG|sub_saharan_africa|togo,lome|توغو
BJ|sub_saharan_africa|benin,cotonou|جمهورية بنين,كوتونو
GA|sub_saharan_africa|gabon,libreville|الغابون
CF|sub_saharan_africa|central african republic,bangui|أفريقيا الوسطى
AO|sub_saharan_africa|angola,angolan,luanda|أنغولا
ZM|sub_saharan_africa|zambia,zambian,lusaka|زامبيا
ZW|sub_saharan_africa|zimbabwe,zimbabwean,harare|زيمبابوي
MZ|sub_saharan_africa|mozambique,maputo|موزمبيق
MW|sub_saharan_africa|malawi,lilongwe|مالاوي
MG|sub_saharan_africa|madagascar,antananarivo|مدغشقر
NA|sub_saharan_africa|namibia,windhoek|ناميبيا
BW|sub_saharan_africa|botswana,gaborone|بوتسوانا
LS|sub_saharan_africa|lesotho|ليسوتو
SZ|sub_saharan_africa|eswatini,swaziland|إسواتيني
MU|sub_saharan_africa|mauritius|موريشيوس
KM|sub_saharan_africa|comoros|جزر القمر
CV|sub_saharan_africa|cape verde,cabo verde|الرأس الأخضر
GM|sub_saharan_africa|gambia,banjul|غامبيا
CN|east_asia|china,chinese,beijing,shanghai,xi jinping,shenzhen,wuhan,xinjiang,tibet|الصين,صيني*,بكين,شنغهاي,شي جين بينغ,شينجيانغ,التبت
JP|east_asia|japan,japanese,tokyo,osaka,fukushima,hokkaido,okinawa|اليابان,ياباني*,طوكيو,أوساكا,فوكوشيما,هوكايدو,أوكيناوا
KR|east_asia|south korea,south korean,seoul,busan|كوريا الجنوبية,سول,بوسان
KP|east_asia|north korea,north korean,pyongyang,kim jong un|كوريا الشمالية,بيونغيانغ,كيم جونغ أون
TW|east_asia|taiwan,taiwanese,taipei|تايوان,تايواني*,تايبيه
HK|east_asia|hong kong|هونغ كونغ,هونغ كونغ
MO|east_asia|macau,macao|ماكاو
MN|east_asia|mongolia,mongolian,ulaanbaatar|منغوليا
IN|south_asia|india,indian,new delhi,delhi,mumbai,kolkata,bengaluru,chennai,kashmir,modi|الهند,هندي*,نيودلهي,دلهي,مومباي,كشمير,مودي
PK|south_asia|pakistan,pakistani,islamabad,karachi,lahore,peshawar|باكستان,باكستاني*,إسلام آباد,كراتشي,لاهور,بيشاور
BD|south_asia|bangladesh,bangladeshi,dhaka|بنغلاديش,دكا
LK|south_asia|sri lanka,sri lankan,colombo|سريلانكا,كولومبو
NP|south_asia|nepal,nepalese,nepali,kathmandu|نيبال,كاتماندو
BT|south_asia|bhutan|بوتان
MV|south_asia|maldives|جزر المالديف,المالديف
AF|south_asia|afghanistan,afghan,kabul,kandahar,taliban|أفغانستان,افغانستان,أفغاني*,كابل,قندهار,طالبان
ID|southeast_asia|indonesia,indonesian,jakarta,sumatra,bali|إندونيسيا,اندونيسيا,إندونيسي*,جاكرتا,جاوة,سومطرة,جزيرة بالي
MY|southeast_asia|malaysia,malaysian,kuala lumpur|ماليزيا,ماليزي*,كوالالمبور
SG|southeast_asia|singapore,singaporean|سنغافورة
TH|southeast_asia|thailand,thai,bangkok|تايلاند,تايلندي*,بانكوك
VN|southeast_asia|vietnam,viet nam,vietnamese,hanoi,ho chi minh|فيتنام,فيتنامي*,هانوي
PH|southeast_asia|philippines,philippine,filipino,manila,mindanao|الفلبين,فلبيني*,مانيلا,مينداناو
MM|southeast_asia|myanmar,burma,burmese,yangon,naypyitaw,rohingya|ميانمار,بورما,يانغون,الروهينغا
KH|southeast_asia|cambodia,cambodian,phnom penh|كمبوديا
LA|southeast_asia|laos,lao,vientiane|لاوس
BN|southeast_asia|brunei|بروناي
TL|southeast_asia|east timor,timor-leste,timor leste|تيمور الشرقية
KZ|central_asia|kazakhstan,kazakh,astana,almaty|كازاخستان,أستانا,ألماتي
UZ|central_asia|uzbekistan,uzbek,tashkent,samarkand|أوزبكستان,طشقند,سمرقند
TM|central_asia|turkmenistan,ashgabat|تركمانستان,عشق آباد
KG|central_asia|kyrgyzstan,kyrgyz,bishkek|قيرغيزستان,بيشكك
TJ|central_asia|tajikistan,tajik,dushanbe|طاجيكستان,دوشنبه
AU|oceania|australia,australian,canberra,sydney,melbourne,brisbane,perth|أستراليا,استراليا,أسترالي*,كانبيرا,سيدني,ملبورن
NZ|oceania|new zealand,wellington,auckland|نيوزيلندا,ويلينغتون,أوكلاند
PG|oceania|papua new guinea,port moresby|بابوا غينيا الجديدة
FJ|oceania|fiji|فيجي
SB|oceania|solomon islands|جزر سليمان
VU|oceania|vanuatu|فانواتو
WS|oceania|samoa|ساموا
TO|oceania|tonga|تونغا
`;

export interface Country { iso: string; region: Region; en: string[]; ar: string[] }
interface Term { iso: string; term: string; weight: number }

/** Adjectives ("Russian", «روسي») say less about WHERE something happened than place names ("Kyiv"),
 *  so they weigh 1 and place names 2: "Russian missile strike on Kyiv" is about Ukraine. */
const EN_DEMONYM = /(?:ans?|ians?|ese|ish|is|i)$/;
const TERMS: Term[] = [];

export const COUNTRIES: Country[] = TABLE.trim().split("\n").map((line) => {
  const [iso, region, en, ar] = line.split("|");
  const enTerms = en.split(",").map((s) => s.trim()).filter(Boolean);
  enTerms.forEach((t, i) => TERMS.push({ iso, term: normalizeArabic(t), weight: i > 0 && t.length >= 5 && !t.includes(" ") && EN_DEMONYM.test(t) ? 1 : 2 }));
  const arTerms: string[] = [];
  for (const raw of (ar || "").split(",").map((s) => s.trim()).filter(Boolean)) {
    if (raw.endsWith("*")) {
      const b = raw.slice(0, -1);
      for (const f of [b, b + "ة", b + "ين", b + "ون"]) { arTerms.push(f); TERMS.push({ iso, term: normalizeArabic(f), weight: 1 }); }
    } else { arTerms.push(raw); TERMS.push({ iso, term: normalizeArabic(raw), weight: 2 }); }
  }
  return { iso, region: region as Region, en: enTerms, ar: arTerms };
});

export const COUNTRY_BY_ISO = new Map(COUNTRIES.map((c) => [c.iso, c]));

export function regionOf(iso: string | null | undefined): Region | null {
  return (iso && COUNTRY_BY_ISO.get(iso)?.region) || null;
}

// One pattern per term, longest first, so "south sudan" / "guinea-bissau" win over "sudan" / "guinea".
const PATTERNS = TERMS.filter((p) => p.term.length >= 2).sort((a, b) => b.term.length - a.term.length)
  .map(({ iso, term, weight }) => ({ iso, weight, re: new RegExp(`(^|\\s)${termPattern(term)}(?=\\s|$)`, "g") }));

/** Countries mentioned in a text, most-mentioned first (ties: first mention first). */
export function detectCountries(text: string): string[] {
  let s = " " + normalizeArabic(text) + " ";
  const hits = new Map<string, { n: number; pos: number }>();
  for (const { iso, re, weight } of PATTERNS) {
    re.lastIndex = 0;
    if (!re.test(s)) continue;
    re.lastIndex = 0;
    s = s.replace(re, (m: string, lead: string, offset: number) => {
      const h = hits.get(iso) ?? { n: 0, pos: offset };
      h.n += weight; h.pos = Math.min(h.pos, offset);
      hits.set(iso, h);
      return lead + " ".repeat(m.length - lead.length); // blank it out, keep positions
    });
  }
  return [...hits.entries()].sort((a, b) => b[1].n - a[1].n || a[1].pos - b[1].pos).map(([iso]) => iso);
}

/** Headline countries first (they say what the story is about), then the excerpt's. Capped at 5. */
export function articleCountries(title: string, excerpt: string, sourceCountry?: string | null): string[] {
  const out = detectCountries(title);
  for (const c of detectCountries(excerpt.slice(0, 400))) if (!out.includes(c)) out.push(c);
  // A national outlet's untagged local story ("Parliament passes budget") is about its own country.
  // Callers pass sourceCountry only for national outlets, never for international ones (BBC, Al Jazeera…).
  if (!out.length && sourceCountry && COUNTRY_BY_ISO.has(sourceCountry)) out.push(sourceCountry);
  return out.slice(0, 5);
}
