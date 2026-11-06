// Generator orchestration with an in-memory database and a scripted model (no network).
import { assert, assertEquals } from "../../news-ingest/tests/assert.ts";
import { Candidate, ModelRateLimited, planJob, runStories, StoryDb, StorySettings, Target } from "../lib/run.ts";
import type { MaterialRow } from "../lib/compose.ts";
import { goodEnglishDraft, quakeMaterial } from "./fixtures.ts";

const NOW = new Date("2026-11-06T10:30:00Z");

const arabicDraft = {
  title: "زلزال قوي قبالة شمال اليابان يدفع لتحذير من تسونامي",
  dek: "ضرب زلزال بقوة 7.4 درجات المنطقة الواقعة قبالة محافظة أوموري، وحذرت السلطات من أمواج على الساحل.",
  sections: [{ key: "event", paras: [
    { t: "بحسب وكالة الأرصاد الجوية اليابانية، وقع الزلزال الذي بلغت قوته 7.4 درجات على عمق نحو 40 كيلومتراً في البحر قبالة أوموري.", k: "fact", r: [2, 3] },
    { t: "ودعت الوكالة سكان أوموري وإيواتي إلى التوجه نحو المرتفعات، متوقعة أمواجاً قد يصل ارتفاعها إلى متر واحد.", k: "statement", r: [1] },
    { t: "ونقلت سكاي نيوز عربية عن وسائل إعلام محلية سقوط قتيلين و15 جريحاً، دون تأكيد رسمي للحصيلة.", k: "developing", r: [5] },
  ] }],
  timeline: [],
};

class FakeDb implements StoryDb {
  st: StorySettings = { enabled: true, languages: ["ar", "en"], maxEvents: 2, thresholds: { minReports: 3, minPublishers: 2, minChars: 600 } };
  cands: Candidate[] = [];
  mat = new Map<number, MaterialRow[]>();
  budget = 10;
  refunded = 0;
  backoff = 0;
  saved: Record<string, unknown>[] = [];
  attempts: Record<string, unknown>[] = [];
  targets = new Map<number, Target>();
  async settings() { return this.st; }
  async candidates() { return this.cands; }
  async material(c: number) { return this.mat.get(c) ?? []; }
  async target(id: number) { return this.targets.get(id) ?? null; }
  async aiTake(n: number) { const g = Math.min(n, this.budget); this.budget -= g; return g; }
  async aiRefund(n: number) { this.refunded += n; }
  async aiBackoff(m: number) { this.backoff = m; }
  async saveDraft(p: Record<string, unknown>) { this.saved.push(p); return 500 + this.saved.length; }
  async logAttempt(p: Record<string, unknown>) { this.attempts.push(p); }
}

function cand(extra: Partial<Candidate> = {}): Candidate {
  return { event_key: "c9", cluster_id: 9, lead_article_id: 101, score: 80, report_count: 5, publisher_count: 5, independent_count: 5,
    countries: ["JP"], region: "east_asia", event_type: "earthquake", allegation: false, stories: [], last_attempts: {}, ...extra };
}

function scripted(): { calls: string[]; model: (s: string, u: string) => Promise<string> } {
  const calls: string[] = [];
  return { calls, model: async (s: string) => { calls.push(s.includes("Arabic") ? "ar" : "en"); return JSON.stringify(s.includes("Arabic") ? arabicDraft : goodEnglishDraft()); } };
}

Deno.test("run: does nothing while story_enabled is off or AI is not configured", async () => {
  const db = new FakeDb(); db.st.enabled = false; db.cands = [cand()]; db.mat.set(9, quakeMaterial());
  const m = scripted();
  const r = await runStories({ db, model: m.model, modelName: "test", now: () => NOW });
  assertEquals([r.jobs, m.calls.length, db.saved.length], [0, 0, 0]);
  db.st.enabled = true;
  const r2 = await runStories({ db, model: null, modelName: "test", now: () => NOW });
  assertEquals(r2.jobs, 0);
  assert(r2.details[0].includes("not configured"));
});

Deno.test("run: writes linked Arabic and English DRAFTS for a qualifying event — never a published story", async () => {
  const db = new FakeDb(); db.cands = [cand()]; db.mat.set(9, quakeMaterial());
  const m = scripted();
  const r = await runStories({ db, model: m.model, modelName: "test-model", now: () => NOW });
  assertEquals(r.drafted, 2, JSON.stringify(r));
  assertEquals(db.saved.map((s) => s.language), ["ar", "en"]);
  for (const s of db.saved) {
    assertEquals(s.mode, "new");
    assert(!("status" in s), "the generator never sets a status");
    assertEquals(s.cluster_id, 9);
    assert((s.sources as unknown[]).length >= 3);
    assertEquals(s.hero_image_credit !== null, true);
  }
  assertEquals((db.saved[1].sources as { publisher_name: string }[])[0].publisher_name, "BBC News");
  assertEquals((db.saved[0].sources as { publisher_name: string }[]).some((x) => x.publisher_name === "بي بي سي"), true);
  assertEquals(db.attempts.map((a) => a.outcome), ["drafted", "drafted"]);
  assertEquals(r.ai_calls, 2);
});

Deno.test("run: thin material is logged as insufficient without spending AI budget", async () => {
  const db = new FakeDb(); db.cands = [cand()]; db.mat.set(9, quakeMaterial().slice(0, 2));
  const m = scripted();
  const r = await runStories({ db, model: m.model, modelName: "t", now: () => NOW });
  assertEquals([r.insufficient, m.calls.length, db.budget], [2, 0, 10]);
  assert(String(db.attempts[0].reason).includes("usable reports"));
});

Deno.test("run: stops at the daily/monthly limit", async () => {
  const db = new FakeDb(); db.cands = [cand()]; db.mat.set(9, quakeMaterial()); db.budget = 1;
  const m = scripted();
  const r = await runStories({ db, model: m.model, modelName: "t", now: () => NOW });
  assertEquals([m.calls.length, r.no_budget, db.saved.length], [1, true, 1]);
  assertEquals(db.attempts.at(-1)!.outcome, "no_budget");
});

Deno.test("run: provider 429 refunds the request, pauses AI and stops the run", async () => {
  const db = new FakeDb(); db.cands = [cand(), cand({ event_key: "c10", cluster_id: 10 })]; db.mat.set(9, quakeMaterial()); db.mat.set(10, quakeMaterial());
  let n = 0;
  const r = await runStories({ db, model: async () => { n++; throw new ModelRateLimited("429"); }, modelName: "t", now: () => NOW });
  assertEquals([n, db.refunded, db.backoff, r.errors, db.saved.length], [1, 1, 15, 1, 0]);
});

Deno.test("run: a draft the validator rejects is not saved", async () => {
  const db = new FakeDb(); db.cands = [cand()]; db.mat.set(9, quakeMaterial()); db.st.languages = ["en"];
  const bad = goodEnglishDraft();
  bad.sections[0].paras.forEach((p) => (p.t += " Officials said 312 buildings collapsed."));
  const r = await runStories({ db, model: async () => JSON.stringify(bad), modelName: "t", now: () => NOW });
  assertEquals([r.rejected, db.saved.length], [1, 0]);
  assertEquals(db.attempts[0].outcome, "rejected_output");
  assert(String(db.attempts[0].reason).includes("number_not_in_sources:312"));
});

Deno.test("plan: unchanged events are not retried; drafts refresh with 2+ new reports; approved stories get proposed updates", () => {
  const ids = [1, 2, 3, 4, 5];
  const failed = cand({ last_attempts: { en: { outcome: "insufficient", report_count: 5, created_at: "2026-11-06T09:00:00Z" } } });
  assert("skip" in planJob(failed, "en", ids, NOW));
  assertEquals((planJob(failed, "en", [...ids, 6], NOW) as { mode: string }).mode, "new");
  assertEquals((planJob(failed, "en", ids, NOW, true) as { mode: string }).mode, "new");
  const story = (status: string, article_ids: number[], has_pending = false) =>
    cand({ stories: [{ id: 7, language: "en", status, event_id: "e", source_count: 3, has_pending, article_ids }] });
  assert("skip" in planJob(story("draft", [1, 2, 3, 4]), "en", ids, NOW));
  assertEquals((planJob(story("draft", [1, 2, 3]), "en", ids, NOW) as { mode: string }).mode, "redraft");
  assertEquals((planJob(story("published", [1, 2, 3]), "en", ids, NOW) as { mode: string }).mode, "propose");
  assert("skip" in planJob(story("published", [1, 2, 3], true), "en", ids, NOW));
  assert("skip" in planJob(story("rejected", []), "en", ids, NOW, true));
  assertEquals((planJob(story("published", [1, 2, 3]), "ar", ids, NOW) as { mode: string }).mode, "new");
});

Deno.test("run: an editor's 'refresh this story' request proposes an update for a published story", async () => {
  const db = new FakeDb(); db.st.enabled = false; db.mat.set(9, quakeMaterial());
  db.targets.set(7, { id: 7, cluster_id: 9, event_key: "c9", language: "en", status: "published", has_pending: false, countries: ["JP"], region: "east_asia", article_ids: [101] });
  const r = await runStories({ db, model: scripted().model, modelName: "t", now: () => NOW }, { kind: "story", story_id: 7 });
  assertEquals([r.proposed, db.saved[0].mode, db.saved[0].story_id], [1, "propose", 7]);
});

Deno.test("run: respects the per-run event limit", async () => {
  const db = new FakeDb(); db.st.maxEvents = 1; db.st.languages = ["en"];
  db.cands = [cand(), cand({ event_key: "c10", cluster_id: 10 })]; db.mat.set(9, quakeMaterial()); db.mat.set(10, quakeMaterial());
  const r = await runStories({ db, model: scripted().model, modelName: "t", now: () => NOW });
  assertEquals([r.drafted, db.saved[0].cluster_id], [1, 9]);
});
