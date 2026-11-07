-- «لحظة ريلز»: short vertical videos (YouTube Shorts) from verified news and sports publishers.
-- Source: each channel's public Shorts feed (https://www.youtube.com/feeds/videos.xml?playlist_id=UUSH…), free and
-- key-less. Only metadata is stored (id, title, the first lines of the publisher's caption, time, thumbnail URL);
-- videos are played with YouTube's official embedded player and always link back to YouTube. Nothing is downloaded.
-- Collected by pg_cron + pg_net every 10 minutes (no Edge Function, no secret).
-- Additive only: no existing table, policy or job is changed.

create table public.news_video_channels (
  channel_id   text primary key check (channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  name_ar      text not null check (char_length(name_ar) between 2 and 60),
  name_en      text not null check (char_length(name_en) between 2 and 60),
  kind         text not null check (kind in ('news', 'sports')),
  language     text not null check (language in ('ar', 'en')),
  country      text,
  enabled      boolean not null default true,
  sort_order   smallint not null default 100,
  last_fetch_at timestamptz,
  last_ok_at   timestamptz,
  last_error   text,
  created_at   timestamptz not null default now()
);

create table public.news_videos (
  video_id     text primary key check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  channel_id   text not null references public.news_video_channels(channel_id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 300),
  caption      text check (char_length(caption) <= 240),
  published_at timestamptz not null,
  updated_at   timestamptz,
  thumbnail    text check (thumbnail ~ '^https://i[0-9]?\.ytimg\.com/'),
  views        bigint,
  kind         text not null check (kind in ('news', 'sports')),
  language     text not null check (language in ('ar', 'en')),
  related_article_id bigint references public.news_articles(id) on delete set null,
  fetched_at   timestamptz not null default now()
);
create index news_videos_recent on public.news_videos (published_at desc);
create index news_videos_kind on public.news_videos (kind, language, published_at desc);

-- requests in flight (pg_net is asynchronous: issued in one run, collected in the next)
create table public.news_video_fetches (
  request_id  bigint primary key,
  channel_id  text not null references public.news_video_channels(channel_id) on delete cascade,
  created_at  timestamptz not null default now()
);

alter table public.news_video_channels enable row level security;
alter table public.news_videos enable row level security;
alter table public.news_video_fetches enable row level security;
revoke all on public.news_video_channels, public.news_videos, public.news_video_fetches from anon, authenticated;
grant select (channel_id, name_ar, name_en, kind, language, country, enabled, sort_order, last_ok_at) on public.news_video_channels to anon, authenticated;
grant select on public.news_videos to anon, authenticated;
create policy video_channels_read on public.news_video_channels for select using (enabled or public.news_is_admin());
create policy videos_read on public.news_videos for select using (
  exists (select 1 from public.news_video_channels c where c.channel_id = news_videos.channel_id and c.enabled));
-- editors can switch channels on/off (admin UI or SQL); everything else is written by the scheduler only
grant update (enabled, sort_order) on public.news_video_channels to authenticated;
create policy video_channels_admin on public.news_video_channels for update to authenticated
  using (public.news_is_admin()) with check (public.news_is_admin());

-- Channel IDs verified on 2026-11-07: each Shorts feed answered 200 and its <author> matched the publisher.
insert into public.news_video_channels (channel_id, name_ar, name_en, kind, language, country, sort_order) values
  ('UCfiwzLy-8yKzIbsmZTzxDgw', 'الجزيرة',          'Al Jazeera Arabic',  'news',   'ar', 'QA', 1),
  ('UCahpxixMCwoANAftn6IxkTg', 'العربية',          'Al Arabiya',         'news',   'ar', 'AE', 2),
  ('UCIJXOvggjKtCagMfxvcCzAA', 'سكاي نيوز عربية',  'Sky News Arabia',    'news',   'ar', 'AE', 3),
  ('UCelk6aHijZq-GJBBB9YpReA', 'بي بي سي عربي',    'BBC News Arabic',    'news',   'ar', 'GB', 4),
  ('UC0jiFAzTgl17k7awGbuoYew', 'المملكة',          'Al Mamlaka TV',      'news',   'ar', 'JO', 5),
  ('UCdTyuXgmJkG_O8_75eqej-w', 'فرانس 24 عربي',    'France 24 Arabic',   'news',   'ar', 'FR', 6),
  ('UC30ditU5JI16o5NbFsHde_Q', 'DW عربية',         'DW Arabic',          'news',   'ar', 'DE', 7),
  ('UC65i3Fyq91uiUkIS0i5GLNQ', 'العربي',           'Alaraby TV',         'news',   'ar', 'QA', 8),
  ('UCCv1Pd24oPErw5S7zJWltnQ', 'الجزيرة مباشر',    'Al Jazeera Mubasher','news',   'ar', 'QA', 9),
  ('UChqUTb7kYRX8-EiaN3XFrSQ', 'رويترز',           'Reuters',            'news',   'en', 'GB', 20),
  ('UC52X5wxOL_s5yw0dQk7NtgA', 'أسوشيتد برس',      'Associated Press',   'news',   'en', 'US', 21),
  ('UC16niRr50-MSBwiO3YDb3RA', 'بي بي سي نيوز',    'BBC News',           'news',   'en', 'GB', 22),
  ('UCNye-wNBqNL5ZzHSJj3l8Bg', 'الجزيرة الإنجليزية','Al Jazeera English', 'news',   'en', 'QA', 23),
  ('UCknLrEdhRCp1aegoMqRaCZg', 'DW نيوز',          'DW News',            'news',   'en', 'DE', 24),
  ('UCoMdktPbSTixAyNGwb-UYkQ', 'سكاي نيوز',        'Sky News',           'news',   'en', 'GB', 25),
  ('UCpcTrCXblq78GZrTUTLWeBw', 'فيفا',             'FIFA',               'sports', 'en', null, 40),
  ('UCyGa1YEx9ST66rYrJTGIKOw', 'يويفا',            'UEFA',               'sports', 'en', null, 41),
  ('UCG5qGWdu8nIRZqJ_GgDwQ-w', 'الدوري الإنجليزي', 'Premier League',     'sports', 'en', 'GB', 42),
  ('UCTv-XvfzLX3i4IGWAm4sbmA', 'الدوري الإسباني',  'LALIGA',             'sports', 'en', 'ES', 43),
  ('UC14UlmYlSNiQCBe9Eookf_A', 'نادي برشلونة',     'FC Barcelona',       'sports', 'en', 'ES', 44),
  ('UCWV3obpZVGgJ3j9FVhEjF2Q', 'ريال مدريد',       'Real Madrid',        'sports', 'en', 'ES', 45);

-- First paragraph of the publisher's caption, without hashtags, links or boilerplate; at most 220 characters.
create or replace function public.news_video_caption(d text) returns text
language sql immutable set search_path = pg_catalog as $$
  select nullif(left(btrim(regexp_replace(regexp_replace(split_part(coalesce(d, ''), E'\n\n', 1), '(https?://\S+|#\S+)', '', 'g'), '\s+', ' ', 'g')), 220), '')
$$;

-- One scheduler step: collect finished feed requests, then request feeds that are due.
create or replace function public.news_videos_cycle() returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare
  f record; n_new int := 0; n_req int := 0; n_err int := 0; got int;
begin
  for f in
    select q.request_id, q.channel_id, q.created_at, r.id as rid, r.status_code, r.content, r.error_msg, c.kind, c.language
    from news_video_fetches q
    join news_video_channels c using (channel_id)
    left join net._http_response r on r.id = q.request_id
  loop
    if f.rid is null then
      if f.created_at > now() - interval '15 minutes' then continue; end if; -- still in flight
      update news_video_channels set last_error = 'no response' where channel_id = f.channel_id; n_err := n_err + 1;
    elsif f.status_code = 200 and f.content like '%<feed%' then
      begin
        with e as (
          select t.* from xmltable(
            xmlnamespaces('http://www.w3.org/2005/Atom' as a, 'http://www.youtube.com/xml/schemas/2015' as yt, 'http://search.yahoo.com/mrss/' as media),
            '/a:feed/a:entry' passing xmlparse(document f.content)
            columns vid text path 'yt:videoId', ch text path 'yt:channelId', title text path 'a:title',
                    pub timestamptz path 'a:published', upd timestamptz path 'a:updated', link text path 'a:link/@href',
                    thumb text path 'media:group/media:thumbnail/@url', views bigint path 'media:group/media:community/media:statistics/@views',
                    descr text path 'media:group/media:description') t
        ), ins as (
          insert into news_videos as v (video_id, channel_id, title, caption, published_at, updated_at, thumbnail, views, kind, language)
          select e.vid, f.channel_id, left(btrim(e.title), 300), news_video_caption(e.descr), e.pub, e.upd,
                 case when e.thumb ~ '^https://i[0-9]?\.ytimg\.com/' then e.thumb end, e.views, f.kind, f.language
          from e
          where e.vid ~ '^[A-Za-z0-9_-]{11}$' and e.ch = f.channel_id          -- the feed's own channel only
            and e.link like 'https://www.youtube.com/shorts/%'                 -- Shorts only
            and coalesce(btrim(e.title), '') <> '' and e.pub > now() - interval '14 days'
          on conflict (video_id) do update set title = excluded.title, caption = excluded.caption, views = excluded.views,
            updated_at = excluded.updated_at, thumbnail = coalesce(excluded.thumbnail, v.thumbnail), fetched_at = now()
          returning (xmax = 0) as inserted
        ) select count(*) filter (where inserted) into got from ins;
        n_new := n_new + coalesce(got, 0);
        update news_video_channels set last_ok_at = now(), last_error = null where channel_id = f.channel_id;
      exception when others then
        update news_video_channels set last_error = left('parse: ' || sqlerrm, 200) where channel_id = f.channel_id; n_err := n_err + 1;
      end;
    else
      update news_video_channels set last_error = left(coalesce('HTTP ' || f.status_code, f.error_msg, 'error'), 200) where channel_id = f.channel_id; n_err := n_err + 1;
    end if;
    delete from news_video_fetches where request_id = f.request_id;
  end loop;

  -- link new videos to a closely matching Lahza story (same language, last 36 h, trigram similarity ≥ 0.42)
  update news_videos v set related_article_id = (
      select a.id from news_articles a
      where a.status = 'published' and a.duplicate_of is null and a.published_at > v.published_at - interval '36 hours'
        and a.language = v.language and similarity(a.title, v.title) >= 0.42
      order by similarity(a.title, v.title) desc limit 1)
  where v.related_article_id is null and v.fetched_at > now() - interval '15 minutes';

  delete from news_videos where published_at < now() - interval '14 days';

  -- request feeds that are due (each channel at most every 9 minutes)
  with due as (
    select channel_id from news_video_channels
    where enabled and (last_fetch_at is null or last_fetch_at < now() - interval '9 minutes')
      and not exists (select 1 from news_video_fetches q where q.channel_id = news_video_channels.channel_id)
  ), req as (
    insert into news_video_fetches (request_id, channel_id)
    select net.http_get('https://www.youtube.com/feeds/videos.xml?playlist_id=UUSH' || substr(channel_id, 3),
                        timeout_milliseconds := 15000), channel_id from due
    returning channel_id
  ) update news_video_channels c set last_fetch_at = now() from req where req.channel_id = c.channel_id;
  get diagnostics n_req = row_count;

  return jsonb_build_object('new', n_new, 'requested', n_req, 'errors', n_err);
end $$;
revoke all on function public.news_videos_cycle() from public, anon, authenticated;
revoke all on function public.news_video_caption(text) from public, anon, authenticated;

select cron.schedule('news-videos', '2-59/10 * * * *', $$ select public.news_videos_cycle(); $$);
