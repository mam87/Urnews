# Nabd News — Setup, Operations & Recovery

This guide takes the platform from an empty Supabase project to a running site, and covers day-to-day maintenance.

## 1. Architecture (and why it is the cheapest reliable option)

```
            every 2 min                 HTTPS (x-ingest-token)
 pg_cron ─────────────► pg_net ───────────────────────────► Edge Function `ingest` ──► RSS feeds
 (inside Postgres)                                           │  parse · classify · dedupe · cluster
      │ every 5 min                                          │  optional AI (translate/summarise)
      └─► watchdog() ── alert ──► Edge Function `notify` ──► Telegram / e-mail
                                                             ▼
                                              Postgres (RLS)  ── realtime.send('new_articles')
                                                             ▲                     │ one tiny event per run
 GitHub Pages (static site) ── REST (anon key, read-only) ───┘◄────────────────────┘ Realtime broadcast
 GitHub Actions: CI tests · nightly backup · 30-min external healthcheck
```

* **Scheduler** = `pg_cron` inside the database. It needs no browser, no Claude session, no PC.
* **Frontend live updates** are a *separate* system: browsers subscribe to a Realtime broadcast
  channel and, on each event, fetch only rows newer than they already have; if the socket fails they
  poll every 45 s (every 3 min as a safety net when the socket is healthy).
* **Free-tier limits that matter** (check https://supabase.com/pricing — limits change):
  * Free projects are **paused after ~7 days without API activity**. Real visitors and the
    GitHub healthcheck generate activity, but if the project is ever paused, ingestion stops.
    For a public launch, **Pro ($25/month) is recommended**: no pausing, daily backups.
  * Edge Functions: the ingest job runs ~21,600 times/month (every 2 min) — inside the free quota.
    Each run processes at most `max_sources_per_run` feeds to stay inside the per-request CPU limit.
  * Database 500 MB (free). Articles are purged after `retention_days` (30); expect ~50–150 MB.
  * Realtime: one broadcast per ingest run with new items (≤ 720/day) × connected viewers.

## 2. One-time setup

### 2.1 Supabase project
1. Create a project (region **Frankfurt eu-central-1** is closest to Amman with good latency).
2. Apply the migrations in order (SQL editor, or `supabase db push`):
   `20261017000001_schema.sql` → `…02_security.sql` → `…03_functions.sql` → `…04_seed.sql` → `…06_sources.sql`.
3. Deploy the Edge Functions **with JWT verification off** (they verify the Vault token themselves):
   ```bash
   supabase functions deploy news-ingest --no-verify-jwt
   supabase functions deploy news-notify --no-verify-jwt
   ```
4. Apply the scheduler with your project URL filled in:
   ```bash
   scripts/render-scheduler.sh https://<ref>.supabase.co > /tmp/scheduler.sql   # then run it in the SQL editor
   ```
   This enables `pg_cron`/`pg_net`, stores `project_url` and a random `ingest_token` in **Vault**, and schedules:
   `news-ingest` (*/2 min), `news-watchdog` (*/5 min), `news-retention` (daily), `news-cron-cleanup` (daily).
5. Authentication → Providers → Email: keep enabled. **After you have created your own admin account
   (step 2.3), turn OFF "Allow new users to sign up".** Set Site URL to your GitHub Pages URL.

### 2.2 Website (GitHub Pages)
```bash
scripts/configure-site.sh https://<ref>.supabase.co <anon-or-publishable-key>
git commit -am "Configure site" && git push
```
GitHub → repository → Settings → Pages → Source: *Deploy from a branch* → `main` / `(root)`.
The anon/publishable key is meant to be public; every permission is enforced by RLS.
The script refuses service-role / secret keys.

### 2.3 First administrator
1. Tell the database who the owner is (SQL editor — this value is private, never sent to browsers):
   `update public.settings set value = to_jsonb('you@example.com'::text) where key = 'owner_email';`
2. Open `/admin.html`, choose **إنشاء حساب** (create account) with that e-mail and a strong password,
   confirm the e-mail if asked, then sign in. Only that e-mail can claim **owner**, and only once
   (`claim_first_owner()`), so a stranger who signs up first gains nothing.
3. Turn off public sign-ups (2.1 step 5). Add editors from *المحررون* — they need an account first
   (invite them from Supabase → Authentication → Users → Invite user).

### 2.4 Optional: alerts
Edge Functions → Secrets:
* Telegram: `ALERT_TELEGRAM_BOT_TOKEN`, `ALERT_TELEGRAM_CHAT_ID` (create a bot with @BotFather, send it a
  message, read your chat id from `https://api.telegram.org/bot<token>/getUpdates`).
* E-mail via Resend: `RESEND_API_KEY`, `ALERT_EMAIL_TO`, `ALERT_EMAIL_FROM`.

Without these, alerts still appear in the admin dashboard, and the GitHub **healthcheck** workflow fails
(GitHub e-mails you) if no ingest succeeded for 30 minutes.

### 2.5 Optional: AI
Set `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` (and `AI_BASE_URL` for OpenAI-compatible providers such as
Gemini or OpenRouter). AI is used only for (a) translating non-Arabic items and (b) summaries if the
`ai_summarize` setting is `true`. Output is rejected if it adds numbers or quotation marks absent from the source.
Spending control: DB setting `ai_daily_limit` (default 300 calls/day) **plus** a hard monthly limit in the
provider's console. Then enable the English sources in *المصادر*.

### 2.6 Optional: nightly backups
Repository → Settings → Secrets and variables → Actions → `SUPABASE_DB_URL` = the **Session pooler**
connection string (Supabase → Connect). The `nightly-backup` workflow stores two files as a 30-day artifact:
`config-*.sql` (sources, settings, admins, edit history) and `full-*.dump` (all public data).

## 3. Operations

### Adding a news source
Admin → *المصادر* → *إضافة مصدر*. Use only a feed the organisation publishes itself and whose terms allow
showing headlines with links. Set `min_interval_minutes` (SQL only) if the publisher asks for a slower rate.
robots.txt is checked automatically before the first fetch and then daily; disallowed feeds are marked `blocked`.

### Replacing an expired or leaked key
| Key | Where | How |
|---|---|---|
| AI key | Edge Function secret `AI_API_KEY` | Create new key at provider → update secret → revoke old. No redeploy needed. |
| Telegram / Resend | Edge Function secrets | Same as above. |
| ingest token | Vault `ingest_token` | `select vault.update_secret((select id from vault.secrets where name='ingest_token'), encode(extensions.gen_random_bytes(32),'hex'));` — takes effect next run. |
| anon / publishable key | `assets/js/config.js` | Rotate in Supabase → API keys, run `scripts/configure-site.sh`, push. |
| service_role / secret key | Never leaves Supabase | Rotate in Supabase → API keys; Edge Functions receive the new one automatically. |
| DB password | `SUPABASE_DB_URL` GitHub secret | Reset in Supabase → Database → update the GitHub secret. |

### Pausing ingestion
Admin → *الإعدادات* → `ingest_enabled` = `false`. Or disable the cron job:
`select cron.alter_job((select jobid from cron.job where jobname='news-ingest'), active := false);`

### Changing the scheduler interval
`select cron.alter_job((select jobid from cron.job where jobname='news-ingest'), schedule := '*/3 * * * *');`
and update setting `scheduler_interval_minutes` so the site displays it correctly. Per-source intervals
(admin → *المصادر*) decide how often each feed is actually requested.

### Health checks (SQL)
```sql
select * from ingest_runs order by started_at desc limit 10;              -- recent runs
select name_ar, last_status, consecutive_failures, last_error, last_success_at from sources order by consecutive_failures desc;
select jobname, schedule, active from cron.job;                          -- scheduler
select status, return_message, start_time from cron.job_run_details order by start_time desc limit 10;
select * from alerts where resolved_at is null;
```

## 4. Backup & recovery

* **What matters most** is configuration and editorial work (sources, settings, admins, edits). Articles
  can be re-collected from feeds for the last ~48 h.
* **Restore into a new project**: apply migrations 01–04 (not 06 — sources come from the backup),
  then:
  ```bash
  psql "$NEW_DB_URL" -c "truncate public.settings, public.categories cascade"
  pg_restore --data-only --no-owner -d "$NEW_DB_URL" full-YYYYMMDDTHHMMZ.dump
  ```
  (on Supabase, run as `postgres`; if FK order complains, add `--disable-triggers` or `set session_replication_role = replica`).
  Then deploy the functions, run the scheduler script, re-run `scripts/configure-site.sh` with the new URL/key.
  The restore procedure is exercised locally by the project's tests (see `tests/`).
* **Pro plan** adds daily automated backups (7 days) restorable from the dashboard.

## 5. Tests
```bash
(cd supabase/functions/news-ingest && deno test -A tests/)          # 30 pipeline tests
PGHOST=… PGPORT=… tests/run-sql-tests.sh                        # 75+ DB/RLS tests on a throwaway Postgres
node tests/ui/smoke.mjs <site-dir> <out-dir>                    # 60 browser checks against a mocked API
```
CI runs the first two on every push (`.github/workflows/ci.yml`).
