# Current deployment (2026-10-17)

* **Database / backend:** Supabase project **LabGram** (`ualumobbhukgmjbznhea`, ap-southeast-2), shared with the
  LabGram app. Every news object is prefixed `news_` and all grants are scoped to those objects; LabGram tables,
  functions and permissions are untouched (verified: anon can still read LabGram tables).
* **Edge Functions:** `news-ingest`, `news-notify` (JWT verification off; protected by the Vault token).
  The deployed entrypoint imports `lib/*.ts` from this repository pinned to commit
  `eb1ee46c71f2ac22e0307a85b2facdc0aa62ac34`, so the running code is exactly the tested code.
  To deploy a new version: push, then redeploy with the new commit SHA in the import URLs
  (or run `scripts/build-functions.sh` and deploy the single-file bundle with the Supabase CLI).
* **Scheduler:** pg_cron `news-ingest` every 2 min, `news-watchdog` every 5 min.
* **Pending (needs a one-time approval in the Claude chat, because they contain DELETE statements):**
  the retention function `news_purge_old()` + its daily job, and the daily `cron.job_run_details` cleanup.
  Until then nothing is deleted automatically; at ~2–5 MB/day this is not urgent.
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
