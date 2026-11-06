# Current deployment (2026-10-17)

* **Database / backend:** Supabase project **CV Pro** (`ghxnmnydeuvnrsulywbj`, eu-central-1), shared with the
  CV Pro app. Moved here on 2026-10-17 because the free plan allows only 2 active projects and LabGram
  (`ualumobbhukgmjbznhea`, the previous host) was paused. Every news object is prefixed `news_` and all grants
  are scoped to those objects; CV Pro tables, functions and permissions are untouched (verified: grant
  fingerprints identical before/after, anon can still read CV Pro `packages`). Articles stored in LabGram were
  not copied; LabGram still holds its own `news_` copy and can be dropped or resumed later.
  Migrations were applied by fetching the files from this repo at commit `93797ee` (md5 verified) and executing them.
* **Edge Functions:** `news-ingest`, `news-notify` (JWT verification off; protected by the Vault token).
  The deployed entrypoint imports `lib/*.ts` from this repository pinned to commit
  `e8de9d83d5301a0f3c26f17a933d8a00201d31a7` (deployed 2026-11-03, version 10), so the running code is exactly the tested code.
  To deploy a new version: push, then redeploy with the new commit SHA in the import URLs
  (or run `scripts/build-functions.sh` and deploy the single-file bundle with the Supabase CLI).
* **AI translation (2026-11-03):** batched (≤10 headlines per request, ≤3 requests per run), unused quota
  refunded, 15-minute pause after a provider 429 (`ai_cooldown_until`), only items < 6 h old are translated.
* **Scheduler:** pg_cron `news-ingest` every 1 min (was 2 min until 2026-10-28), `news-watchdog` every 5 min,
  `news-retention` 01:17 UTC daily, `news-cron-cleanup` 01:23 UTC daily (all four verified active on 2026-11-06).
* **Owner e-mail** is stored only in the database (`news_settings.owner_email`), not in this public repo.
* **Website:** GitHub Pages from this repo (`main`, root) once enabled in Settings → Pages.

## First real run — source status
| Working (10) | Disabled and why |
|---|---|
| BBC Arabic, Al Jazeera, France 24, DW, Euronews, Sky News Arabia, Asharq Al-Awsat, Anadolu, Roya, AIT News, JO24, Hala News, Al-Quds Al-Arabi (added 2026-10-17) | robots.txt forbids: CNN Arabic, Petra, UN News · HTTP 403 anti-bot (not bypassed): Al Arabiya, Al Ghad, Arab48, Independent Arabia · wrong URL (404/HTML): Al Mamlaka, WAFA, Ammon · also probed and not added: Al Araby/Al-Araby Al-Jadeed, Al Mayadeen, Maan, Elaph, Addustour (403 or robots disallow), Arabi21 (feed times mislabelled), Khaberni/Saraya (no RSS) |

## Images & live TV (2026-10-17)
* Thumbnails: shown for sources with `allow_images = true` (toggle per source in admin → المصادر).
  Feeds that include item images: BBC Arabic, Sky News Arabia, France 24, Asharq Al-Awsat, AIT News.
  Al Jazeera, DW, Euronews, Anadolu and Roya publish no per-item image in their RSS (only a channel logo).
* Live TV (`live.html`): channels in `news_live_channels`, editable in admin → البث المباشر.
  Verified YouTube channel IDs (embedded): Al Mamlaka, Al Jazeera Mubasher, Sky News Arabia, Al Araby, DW Arabic.
  Handle only (opens YouTube live page): Roya, Al Jazeera, Al Arabiya, France 24 Arabic — add their UC… IDs to embed.

## Hebrew sources (2026-10-28)
* Ynet (newsflashes), Walla (breaking), Maariv (breaking) — enabled, fetched OK on the first run.
  Haaretz (HTTP 403 anti-bot, not bypassed) and Israel Hayom (`/rss` is not a feed) were added then disabled.
* Hebrew items are published **only** as Arabic machine translations (headline + short translated excerpt + link).
  Untranslated items are skipped and retried next run, so these sources stay silent until an AI key is set
  (`AI_PROVIDER`, `AI_API_KEY`, optional `AI_MODEL`/`AI_BASE_URL` as Edge Function secrets). `ai_daily_limit` = 800.
* The 60 items stored by the run just before the new code was deployed were set to `hidden` (untranslated).
* Edge Function `news-ingest` now imports `lib/*.ts` pinned to commit `1a878bf`.

## Upgrade 2026-11-06
* **Interval decision:** the owner chose to keep ingestion **every minute** (a 5-minute schedule was proposed
  and declined because it would delay breaking news). `scheduler_interval_minutes` corrected from 2 to 1.
* **Sections:** + Environment & Climate, Education, Security & Crime (secondary tag), Arts & Culture (14 total).
* **Edge Function `news-ingest` v11** imports `lib/*.ts` pinned to commit `e45addd0d37968537d3bd36f661d0a38fd05f80a`.
* **Migrations applied:** `…19_categories_monitoring.sql`, `…20_quality_sources.sql`.
* **New sources:** France 24 Arabic sports, DW Arabic science, WHO, BBC health / science & environment /
  technology / entertainment & arts, The National (UAE). Not possible: Reuters & AP (no public RSS),
  UN News (robots), Al Mamlaka (robots + 404), Petra (robots).
* **CI:** the `tests` workflow had failed since 2026-10-28 (migration 16 calls pg_cron, absent in CI);
  fixed with a pg_cron stub. `nightly-backup` fails until the `SUPABASE_DB_URL` Actions secret is added.

## Global breaking news (2026-11-06, later the same day)
* **Edge Function `news-ingest` v15** imports `lib/*.ts` pinned to commit `eb0b02f124df03dab2d2c0a164154a7a62734c0d`.
  History: v12 (`d2655d9`) hit the Edge CPU-time limit on its first run (one regex per country term × 300 new items;
  the run lock released itself after 5 min) → v13 (`3611db1`) dictionary lookup (~0.3 s worst case) → v14 (`fb801bb`)
  stricter breaking rules from the first live ranking → v15 (`eb0b02f`) breaking reconcile + stored-event merging → v16 quakes merge only when magnitudes agree.
* **Migrations applied** (each fetched from GitHub at its commit, md5-verified, then executed): `…21_global_breaking.sql`, `…22_rank_input_category.sql`, `…23_breaking_reconcile.sql`.
* **Ranking:** every run with new reports (and every 5 min) ranks the last 12 h into `news_global_events`
  (score 0–100: impact 30, freshness 25, credibility 20, independent coverage 15, speed 10). No country bonus;
  the old Jordan-only breaking rule and Jordan/Palestine importance bonuses were removed. The ranking is the
  single authority for automatic breaking flags (publisher «عاجل» labels are provisional); editor flags are never removed.
  One outlet alone can raise an alert only for a major event (impact ≥ 24 and score ≥ 70), labelled single-source.
* **New feeds (21), all fetched OK from this project on 2026-11-06:** USGS M4.5+ quakes (official), Euronews EN,
  RFI EN, CBS World, CBC World, Mexico News Daily, MercoPress, Agência Brasil EN, Buenos Aires Times, Africanews,
  Premium Times (NG), CNA, Straits Times, SCMP, Yonhap, Japan Times, The Hindu, Dawn, Times of Central Asia,
  AKIpress, ABC Australia. Not possible: Reuters/AP/AFP (no public RSS; AP 403), CNN (TLS error / frozen feed),
  NHK World and Kyodo (404), News24 (403), GDACS (rejected), Rappler (robots.txt blocks AI crawlers).
* English reports are now published in English (English edition) instead of being dropped when untranslated;
  the Arabic edition still shows only Arabic and translated reports. Hebrew remains translation-only.
