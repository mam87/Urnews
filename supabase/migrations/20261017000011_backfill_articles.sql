-- Enrich already-stored articles from later fetches: missing thumbnail, or a longer publisher excerpt.
-- Never overwrites editor or AI text, never shortens, caps excerpt length (full article stays on the source site).
create or replace function public.news_backfill_articles(p_rows jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare n1 int; n2 int;
begin
  update public.news_articles a set image_url = r.image_url
  from jsonb_to_recordset(p_rows) as r(url_hash text, image_url text, summary text)
  where a.url_hash = r.url_hash and a.image_url is null
    and r.image_url ~ '^https://' and char_length(r.image_url) <= 2048;
  get diagnostics n1 = row_count;
  update public.news_articles a set summary = left(r.summary, 650), summary_kind = 'feed'
  from jsonb_to_recordset(p_rows) as r(url_hash text, image_url text, summary text)
  where a.url_hash = r.url_hash and not a.edited and a.summary_kind in ('feed', 'none')
    and r.summary is not null and r.summary !~ '<[a-zA-Z/!]'
    and char_length(r.summary) > char_length(coalesce(a.summary, '')) + 40;
  get diagnostics n2 = row_count;
  return n1 + n2;
end $$;
revoke execute on function public.news_backfill_articles(jsonb) from public, anon, authenticated;
grant execute on function public.news_backfill_articles(jsonb) to service_role;
update public.news_sources set etag = null, last_modified = null, next_fetch_at = now() where enabled;
