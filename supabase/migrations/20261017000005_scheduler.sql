-- Scheduler: pg_cron (inside Postgres) calls the ingest edge function every 2 minutes.
-- Runs entirely on Supabase — no browser, Claude session or local computer involved.
-- Replace __PROJECT_URL__ with https://<project-ref>.supabase.co before applying
-- (scripts/apply-scheduler.sh does this for you).

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Secrets live in Supabase Vault (encrypted at rest), never in code.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'news_project_url') then
    perform vault.create_secret('__PROJECT_URL__', 'news_project_url', 'Base URL for edge function calls');
  end if;
  if not exists (select 1 from vault.secrets where name = 'news_ingest_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'news_ingest_token', 'Shared secret between pg_cron and edge functions');
  end if;
end $$;

-- Idempotent (re)scheduling
do $$
declare j text;
begin
  foreach j in array array['news-ingest', 'news-watchdog', 'news-retention', 'news-cron-cleanup'] loop
    if exists (select 1 from cron.job where jobname = j) then perform cron.unschedule(j); end if;
  end loop;
end $$;

select cron.schedule('news-ingest',      '*/2 * * * *', $$ select public.news_call_edge_function('news-ingest'); $$);
select cron.schedule('news-watchdog',    '*/5 * * * *', $$ select public.news_watchdog(); $$);
select cron.schedule('news-retention',   '17 1 * * *',  $$ select public.news_purge_old(); $$);
-- keep pg_cron / pg_net bookkeeping tables small on the free tier
select cron.schedule('news-cron-cleanup', '23 1 * * *', $$
  delete from cron.job_run_details where end_time < now() - interval '3 days';
$$);
