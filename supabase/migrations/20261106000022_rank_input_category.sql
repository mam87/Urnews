-- 2026-11-06 — the ranking re-derives event signals from each headline on every run (so rule fixes apply
-- to stored reports at once); it needs each report's section for the soft-news cap (sports, culture…).
drop function if exists public.news_rank_input(int);
create function public.news_rank_input(p_hours int default 12)
returns table (id bigint, cluster_id bigint, source_id int, publisher text, reliability smallint, official boolean,
               published_at timestamptz, language text, title text, title_en text, summary text, countries text[],
               event_type text, impact smallint, wire text, verification text, title_tokens text[], category text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.cluster_id, a.source_id, coalesce(s.publisher, s.slug), s.reliability, s.kind = 'official',
         a.published_at, a.language, a.title, a.title_en, left(a.summary, 300), a.countries,
         a.event_type, a.impact, a.wire, a.verification, a.title_tokens, a.category
  from public.news_articles a join public.news_sources s on s.id = a.source_id
  where a.published_at > now() - make_interval(hours => least(greatest(p_hours, 1), 24))
    and a.status = 'published' and a.duplicate_of is null
    and (a.impact >= 8 or a.cluster_id is not null or a.event_type is null)
  order by a.published_at desc
  limit 1500;
$$;
revoke execute on function public.news_rank_input(int) from public, anon, authenticated;
grant execute on function public.news_rank_input(int) to service_role;
