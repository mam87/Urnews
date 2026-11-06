-- 2026-11-06 — the global ranking is the single authority for AUTOMATIC breaking flags.
-- Reports flagged at insert time (a publisher's «عاجل» label, older rules) that are not part of an event the
-- ranking currently marks breaking lose the flag. Never touched: pinned reports and anything an editor
-- flagged (the audit trail in news_article_history shows an is_breaking change by a signed-in user).
create or replace function public.news_save_global_events(p jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare n int; hrs int := coalesce((select (value)::text::int from public.news_settings where key = 'breaking_hours'), 6);
begin
  delete from public.news_global_events where true;
  insert into public.news_global_events (key, rank, cluster_id, lead_article_id, lead_ar_id, lead_en_id, first_article_id,
      score, parts, status, confirmed, single_source, allegation, independent_count, publisher_count, report_count,
      countries, region, event_type, first_seen, last_seen, is_breaking)
  select e.key, e.rank, e.cluster_id, e.lead_article_id, e.lead_ar_id, e.lead_en_id, e.first_article_id,
      least(100, greatest(0, e.score)), coalesce(e.parts, '{}'), e.status, e.confirmed, e.single_source, e.allegation,
      e.independent_count, e.publisher_count, e.report_count, coalesce(e.countries, '{}'), e.region, e.event_type,
      e.first_seen, e.last_seen, e.is_breaking
  from jsonb_to_recordset(p) as e(key text, rank smallint, cluster_id bigint, lead_article_id bigint, lead_ar_id bigint,
      lead_en_id bigint, first_article_id bigint, score int, parts jsonb, status text, confirmed boolean, single_source boolean,
      allegation boolean, independent_count int, publisher_count int, report_count int, countries text[], region text,
      event_type text, first_seen timestamptz, last_seen timestamptz, is_breaking boolean)
  where exists (select 1 from public.news_articles a where a.id = e.lead_article_id)
  on conflict (key) do nothing;
  get diagnostics n = row_count;

  -- Breaking events reach the ticker through their lead reports (Arabic and English heads of the event).
  update public.news_articles a set is_breaking = true,
         breaking_until = greatest(coalesce(a.breaking_until, now()), now() + make_interval(hours => least(hrs, 3)))
  from public.news_global_events g
  where g.is_breaking and a.id in (g.lead_article_id, g.lead_ar_id, g.lead_en_id)
    and a.status = 'published' and (not a.is_breaking or a.breaking_until < now() + interval '1 hour');

  -- Automatic flags on reports outside every breaking event are withdrawn (only when a ranking was saved).
  if n > 0 then
    update public.news_articles a set is_breaking = false, breaking_until = null
    where a.is_breaking and a.breaking_until > now() and not a.pinned
      and a.published_at > now() - interval '24 hours'
      and not exists (select 1 from public.news_global_events g where g.is_breaking
                      and (a.id in (g.lead_article_id, g.lead_ar_id, g.lead_en_id, g.first_article_id)
                           or (g.cluster_id is not null and a.cluster_id = g.cluster_id)))
      and not exists (select 1 from public.news_article_history h where h.article_id = a.id and h.changed_by is not null
                      and h.new_values ? 'is_breaking');
  end if;
  begin
    perform realtime.send(jsonb_build_object('events', n, 'at', now()), 'global_events', 'news-feed', false);
  exception when others then null;
  end;
  return n;
end $$;
revoke execute on function public.news_save_global_events(jsonb) from public, anon, authenticated;
grant execute on function public.news_save_global_events(jsonb) to service_role;
