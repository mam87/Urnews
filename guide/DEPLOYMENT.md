# Current deployment (2026-10-17)

* **Database / backend:** Supabase project **LabGram** (`ualumobbhukgmjbznhea`, ap-southeast-2), shared with the
  LabGram app. Every news object is prefixed `news_` and all grants are scoped to those objects; LabGram tables,
  functions and permissions are untouched (verified: anon can still read LabGram tables).
* **Edge Functions:** `news-ingest`, `news-notify` (JWT verification off; protected by the Vault token).
  The deployed entrypoint imports `lib/*.ts` from this repository pinned to commit
  `30d530a43b1368e7a75b504d4ed135bd665cefbe`, so the running code is exactly the tested code.
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
| BBC Arabic, Al Jazeera, France 24, DW, Euronews, Sky News Arabia, Asharq Al-Awsat, Anadolu, Roya, AIT News | robots.txt forbids: CNN Arabic, Petra, UN News · HTTP 403 anti-bot (not bypassed): Al Arabiya, Al Ghad, Arab48, Independent Arabia · wrong URL (404/HTML): Al Mamlaka, WAFA, Ammon |
