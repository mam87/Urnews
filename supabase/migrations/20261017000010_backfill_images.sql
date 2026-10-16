-- Fill missing thumbnails for already-stored articles (only where empty; never overwrites).
create or replace function public.news_backfill_images(p_rows jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.news_articles a set image_url = r.image_url
  from jsonb_to_recordset(p_rows) as r(url_hash text, image_url text)
  where a.url_hash = r.url_hash and a.image_url is null and r.image_url ~ '^https://' and char_length(r.image_url) <= 2048;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.news_backfill_images(jsonb) from public, anon, authenticated;
grant execute on function public.news_backfill_images(jsonb) to service_role;
-- Ask every feed for a full copy once (clears conditional-request validators) so existing items get images.
update public.news_sources set etag = null, last_modified = null where enabled;
