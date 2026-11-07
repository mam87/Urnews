-- World news map: stories per country (first tagged country of each published, non-duplicate report),
-- optionally limited to one theme. Countries come from the ingest gazetteer tags only — no coordinates are invented.
-- Read-only, additive.
create or replace function public.news_map_counts(p_hours integer default 24, p_theme text default null)
returns table (country text, n bigint, breaking bigint)
language sql stable set search_path = '' as $$
  select c, count(*), count(*) filter (where a.is_breaking and a.breaking_until > now())
  from public.news_articles a, unnest(a.countries[1:1]) c
  where a.status = 'published' and a.duplicate_of is null
    and a.published_at > now() - make_interval(hours => least(greatest(p_hours, 1), 168))
    and case p_theme
      when 'conflict' then a.event_type in ('war', 'attack', 'ceasefire', 'coup', 'assassination') or a.categories @> array['security']
      when 'disaster' then a.event_type in ('disaster', 'earthquake', 'tsunami', 'crash', 'health_emergency')
      when 'politics' then a.event_type in ('government', 'election', 'leader', 'intl_decision') or a.categories @> array['politics']
      when 'economy'  then a.event_type in ('economy', 'energy') or a.categories @> array['economy']
      when 'tech'     then a.categories @> array['tech'] or a.event_type = 'science'
      else true end
  group by c order by count(*) desc limit 200;
$$;
revoke all on function public.news_map_counts(integer, text) from public;
grant execute on function public.news_map_counts(integer, text) to anon, authenticated;
