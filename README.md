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

## Lahza Reels (2026-11-07)
* `reels.html`: full-screen swipeable YouTube Shorts from 21 verified news and sports publishers (Arabic and English),
  played in YouTube's official privacy-enhanced embed, one at a time; filters, captions, share, related Lahza story.
* Collected every 10 minutes by the database scheduler from the publishers' free public Shorts feeds (metadata only,
  14-day retention). Details: `guide/REELS.md`.

## World news map & My Lahza (2026-11-07)
* `map.html`: world map (Natural Earth 1:110m, pre-projected by `scripts/gen-world-map.mjs` into `assets/world-map.json` —
  no map library) shaded by stories per country over 6 h / 24 h / 7 days, with themes (conflict, disasters, politics,
  economy, tech) from `news_map_counts()` (migration 26). Countries come from the classifier's tags, never invented
  coordinates; breaking countries are outlined; tap a country for its top stories, follow it, or use the ranked list.
* `mine.html` («لحظتي»): "For you" feed from followed countries and sections, saved stories and full reports (Save button
  on article pages), follow management — stored only in the browser (localStorage), no account.

## Monetization readiness & final report (2026-11-07)
* Labelled house-ad slots, sponsor label and a consent-based newsletter sign-up (CSV export in admin) — all off by
  default; see `guide/MONETIZATION.md`. Full implementation report: `guide/FINAL_REPORT.md`.

## Platform update (2026-11-13)
* **Sports:** UEFA Nations League, World Cup and Euro qualifiers added; the day list is organised by family (national teams,
  European club competitions, top leagues, Arab leagues, others), with All / Live / Upcoming / Finished filters and stacked
  match rows. National teams, ~250 clubs, ~90 competitions and the provider's status / group / round phrases are shown in Arabic.
* **Weather:** `weather.html` + home panel for the reader's own place (device time zone on first visit, optional browser
  location, search any city / region / country; up to 6 saved in the browser). Now, 24 hours, 7 days, world cities;
  refreshed every 10 minutes (Open-Meteo forecast + geocoding, no key).
* **Reels:** tap to pause, double-tap to like, press-and-hold, progress bar, action rail, For you / News / Sports / Liked tabs;
  the Arabic edition shows Arabic videos by default (all languages in Sports).
* **New sections:** Science & Space, Nature & Animals, Opinion & Analysis (migration 28: 14 feeds, section rules in a database
  trigger, opinion never breaking). Edge Function `news-translate` translates their English headlines every 5 minutes from
  the same daily AI budget.
* **Trends:** `trends.html` — Google Trends "trending now" per country (28 countries, collected every 5 minutes by pg_cron +
  pg_net into `news_trends`) plus the stories most newsrooms are covering; strip and panel on the home page.
* **Untranslated text:** an Arabic headline is never shown with the publisher's English excerpt (fixed in
  `news_set_translations` and in the UI); ranked events without a headline in the reader's language are held back.
* **Theme:** one dark chrome (clocks strip, masthead, ticker, page navigation, footer) with gold accents in both themes;
  phone bottom bar with a "More" sheet. UI tests: `tests/ui/pages-smoke.mjs` (weather, trends) added; pass the site
  directory as an absolute path.

## Global Intelligence centre (2026-11-21)
* `intel.html` («مركز لحظة للذكاء والتحليل العالمي»): what the world is discussing now, trending YouTube analysis in 10 sections
  (global, politics, war & security, sports, tech & AI, automotive, science, medicine, economy, documentaries) and the top
  developments. LIVE pills per feed turn to «متأخر» when data is stale; nothing is shown as live from old data.
* **YouTube analysis** (migration 29): the public long-form upload feeds of 44 verified channels (Arabic and international
  newsrooms, economy, tech, automotive, science, WHO, documentaries, sports) — free, no API key. Views and likes are
  snapshotted every 30 minutes; velocity is compared with each channel's own median. Two separate, explainable scores:
  **Popularity** (velocity 40 · growth 20 · engagement 25 · cross-platform 15) and **Editorial importance** (channel
  tier 35 · subject 25 · independent news coverage 25 · analysis format 15). Comment counts and retention are not in the
  public feed and are never estimated.
* **Fused trends**: Google Trends (28 countries) + Lahza's 65 publisher feeds + the YouTube videos. A topic is labelled
  *global* only on 2+ platforms and in 3+ countries or 3+ independent publishers.
* Edge Function `intel-translate` translates the top video titles and non-Arabic trend keywords (same daily AI budget and checks).
* Scheduler: `intel-youtube`, `intel-trends` and `intel-translate` every 10 minutes. Retention: snapshots 3 days, videos 10 days,
  trends 48 h after they were last seen. Tests: `tests/sql/40_intel_tests.sql`,
  `tests/ui/intel-smoke.mjs`.

## Sections
World · Politics · Economy & Business · Tech & AI · Health · Science & Space · Nature & Animals · Opinion & Analysis · Environment & Climate · Arab world ·
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
node tests/ui/reels-smoke.mjs . /tmp/shots
node tests/ui/map-mine-smoke.mjs . /tmp/shots
node tests/ui/monetize-smoke.mjs . /tmp/shots
```
