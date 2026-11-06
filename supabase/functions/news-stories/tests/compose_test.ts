// Full-article validator: sourcing, numbers, quotations, copying, labels, sufficiency.
import { assert, assertEquals } from "../../news-ingest/tests/assert.ts";
import {
  checkSufficiency, copiedRun, extractJson, heroImage, nameCandidates, quotesIn, selectRefs, shingles, systemPrompt, userPrompt, validateDraft,
} from "../lib/compose.ts";
import { goodEnglishDraft, quakeMaterial, row } from "./fixtures.ts";

const refsEn = () => selectRefs(quakeMaterial(), "en");
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

Deno.test("refs: numbered by publication time, one entry per stored report, local publisher names", () => {
  const refs = refsEn();
  assertEquals(refs.map((r) => r.row.publisher), ["jma", "bbc", "aljazeera", "nhk", "skynews-ar"]);
  assertEquals(refs.map((r) => r.n), [1, 2, 3, 4, 5]);
  assertEquals(selectRefs(quakeMaterial(), "ar")[1].name, "بي بي سي");
  assertEquals(refs[1].name, "BBC News");
});

Deno.test("refs: at most 4 per publisher, 16 in total, publishers interleaved", () => {
  const many = Array.from({ length: 30 }, (_, i) => row({ publisher: i < 20 ? "big" : "p" + i, title: "t" + i }));
  const refs = selectRefs(many, "en");
  assertEquals(refs.length, 14);
  assertEquals(refs.filter((r) => r.row.publisher === "big").length, 4);
});

Deno.test("refs: wire copies (same agency text in two outlets) count as one independent source", () => {
  const rows = [row({ publisher: "a", wire: "reuters", reliability: 5 }), row({ publisher: "b", wire: "reuters" }), row({ publisher: "c" })];
  const refs = selectRefs(rows, "en");
  assertEquals(new Set(refs.map((r) => r.independent)).size, 2);
});

Deno.test("sufficiency: refuses thin material instead of writing an article", () => {
  const all = refsEn();
  assert(checkSufficiency(all).ok, "five reports from five publishers is enough");
  assertEquals(checkSufficiency(all.slice(0, 2)).ok, false);
  const onePub = selectRefs(quakeMaterial().map((r) => ({ ...r, publisher: "same" })), "en");
  assert(checkSufficiency(onePub).reason.includes("independent publishers"));
  const short = selectRefs(quakeMaterial().map((r) => ({ ...r, summary: null })), "en");
  assert(checkSufficiency(short).reason.includes("characters"), checkSufficiency(short).reason);
  const weak = selectRefs(quakeMaterial().map((r) => ({ ...r, reliability: 3, source_kind: "media" as const })), "en");
  assert(checkSufficiency(weak).reason.includes("reliable"));
  const claims = selectRefs(quakeMaterial().map((r) => ({ ...r, verification: "allegation" })), "en");
  assert(checkSufficiency(claims).reason.includes("allegation"));
});

Deno.test("prompt: lists every reference with publisher, label and time; forbids outside facts", () => {
  const u = userPrompt(refsEn(), "en", { countries: ["JP"], now: new Date("2026-11-06T10:30:00Z") });
  assert(u.includes("[1] Japan Meteorological Agency (official body; official body; published 2026-11-06T09:05:00Z)"));
  assert(u.includes("[5] Sky News Arabia (news outlet; developing;"));
  const s = systemPrompt("ar");
  assert(s.includes("Modern Standard Arabic") && s.includes("ONLY knowledge") && s.includes("insufficient"));
});

Deno.test("validator: a well-sourced draft is kept, with labels corrected and sources renumbered", () => {
  const out = validateDraft(goodEnglishDraft(), refsEn(), "en");
  assert(out.ok, out.reason + JSON.stringify(out.rejected));
  assertEquals(out.rejected, []);
  const event = out.body.sections.find((s) => s.key === "event")!;
  assertEquals(event.paras.length, 3);
  // only Sky News Arabia reports casualties → a single-source "fact" becomes "developing"
  assertEquals(event.paras[2].k, "developing");
  assert(out.relabelled.some((r) => r.code === "single_source_fact"));
  // sources renumbered in order of first citation: BBC, Al Jazeera, JMA, Sky, NHK
  assertEquals(out.refs.map((r) => r.row.publisher), ["bbc", "aljazeera", "jma", "skynews-ar", "nhk"]);
  assertEquals(event.paras[0].r, [1, 2]);
  assertEquals(out.body.sections.map((s) => s.key), ["event", "statements", "analysis"]);
  assert(out.stats.words > 80, "words counted");
});

Deno.test("validator: timeline times come from the cited reports, never from the model", () => {
  const out = validateDraft(goodEnglishDraft(), refsEn(), "en");
  assertEquals(out.body.timeline.map((e) => e.at), ["2026-11-06T09:05:00.000Z", "2026-11-06T09:12:00.000Z", "2026-11-06T10:02:00.000Z"]);
});

Deno.test("validator: a number that no cited source contains drops the paragraph", () => {
  const d = clone(goodEnglishDraft());
  d.sections[0].paras[1].t = "The agency said waves of up to 3 metres could hit the coast of Aomori and Iwate.";
  const out = validateDraft(d, refsEn(), "en");
  assert(out.rejected.some((r) => r.where === "event#2" && r.code === "number_not_in_sources:3"), JSON.stringify(out.rejected));
});

Deno.test("validator: numbers must come from the CITED reports, not just any report", () => {
  const d = clone(goodEnglishDraft());
  d.sections[0].paras[1] = { t: "The agency said 15 people were hurt in Aomori and Iwate.", k: "statement", r: [1] };
  const out = validateDraft(d, refsEn(), "en");
  assert(out.rejected.some((r) => r.code === "number_not_in_sources:15"));
});

Deno.test("validator: invented quotations are dropped, verbatim short ones are kept", () => {
  const d = clone(goodEnglishDraft());
  d.sections[1].paras.push({ t: "The agency urged people to \"leave the coast at once\" in Aomori.", k: "statement", r: [1] });
  d.sections[1].paras.push({ t: "Residents were told to \"move to higher ground immediately\", the agency said.", k: "statement", r: [1] });
  const out = validateDraft(d, refsEn(), "en");
  assert(out.rejected.some((r) => r.code === "quote_not_verbatim_in_sources"));
  assert(out.body.sections.find((s) => s.key === "statements")!.paras.some((p) => p.t.includes("move to higher ground immediately")));
});

Deno.test("validator: a quotation from a machine translation is not accepted as a quote", () => {
  const rows = quakeMaterial();
  rows[3] = { ...rows[3], translated: true, title_original: "Two killed in Japan quake", language: "ar" };
  const refs = selectRefs(rows, "en");
  const d = clone(goodEnglishDraft());
  d.sections[0].paras.push({ t: "Local media said \"لم تؤكد السلطات\" the toll.", k: "developing", r: [5] });
  const out = validateDraft(d, refs, "en");
  assert(out.rejected.some((r) => r.code === "quote_not_verbatim_in_sources" || r.code === "wrong_language"));
});

Deno.test("validator: copying 8+ consecutive words from a source drops the paragraph", () => {
  const d = clone(goodEnglishDraft());
  d.sections[0].paras[1].t = "Residents should move to higher ground immediately and stay away from the shore, officials in Aomori said.";
  const out = validateDraft(d, refsEn(), "en");
  assert(out.rejected.some((r) => r.where === "event#2" && r.code.startsWith("copied_from_source")), JSON.stringify(out.rejected));
});

Deno.test("validator: a name the reports never mention is rejected (English sources)", () => {
  const d = clone(goodEnglishDraft());
  d.sections[1].paras.push({ t: "Defence Minister Takeshi Moriyama said troops were sent to Aomori.", k: "statement", r: [4] });
  const out = validateDraft(d, refsEn(), "en");
  assert(out.rejected.some((r) => r.code.startsWith("name_not_in_sources")), JSON.stringify(out.rejected));
  assertEquals(nameCandidates("Japan's agency said Hayashi met Netanyahu."), ["Hayashi", "Netanyahu"]);
});

Deno.test("validator: a claim citing an allegation is labelled an allegation", () => {
  const rows = quakeMaterial();
  rows[3] = { ...rows[3], verification: "allegation" };
  const out = validateDraft(goodEnglishDraft(), selectRefs(rows, "en"), "en");
  assert(out.ok);
  assertEquals(out.body.sections[0].paras[2].k, "allegation");
});

Deno.test("validator: analysis stays in the analysis section and carries no quotes or new numbers", () => {
  const d = clone(goodEnglishDraft());
  d.sections[0].paras.push({ t: "This is probably the worst quake in years.", k: "analysis", r: [] });
  d.sections[2].paras.push({ t: "Damage could reach 900 homes.", k: "analysis", r: [] });
  const out = validateDraft(d, refsEn(), "en");
  assert(out.rejected.some((r) => r.code === "analysis_outside_analysis"));
  assert(out.rejected.some((r) => r.code === "number_not_in_sources:900"));
});

Deno.test("validator: paragraphs without a valid source, with HTML or untranslated Hebrew are dropped", () => {
  const d = clone(goodEnglishDraft());
  d.sections[0].paras.push({ t: "Trains were halted across the region.", k: "fact", r: [42] });
  d.sections[0].paras.push({ t: "Officials met <script>x</script> in Aomori.", k: "fact", r: [1, 2] });
  d.sections[0].paras.push({ t: "Reports said רעידת אדמה in Aomori.", k: "fact", r: [1, 2] });
  const out = validateDraft(d, refsEn(), "en");
  assert(out.rejected.some((r) => r.code === "no_valid_source"));
  assert(out.rejected.some((r) => r.code === "untranslated_hebrew"));
  assert(!JSON.stringify(out.body).includes("<script"), "markup never survives");
});

Deno.test("validator: too much rejected, too little left, or the model says insufficient → no article", () => {
  const d = clone(goodEnglishDraft());
  d.sections[0].paras = d.sections[0].paras.map((p) => ({ ...p, t: p.t + " At least 99 died." }));
  const bad = validateDraft(d, refsEn(), "en");
  assertEquals(bad.ok, false);
  assert(bad.reason.includes("fact checks"), bad.reason);
  const thin = clone(goodEnglishDraft());
  thin.sections = [thin.sections[0]];
  thin.sections[0].paras = thin.sections[0].paras.slice(0, 1);
  assert(validateDraft(thin, refsEn(), "en").reason.includes("not enough verifiable"));
  assert(validateDraft({ insufficient: true, reason: "one headline only" }, refsEn(), "en").reason.startsWith("model: insufficient"));
  assertEquals(validateDraft(extractJson("not json"), refsEn(), "en").ok, false);
});

Deno.test("validator: a single-publisher article is refused even if every paragraph checks out", () => {
  const d = clone(goodEnglishDraft());
  d.sections = [{ key: "event", paras: [
    { t: "A magnitude 7.4 earthquake struck off northern Japan, the BBC reported.", k: "developing", r: [2] },
    { t: "The quake was centred off Aomori prefecture, according to the BBC.", k: "developing", r: [2] },
    { t: "A tsunami warning was issued for the Pacific coast, the BBC said.", k: "developing", r: [2] },
  ] }];
  d.timeline = [];
  assertEquals(validateDraft(d, refsEn(), "en").reason, "the article relies on a single publisher");
});

Deno.test("validator: wrong output language is rejected", () => {
  const out = validateDraft(goodEnglishDraft(), refsEn(), "ar");
  assertEquals(out.ok, false);
  assert(out.reason.includes("wrong_language"));
});

Deno.test("validator: Arabic draft — Arabic-Indic digits match, cross-language sources flagged for the editor", () => {
  const refs = selectRefs(quakeMaterial(), "ar");
  const d = {
    title: "زلزال قوي قبالة شمال اليابان يدفع لتحذير من تسونامي",
    dek: "ضرب زلزال بقوة ٧٫٤ درجات المنطقة الواقعة قبالة محافظة أوموري، وحذرت السلطات من أمواج على الساحل.",
    sections: [{ key: "event", paras: [
      { t: "بحسب وكالة الأرصاد الجوية اليابانية، وقع الزلزال الذي بلغت قوته 7.4 درجات على عمق نحو 40 كيلومتراً في البحر قبالة أوموري.", k: "fact", r: [2, 3] },
      { t: "ودعت الوكالة سكان أوموري وإيواتي إلى التوجه نحو المرتفعات، متوقعة أمواجاً قد يصل ارتفاعها إلى متر واحد.", k: "statement", r: [1] },
      { t: "ونقلت سكاي نيوز عربية عن وسائل إعلام محلية سقوط قتيلين و15 جريحاً، دون تأكيد رسمي للحصيلة.", k: "developing", r: [5] },
    ] }],
    timeline: [{ t: "تحذير رسمي من تسونامي لساحلي أوموري وإيواتي", r: [1] }],
  };
  const out = validateDraft(d, refs, "ar");
  assert(out.ok, out.reason + JSON.stringify(out.rejected));
  assert(out.warnings.some((w) => w.code === "cross_language"));
});

Deno.test("helpers: quotes, shingles, copy detection, hero image licensing", () => {
  assertEquals(quotesIn("He said «we will rebuild» and \"x\" then “move on now”"), ["we will rebuild", "move on now"]);
  assertEquals(shingles("one two three", 2).size, 2);
  assert(copiedRun("a b c d e f g h i", shingles("x a b c d e f g h y")) !== null);
  assertEquals(copiedRun("said \"a b c d e f g h\" today", shingles("a b c d e f g h")), null);
  const refs = refsEn();
  assertEquals(heroImage(refs)?.url, "https://img.example/quake.jpg");
  assertEquals(heroImage(refs)?.credit, "BBC News");
  assertEquals(heroImage(refs.map((r) => ({ ...r, row: { ...r.row, allow_images: false } }))), null);
});
