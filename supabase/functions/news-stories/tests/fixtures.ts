// Test material: one event (an earthquake off northern Japan) as stored by the ingest pipeline.
// Invented test data in the shape of real feed items; not real reporting.
import type { MaterialRow } from "../lib/compose.ts";

let id = 100;
export function row(extra: Partial<MaterialRow>): MaterialRow {
  id++;
  return {
    article_id: id, source_id: id, publisher: "pub" + id, source_name_ar: "مصدر " + id, source_name_en: "Source " + id, source_kind: "media",
    reliability: 4, license: null, url: `https://news${id}.example/story`, title: "headline", title_original: null, title_en: null,
    summary: null, summary_kind: "feed", language: "en", translated: false, verification: "reported",
    published_at: "2026-11-06T09:00:00Z", image_url: null, allow_images: false, wire: null, category: "world", countries: ["JP"], region: "east_asia",
    ...extra,
  };
}

export function quakeMaterial(): MaterialRow[] {
  id = 100;
  return [
    row({ publisher: "bbc", source_name_ar: "بي بي سي", source_name_en: "BBC News", reliability: 5, language: "en",
      title: "Magnitude 7.4 earthquake strikes off northern Japan", title_en: "Magnitude 7.4 earthquake strikes off northern Japan",
      summary: "The quake struck at a depth of 40km off Aomori prefecture, the Japan Meteorological Agency said. A tsunami warning for waves of up to one metre was issued for the Pacific coast.",
      published_at: "2026-11-06T09:12:00Z", image_url: "https://img.example/quake.jpg", allow_images: true }),
    row({ publisher: "jma", source_name_ar: "وكالة الأرصاد اليابانية", source_name_en: "Japan Meteorological Agency", source_kind: "official", reliability: 5, language: "en",
      title: "Tsunami warning issued for Aomori and Iwate coasts", title_en: "Tsunami warning issued for Aomori and Iwate coasts",
      summary: "Waves of up to 1 metre are expected along the coasts of Aomori and Iwate. Residents should move to higher ground immediately and stay away from the shore.",
      verification: "official", published_at: "2026-11-06T09:05:00Z" }),
    row({ publisher: "aljazeera", source_name_ar: "الجزيرة", source_name_en: "Al Jazeera", reliability: 4, language: "ar",
      title: "زلزال بقوة 7.4 درجات يضرب شمال اليابان",
      summary: "قالت وكالة الأرصاد الجوية اليابانية إن الزلزال وقع على عمق 40 كيلومتراً قبالة محافظة أوموري، وأصدرت تحذيراً من موجات تسونامي على الساحل الشرقي.",
      published_at: "2026-11-06T09:20:00Z" }),
    row({ publisher: "skynews-ar", source_name_ar: "سكاي نيوز عربية", source_name_en: "Sky News Arabia", reliability: 3, language: "ar",
      title: "أنباء عن مقتل شخصين في زلزال اليابان",
      summary: "أفادت وسائل إعلام محلية بمقتل شخصين وإصابة 15 آخرين في محافظة أوموري، فيما لم تؤكد السلطات اليابانية الحصيلة حتى الآن.",
      verification: "developing", published_at: "2026-11-06T10:02:00Z" }),
    row({ publisher: "nhk", source_name_ar: "إن إتش كيه", source_name_en: "NHK World", reliability: 4, language: "en",
      title: "Nuclear plant operator reports no abnormalities after quake", title_en: "Nuclear plant operator reports no abnormalities after quake",
      summary: "Tohoku Electric Power said no abnormalities had been found at the Higashidori nuclear power plant. Prime Minister's office set up a liaison office, Chief Cabinet Secretary Hayashi said.",
      published_at: "2026-11-06T09:40:00Z" }),
  ];
}

/** A well-behaved English draft citing the material above by number (refs are numbered by publication time). */
// Refs after selectRefs (sorted by published_at): 1 JMA 09:05, 2 BBC 09:12, 3 Al Jazeera 09:20, 4 NHK 09:40, 5 Sky 10:02
export function goodEnglishDraft() {
  return {
    title: "Strong quake off northern Japan prompts tsunami warning",
    dek: "A magnitude 7.4 earthquake struck off Aomori prefecture on Friday, and Japanese authorities warned of tsunami waves along the Pacific coast.",
    sections: [
      { key: "event", paras: [
        { t: "An earthquake with a magnitude of 7.4 struck off northern Japan, centred off Aomori prefecture at a depth of about 40km, according to Japan's weather agency.", k: "fact", r: [2, 3] },
        { t: "The agency told residents of Aomori and Iwate to head for higher ground, saying waves as high as 1 metre could reach the shore.", k: "statement", r: [1] },
        { t: "Local media reported that two people were killed and 15 injured in Aomori, though officials have not confirmed those figures.", k: "fact", r: [5] },
      ] },
      { key: "statements", paras: [
        { t: "Tohoku Electric Power said it had found no abnormalities at the Higashidori nuclear power plant.", k: "statement", r: [4] },
      ] },
      { key: "analysis", paras: [
        { t: "The early reports differ mainly on casualties, which only one outlet has reported so far.", k: "analysis", r: [] },
      ] },
    ],
    timeline: [
      { t: "Weather agency issues a tsunami warning for Aomori and Iwate", r: [1], at: "1999-01-01T00:00:00Z" },
      { t: "First reports of a 7.4 magnitude quake off northern Japan", r: [2] },
      { t: "Local media report two deaths, unconfirmed by officials", r: [5] },
    ],
  };
}
