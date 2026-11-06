# Full original articles («تقارير كاملة») — design, safeguards and deployment

Status: **deployed 2026-11-06, writer switched OFF** (`story_enabled = false`). Merged in PR #1 (`e59093e`);
migration applied; Edge Function `news-stories` v1 live. Nothing is written until an editor switches the writer on.

## What it does
For important events (already ranked by `news_global_events`), an optional generator writes an **original**
article in Arabic and/or English: headline, introduction, what happened, background, official statements,
reactions, impact, what happens next, where sources differ, editorial analysis, a timeline and numbered source
references. Every paragraph carries a label and cites its sources. The Arabic and English versions of one event
share an `event_id` and link to each other.

**The generator only writes drafts.** An editor reviews, edits, approves, publishes now or schedules. This is
enforced by database triggers and functions — even the service role cannot insert a published story.

## Where the facts come from (and the honest limit)
The only material is what the site already stores lawfully for each event: publisher headlines and the short
excerpts publishers put in their own RSS feeds (`allow_excerpt`), from 2+ independent publishers. No article
pages are fetched, no paywall or anti-bot measure is touched, nothing is copied.

Live data on 2026-11-06: excerpts average ~209 characters, and only a few of the ~60 ranked events have 3+
reports from 2+ independent publishers at any moment. So expect **a handful of well-sourced articles per day of
roughly 250–600 words**, not long features on every story. When the material is thin the generator writes nothing
(logged as `insufficient`) — that is deliberate. Longer articles need richer *licensed* material (e.g. an agency
subscription or official press releases whose terms allow reuse); the `license` column on sources records such terms.

## Safeguards (code: `supabase/functions/news-stories/lib/compose.ts`, tests: `tests/compose_test.ts`)
| Rule | Enforcement |
|---|---|
| Enough material | ≥ 3 reports, ≥ 2 independent publishers (wire copies count once), ≥ 600 chars, ≥ 1 reliable/official source, not all allegations — otherwise no AI call |
| Every claim traceable | each non-analysis paragraph must cite existing source numbers; DB refuses bodies citing unknown sources |
| No invented numbers/dates | every number must appear in the **cited** reports (or their publication year) |
| No invented quotes | quotes must be verbatim in an untranslated source text, ≤ 25 words; translated quotes rejected |
| No invented names (English) | capitalised names must occur in the material; Arabic/translated names are flagged for the editor |
| No copying | any run of 8+ consecutive words shared with a source (outside a short quote) drops the paragraph |
| Labels never upgraded | citing an allegation → "unverified claim"; a "fact" needs 2 independent publishers or an official body, else "developing" |
| Analysis separated | analysis only in its own section, no quotes, no new numbers |
| Disagreement | model must describe it in a "where sources differ" section |
| Timeline times | computed from the cited reports' publication times, never taken from the model |
| Bad drafts discarded | > 40 % of paragraphs rejected, < 3 sourced paragraphs, or a single publisher → nothing saved |
| Images | only a thumbnail the publisher put in its feed, from a source with `allow_images`, always credited |
| Nothing auto-"confirmed" | consistent with the rest of the site; human approval is the confirmation step |

Validator warnings (low overlap, transliterated names, cross-language sources, headline identical to a source)
must be ticked as checked before approval (`p_ack_warnings`).

## Editorial workflow (database functions, all re-check `news_is_admin()`)
`draft → approved → scheduled/published`, plus `rejected`, `unpublished`, `to_draft`.
* `news_story_save` — edit title, intro, body, category, countries, image (+ required credit), byline.
  Editing a **published** story requires a change kind: `minor` (no note) or `correction` / `update` /
  `clarification` (public note, "Updated" time stamped).
* `news_story_transition` — approve, publish, schedule (1 min–30 days), reject (reason), unpublish (reason),
  apply/discard a proposed update.
* Proposed updates: when 2+ new reports arrive for an approved/published story, the generator stores a
  *pending* version beside the live text; readers never see it until an editor applies it.
* `news_story_revisions` keeps every version (who/what/when); `news_story_corrections` keeps the public log.
* Scheduled publication: pg_cron `news-stories-publish` every minute (and RLS shows a due story immediately).

## Database (migration `20261106000024_full_articles.sql`, additive only)
New: `news_stories`, `news_story_sources`, `news_story_corrections`, `news_story_revisions`, `news_story_attempts`;
columns `news_sources.license/license_url`, `news_ai_usage.story_calls`; settings listed below.
Changed: `news_ai_take()` gains the optional monthly cap (identical behaviour below the cap).
Untouched: all existing articles, clusters, events, grants, the CV Pro tables. Source references keep URL/title/
publisher, so stories survive the 30-day report retention.

RLS: readers get published stories and only public columns; drafts, validator output, approver identity,
pending updates and internal notes are editor-only (admin RPCs). No direct UPDATE/DELETE grants.

## Settings (admin → الإعدادات)
| key | default | meaning |
|---|---|---|
| `story_enabled` | `false` | generator on/off (scheduled job does nothing while off) |
| `story_ai_daily_limit` / `story_ai_monthly_limit` | 40 / 600 | requests for articles (also count against the general caps) |
| `ai_monthly_limit` | 30000 | **new** monthly cap on all AI use (`null` = none); current use ≈ 18 000/month |
| `story_languages` | `["ar","en"]` | versions to write |
| `story_min_score` / `story_min_reports` / `story_min_publishers` / `story_min_material_chars` | 55 / 3 / 2 / 600 | eligibility |
| `story_max_events_per_run` | 2 | per 10-minute run (Edge wall-clock limit) |

Cost: one request per article version (~3–5k input tokens, ≤ 3.5k output). With the current Gemini key on the free
tier the requests share the existing daily quota; with a paid key the default caps bound spend.

## Deployment (done 2026-11-06)
1. PR #1 merged into `main` (`e59093e`); GitHub Pages serves the new article page and admin tab.
2. Migration `20261106000024_full_articles.sql` applied to `ghxnmnydeuvnrsulywbj`; ingestion verified healthy afterwards.
3. Edge Function `news-stories` v1 deployed (JWT verification off; it checks the Vault token or an editor JWT),
   entrypoint importing `lib/` from GitHub pinned to `e59093ee4d8ae8b9f4cecbbb9d0b3697c0f37d22`.
   Smoke test: scheduler call → 200 `story_enabled = false`, no AI use; anonymous call → 401.
   `news-ingest` was not redeployed (its only change, exporting `callModel`, does not affect it).
4. Next (editor): admin → التقارير الكاملة → tick «تشغيل الكاتب الآلي», then «اكتب الآن» or wait for the
   10-minute run, and review the drafts. The button needs the writer switched on, because the AI budget
   (`news_story_ai_take`) is zero while it is off. Switched on, it still only writes drafts.

Rollback: set `story_enabled = false`; unpublish stories; the tables can be dropped without affecting the rest.
