-- 1) Some feeds label UTC times as "+0300" (Al Jazeera Arabic). tz_force_minutes overrides the
--    declared zone for such feeds. Measured on 2026-10-17: Al Jazeera items arrived a median 207 min
--    "late" (180 min = wrong zone + ~27 min real feed delay); all other sources 3-27 min.
alter table public.news_sources add column if not exists tz_force_minutes smallint
  check (tz_force_minutes between -720 and 840);
grant select (tz_force_minutes) on public.news_sources to anon, authenticated;
grant update (tz_force_minutes) on public.news_sources to authenticated;
update public.news_sources set tz_force_minutes = 0 where slug = 'aljazeera';

-- correct already-stored Al Jazeera times (never later than when we fetched them)
update public.news_articles a set published_at = least(a.published_at + interval '3 hours', a.created_at)
where a.source_id = (select id from public.news_sources where slug = 'aljazeera') and not a.published_estimated;

-- 2) Breaking: an event independently reported by 2+ sources within 90 minutes, high importance.
create or replace function public.news_promote_multi_source_breaking(p_min_sources int default 2)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  with hot as (
    select c.id from public.news_clusters c
    where c.source_count >= p_min_sources and c.last_seen > now() - interval '90 minutes'
      and c.first_seen > now() - interval '3 hours'
  )
  update public.news_articles a set is_breaking = true, breaking_until = greatest(coalesce(a.breaking_until, now()), now() + interval '3 hours')
  from hot, public.news_clusters c
  where c.id = hot.id and a.id = c.lead_article_id and not a.is_breaking
    and a.status = 'published' and a.importance >= 45 and a.verification <> 'allegation';
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.news_promote_multi_source_breaking(int) from public, anon, authenticated;

-- 3) Poll the fastest general-news feeds every 3 minutes (their minimum allowed interval).
update public.news_sources set poll_interval_minutes = 3
where slug in ('aljazeera', 'bbc-arabic', 'skynews-ar', 'roya', 'anadolu-ar', 'france24-ar') and min_interval_minutes <= 3;
update public.news_settings set value = '12' where key = 'max_sources_per_run';
