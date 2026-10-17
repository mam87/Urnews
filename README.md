# لحظة — Lahza News

An automated Arabic live breaking-news site. A scheduler inside the database collects headlines from
official RSS feeds every 2 minutes, classifies and de-duplicates them, groups reports of the same event,
labels how well-sourced each item is, and pushes updates to open browsers, with no server or PC of yours
running.

* **Frontend:** static HTML/CSS/JS on GitHub Pages: RTL, mobile-first, dark mode, live ticker,
  live feed with pause, search, 9 categories, breaking timeline, article page, admin dashboard.
* **Backend:** Supabase Postgres (RLS on every table) + `pg_cron` + Edge Functions (`ingest`, `notify`).
* **Cost:** $0 on free tiers (with limits listed in `guide/SETUP.md`), or about $25/month on Supabase Pro.

| Path | What |
|---|---|
| `supabase/migrations/` | Schema, RLS & grants, functions, seed data, scheduler, sources |
| `supabase/functions/news-ingest/` | Feed fetch → parse → classify → dedupe/cluster → optional AI → insert |
| `supabase/functions/news-notify/` | Admin alerts (Telegram / e-mail) |
| `assets/js/` | Site + admin (vanilla ES modules, vendored supabase-js) |
| `tests/` | SQL/RLS tests, UI smoke tests; Deno tests live in `supabase/functions/news-ingest/tests/` |
| `guide/SETUP.md` | Setup, adding sources, rotating keys, backups/restore, costs |

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
PGHOST=/path PGPORT=5432 tests/run-sql-tests.sh
node tests/ui/smoke.mjs . /tmp/shots
```
