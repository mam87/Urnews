-- 1) Hiding the only published article of a cluster failed: the refresh set first_seen/last_seen to
--    NULL (not-null columns). Keep the previous bounds when a cluster has no visible members.
create or replace function public.news_refresh_cluster(p_cluster bigint)
returns void language sql security definer set search_path to '' as $function$
  update public.news_clusters c set
    article_count = s.n,
    source_count  = s.srcs,
    first_seen    = coalesce(s.first_seen, c.first_seen),
    last_seen     = coalesce(s.last_seen, c.last_seen),
    lead_article_id = s.lead
  from (
    select count(*) n, count(distinct a.source_id) srcs, min(a.published_at) first_seen, max(a.published_at) last_seen,
           (array_agg(a.id order by a.importance desc, a.published_at asc))[1] lead
    from public.news_articles a where a.cluster_id = p_cluster and a.status = 'published' and a.duplicate_of is null
  ) s
  where c.id = p_cluster;
$function$;

-- 2) First real run (2026-10-28): Ynet, Walla and Maariv feeds OK; these two are not usable.
update public.news_sources set enabled = false,
  terms_note = case slug when 'haaretz-he' then 'Disabled 2026-10-28: HTTP 403 anti-bot (not bypassed)'
                         else 'Disabled 2026-10-28: /rss is not an RSS feed (parse error)' end
where slug in ('haaretz-he', 'israelhayom');
