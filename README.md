# لحظة — Lahza News

An automated **global** breaking-news site in Arabic and English. A scheduler inside the database collects headlines from
official RSS feeds every minute, classifies and de-duplicates them, groups reports of the same event,
labels how well-sourced each item is, and pushes updates to open browsers, with no server or PC of yours
running.

* **Frontend:** static HTML/CSS/JS on GitHub Pages: RTL, mobile-first, dark mode, live ticker,
  live feed with pause, search, 14 sections, breaking timeline, article page, admin dashboard.
* **Backend:** Supabase Postgres (RLS on every table) + `pg_cron` + Edge Functions (`ingest`, `notify`).
* **Cost:** $0 on free tiers (with limits listed in `guide/SETUP.md`), or about $25/month on Supabase Pro.

| Path | What |
|---|---|
| `supabase/migrations/` | Schema, RLS & grants, functions, seed data, scheduler, sources |
| `supabase/functions/news-ingest/` | Feed fetch → parse → classify → dedupe/cluster → optional AI → insert |
| `supabase/functions/news-notify/` | Admin alerts (Telegram / e-mail) |
| `supabase/functions/news-stories/` | Draft full articles from stored reports, with fact/copy validator |
| `assets/js/` | Site + admin (vanilla ES modules, vendored supabase-js) |
| `tests/` | SQL/RLS tests, UI smoke tests; Deno tests live in `supabase/functions/news-ingest/tests/` |
| `guide/SETUP.md` | Setup, adding sources, rotating keys, backups/restore, costs |

## Global breaking news (2026-11-06)
* Every report is tagged with the countries it is about (ISO codes, Arabic + English gazetteer in
  `lib/geo.ts`), its world region (11 regions), an event type and a **global impact** (0–30, `lib/events.ts`).
* Reports of one event are grouped across outlets **and languages** (an Arabic and an English report of the same quake).
* Every event gets an importance score 0–100 (`lib/rank.ts`): global impact 30 · freshness 25 · source
  credibility 20 · independent coverage 15 · development speed 10. **Location never adds points**: Jordan is
  ranked exactly like every other country (tested: the same event scores identically in Jordan and Brazil).
* Wire copies (Reuters/AP/AFP…) and near-identical syndicated text count as **one** independent source;
  BBC Arabic + BBC World etc. are one publisher (`news_sources.publisher`).
* Breaking = score ≥ 60, not routine, < 6 h old, not only allegations, and 2+ independent publishers — or one
  highly reliable publisher, labelled *single-source report*. Up to 8 at once. *Confirmed* = 3+ independent
  publishers incl. 2 highly reliable (or an editor). *Updated* = new reports in the last 30 min.
* `breaking.html` = Global breaking: ranked events with country, region, time, original source, independent
  publisher count, score (with breakdown) and status; region and country filters (`?region=` / `?country=`
  also work on `index.html`). The ranking is recomputed by every ingest run into `news_global_events`.
* Arabic/English switch (masthead), remembered per browser. English reports are kept in English for the
  English edition; top-ranked English-only events get an Arabic headline from the AI budget first.

## Full original reports (2026-11-06, deployed; writer off until an editor switches it on)
* For important events with 3+ reports from 2+ independent publishers, an optional generator (`news-stories`)
  writes an **original** Arabic and English article from the stored headlines + publisher excerpts only:
  sections, timeline, labelled paragraphs (corroborated / statement / allegation / developing / analysis),
  numbered source references. Invented numbers, quotes or names and copied word runs are removed automatically.
* **Drafts only** — editors approve, edit, schedule, publish, correct (admin → التقارير الكاملة); enforced in the DB.
* `article.html?story=ID`: hero image (licensed feed thumbnail, credited), times, reading time, share/print,
  corrections, SEO + NewsArticle JSON-LD. Details, safeguards and deployment: `guide/FULL_ARTICLES.md`.

## Sports centre (2026-11-07)
* `sports.html`: live scores and fixtures by day (football, basketball, tennis, cricket), league tables, top scorers,
  assists, World Cup bracket, match centre (goals, cards, substitutions, half-time), team and player pages with
  related Lahza news. Champions League, Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Europa League,
  Saudi Pro League, Jordanian Pro League.
* Data: SportScore free public API (no key, called from the reader's browser, attribution shown). Cached, retried
  with backoff, polled only while visible (30 s for live matches); failures show delayed or unavailable data, never
  invented scores. Details: `guide/SPORTS.md`.

## Sections
World · Politics · Economy & Business · Tech & AI · Health & Science · Environment & Climate · Arab world ·
Palestine · Jordan · Sports · Weather · Security & Crime · Education · Arts & Culture (world first; no country is pinned).
"Breaking" is a flag on any article (ticker + `breaking.html`), not a separate section. Security is a
secondary tag: a strike in Gaza stays under Palestine and is also tagged *security*.

## Editorial rules enforced in code
* Only headline + short publisher-provided excerpt + link to the original + original publication time.
  Full articles are never copied, and nothing goes past paywalls or anti-bot systems. robots.txt is respected.
* Nothing is labelled **confirmed** automatically. Labels: official source / attributed statement /
  unverified allegation / developing / "according to the source". Only a human editor can set *confirmed*.
* AI is optional, capped per day, and its output is rejected if it adds numbers or quotes not present in the source.
* Images are off per source until you confirm the publisher's terms allow thumbnails.

## Tests
```bash
(cd supabase/functions/news-ingest && deno test -A tests/)
(cd supabase/functions/news-stories && deno test -A tests/)
PGHOST=/path PGPORT=5432 tests/run-sql-tests.sh
node tests/ui/smoke.mjs . /tmp/shots
node tests/ui/sports-smoke.mjs . /tmp/shots
```
