-- 2026-11-06 — four new sections, scheduler bookkeeping, richer admin monitoring.
-- Safe to re-run. Touches only news_* objects.

-- 1) Sections. The 15 requested sections map onto existing ones where they already exist:
--    Breaking → is_breaking flag + breaking.html · Middle East → arab · Business → economy ·
--    Science → health ("صحة وعلوم"). New: entertainment, security, education, environment.
insert into public.news_categories (slug, name_ar, sort_order) values
  ('environment',   'بيئة ومناخ',   11),
  ('education',     'تعليم',        12),
  ('security',      'أمن وجريمة',   13),
  ('entertainment', 'فن وثقافة',    14)
on conflict (slug) do update set name_ar = excluded.name_ar, sort_order = excluded.sort_order;

-- 2) The scheduler runs every minute since 2026-10-28 (migration 16); the displayed setting still said 2.
update public.news_settings set value = '1' where key = 'scheduler_interval_minutes';

-- 3) Scheduler health, readable without exposing cron internals to browsers.
--    Returns null fields when pg_cron is absent (local tests), never fails.
create or replace function public.news_scheduler_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  jobs jsonb; ingest_sched text; ingest_active boolean; next_at timestamptz; step int; fails int; last_cron jsonb;
begin
  if to_regclass('cron.job') is null then
    return jsonb_build_object('available', false);
  end if;
  execute $q$ select coalesce(jsonb_agg(jsonb_build_object('name', jobname, 'schedule', schedule, 'active', active) order by jobname), '[]')
              from cron.job where jobname like 'news-%' $q$ into jobs;
  execute $q$ select schedule, active from cron.job where jobname = 'news-ingest' $q$ into ingest_sched, ingest_active;
  -- next run for the simple schedules this project uses: "* * * * *" and "*/N * * * *"
  if ingest_sched ~ '^\*(/[0-9]+)? \* \* \* \*$' then
    step := coalesce(nullif(substring(ingest_sched from '^\*/([0-9]+)'), '')::int, 1);
    next_at := date_trunc('hour', now())
               + make_interval(mins => ((floor(extract(minute from now()) / step)::int + 1) * step));
  end if;
  if to_regclass('cron.job_run_details') is not null then
    execute $q$ select count(*) from cron.job_run_details d join cron.job j using (jobid)
                where j.jobname like 'news-%' and d.start_time > now() - interval '24 hours' and d.status <> 'succeeded' $q$ into fails;
    execute $q$ select to_jsonb(x) from (select d.status, d.start_time, left(d.return_message, 200) as message
                from cron.job_run_details d join cron.job j using (jobid) where j.jobname = 'news-ingest'
                order by d.start_time desc limit 1) x $q$ into last_cron;
  end if;
  return jsonb_build_object(
    'available', true, 'jobs', jobs, 'ingest_schedule', ingest_sched, 'ingest_active', ingest_active,
    'next_ingest_at', next_at, 'cron_failures_24h', fails, 'last_ingest_cron', last_cron);
exception when others then
  return jsonb_build_object('available', false, 'error', sqlerrm);
end $$;
revoke execute on function public.news_scheduler_status() from public, anon;
revoke execute on function public.news_scheduler_status() from authenticated;
grant execute on function public.news_scheduler_status() to service_role; -- browsers get it only via news_admin_stats()

-- 4) Admin stats: same keys as before plus source health, ignored items and scheduler status.
create or replace function public.news_admin_stats()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.news_is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'runs_24h',        (select count(*) from public.news_ingest_runs where started_at > now() - interval '24 hours'),
    'runs_failed_24h', (select count(*) from public.news_ingest_runs where started_at > now() - interval '24 hours' and status = 'error'),
    'last_run',        (select to_jsonb(r) from public.news_ingest_runs r order by started_at desc limit 1),
    'last_ok_run_at',  (select max(finished_at) from public.news_ingest_runs where status in ('ok','partial')),
    'articles_total',  (select count(*) from public.news_articles),
    'articles_24h',    (select count(*) from public.news_articles where created_at > now() - interval '24 hours'),
    'duplicates_24h',  (select count(*) from public.news_articles where created_at > now() - interval '24 hours' and duplicate_of is not null),
    -- feed items seen again (same URL/guid already stored, or too old) and therefore not inserted
    'ignored_24h',     (select coalesce(sum(greatest(items_seen - items_new, 0)), 0) from public.news_ingest_runs where started_at > now() - interval '24 hours'),
    'breaking_now',    (select count(*) from public.news_articles where is_breaking and breaking_until > now() and status = 'published'),
    'pending',         (select count(*) from public.news_articles where status = 'pending'),
    'sources_active',  (select count(*) from public.news_sources where enabled),
    'sources_failing', (select count(*) from public.news_sources where enabled and (consecutive_failures > 0 or last_status in ('error','blocked'))),
    'fetch_errors_24h',(select count(*) from public.news_fetch_logs where started_at > now() - interval '24 hours' and status in ('error','blocked')),
    'by_category_24h', (select coalesce(jsonb_object_agg(category, n), '{}') from (select category, count(*) n from public.news_articles where created_at > now() - interval '24 hours' and duplicate_of is null group by 1) x),
    'hourly_24h',      (select coalesce(jsonb_agg(jsonb_build_object('h', h, 'n', n) order by h), '[]') from (select date_trunc('hour', created_at) h, count(*) n from public.news_articles where created_at > now() - interval '24 hours' group by 1) x),
    'ai_today',        (select calls from public.news_ai_usage where day = current_date),
    'open_alerts',     (select coalesce(jsonb_agg(to_jsonb(a) order by created_at desc), '[]') from public.news_alerts a where resolved_at is null),
    'scheduler',       public.news_scheduler_status(),
    'interval_minutes',(select (value)::text::int from public.news_settings where key = 'scheduler_interval_minutes'),
    'db_size',         pg_size_pretty(pg_database_size(current_database()))
  );
end $$;
revoke execute on function public.news_admin_stats() from public, anon;
grant execute on function public.news_admin_stats() to authenticated;
