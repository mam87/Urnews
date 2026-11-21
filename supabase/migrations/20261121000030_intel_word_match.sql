-- Global intelligence, fix after the first live run (2026-11-21):
-- 1) Terms are matched as whole words, not letter sequences ("rain" no longer matches "Ukraine", "car" no longer
--    matches "Carney"). Numbers-only and 3-letter terms are not fused.
-- 2) "Global" now also needs searches in more than one country: 3+ countries, or 2 countries and 5+ independent
--    publishers — a topic searched in one country is never labelled global, however much it is covered.

create or replace function public.intel_words(p text) returns text[]
language sql immutable set search_path = pg_catalog as $$
  select coalesce(array_remove(regexp_split_to_array(lower(coalesce(p, '')), '[\s[:punct:]،؛؟«»“”‘’…—–|｜]+'), ''), '{}')
$$;

-- whole-word (or whole-phrase) match of a lower-case term inside a word list
create or replace function public.intel_has_term(p_words text[], p_term text) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select case
    when array_length(public.intel_words(p_term), 1) = 1 then (public.intel_words(p_term))[1] = any(p_words)
    else position(' ' || array_to_string(public.intel_words(p_term), ' ') || ' ' in ' ' || array_to_string(p_words, ' ') || ' ') > 0
  end
$$;

create or replace function public.intel_trends_refresh() returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare n int;
begin
  with g as (
    select lower(btrim(t.title)) as key, min(t.title) as term, array_agg(distinct t.geo order by t.geo) as geos,
           count(distinct t.geo)::int as n_countries, max(t.traffic) as traffic_max, min(t.first_seen_at) as first_seen,
           max(t.seen_at) as last_seen, (array_agg(t.news order by t.traffic desc nulls last))[1] as news
    from news_trends t
    where t.seen_at > now() - interval '6 hours' and char_length(btrim(t.title)) between 4 and 120
      and btrim(t.title) !~ '^[0-9\s.,:/-]+$'
    group by lower(btrim(t.title))
  ), arts as (
    select x.id, x.published_at, x.category, coalesce(s.publisher, s.slug) as pub,
           intel_words(x.title) || intel_words(x.title_en) as w
    from news_articles x join news_sources s on s.id = x.source_id
    where x.status = 'published' and x.duplicate_of is null and x.published_at > now() - interval '24 hours'
  ), vids as (
    select v.video_id, v.popularity, v.section, intel_words(v.title) || intel_words(v.title_ar) as w
    from intel_yt_videos v where v.published_at > now() - interval '72 hours'
  ), hits as (
    select g.*, a.hits, a.publishers, a.ids, a.cat, vv.vhits, vv.vids
    from g
    left join lateral (
      select count(*)::int as hits, count(distinct x.pub)::int as publishers,
             (array_agg(x.id order by x.published_at desc))[1:3] as ids, mode() within group (order by x.category) as cat
      from arts x where intel_has_term(x.w, g.key)
    ) a on true
    left join lateral (
      select count(*)::int as vhits, (array_agg(v.video_id order by v.popularity desc nulls last))[1:3] as vids
      from vids v where intel_has_term(v.w, g.key)
    ) vv on true
  ), scored as (
    select h.*,
      ((h.n_countries > 0)::int + (h.hits > 0)::int + (h.vhits > 0)::int)::smallint as platforms,
      least(100, round(
          30 * least(1, h.n_countries / 5.0)
        + 20 * least(1, log(1 + coalesce(h.traffic_max, 0)) / 6)
        + 30 * least(1, coalesce(h.publishers, 0) / 5.0)
        + 20 * least(1, coalesce(h.vhits, 0) / 3.0)))::smallint as score
    from hits h
  )
  insert into intel_trends as t (key, term, term_is_ar, geos, n_countries, traffic_max, news_hits, news_publishers, video_hits, platforms,
                                 is_global, category, score, prev_score, direction, google_news, article_ids, video_ids, first_seen_at, last_seen_at, updated_at)
  select s.key, s.term, s.term ~ '[ء-ي]', s.geos, s.n_countries, s.traffic_max, coalesce(s.hits, 0), coalesce(s.publishers, 0), coalesce(s.vhits, 0), s.platforms,
         s.platforms >= 2 and (s.n_countries >= 3 or (s.n_countries >= 2 and coalesce(s.publishers, 0) >= 5)),
         coalesce(s.cat, (select v.section from intel_yt_videos v where v.video_id = s.vids[1])),
         s.score, null, 'new', coalesce(s.news, '[]'), coalesce(s.ids, '{}'), coalesce(s.vids, '{}'), s.first_seen, s.last_seen, now()
  from scored s
  on conflict (key) do update set
    term = excluded.term, geos = excluded.geos, n_countries = excluded.n_countries, traffic_max = excluded.traffic_max,
    news_hits = excluded.news_hits, news_publishers = excluded.news_publishers, video_hits = excluded.video_hits,
    platforms = excluded.platforms, is_global = excluded.is_global, category = excluded.category,
    prev_score = t.score, score = excluded.score,
    direction = case when excluded.score > t.score + 4 then 'up' when excluded.score < t.score - 4 then 'down' else 'flat' end,
    google_news = excluded.google_news, article_ids = excluded.article_ids, video_ids = excluded.video_ids,
    first_seen_at = least(t.first_seen_at, excluded.first_seen_at), last_seen_at = excluded.last_seen_at, updated_at = now();
  get diagnostics n = row_count;

  -- terms that no longer qualify (numbers, 3 letters) or were not seen for 48 hours
  delete from intel_trends where last_seen_at < now() - interval '48 hours' or char_length(key) < 4 or key ~ '^[0-9\s.,:/-]+$';
  return jsonb_build_object('trends', n);
end $$;

-- the video ↔ search-trend link uses the same whole-word rule
create or replace function public.intel_video_trend_match() returns int
language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare n int;
begin
  with t as (
    select lower(btrim(title)) as key, title, traffic from news_trends
    where seen_at > now() - interval '12 hours' and char_length(btrim(title)) >= 4 and btrim(title) !~ '^[0-9\s.,:/-]+$'
  )
  update intel_yt_videos v set trend_match = (
    select t.title from t where intel_has_term(intel_words(v.title), t.key) order by t.traffic desc nulls last limit 1)
  where v.published_at > now() - interval '3 days';
  get diagnostics n = row_count;
  return n;
end $$;

-- the collector now calls the whole-word matcher (only that step changed)
create or replace function public.intel_youtube_cycle() returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare
  f record; n_new int := 0; n_req int := 0; n_err int := 0; got int;
begin
  for f in
    select q.request_id, q.channel_id, q.created_at, r.id as rid, r.status_code, r.content, r.error_msg, c.language, c.section
    from intel_yt_fetches q
    join intel_yt_channels c using (channel_id)
    left join net._http_response r on r.id = q.request_id
  loop
    if f.rid is null then
      if f.created_at > now() - interval '15 minutes' then continue; end if;
      update intel_yt_channels set last_error = 'no response' where channel_id = f.channel_id; n_err := n_err + 1;
    elsif f.status_code = 200 and f.content like '%<feed%' then
      begin
        with e as (
          select t.* from xmltable(
            xmlnamespaces('http://www.w3.org/2005/Atom' as a, 'http://www.youtube.com/xml/schemas/2015' as yt, 'http://search.yahoo.com/mrss/' as media),
            '/a:feed/a:entry' passing xmlparse(document f.content)
            columns vid text path 'yt:videoId', ch text path 'yt:channelId', title text path 'a:title', pub timestamptz path 'a:published',
                    link text path 'a:link/@href', thumb text path 'media:group/media:thumbnail/@url',
                    views bigint path 'media:group/media:community/media:statistics/@views',
                    likes bigint path 'media:group/media:community/media:starRating/@count',
                    descr text path 'media:group/media:description') t
        ), ok as (
          select * from e
          where e.vid ~ '^[A-Za-z0-9_-]{11}$' and e.ch = f.channel_id
            and e.link like 'https://www.youtube.com/watch?v=%'                -- long-form only (no Shorts)
            and coalesce(btrim(e.title), '') <> '' and e.pub > now() - interval '10 days'
        ), ins as (
          insert into intel_yt_videos as v (video_id, channel_id, title, description, language, section, published_at, thumbnail, views, likes)
          select ok.vid, f.channel_id, left(btrim(ok.title), 300), news_video_caption(ok.descr), f.language,
                 intel_video_section(ok.title, f.section), ok.pub,
                 case when ok.thumb ~ '^https://i[0-9]?\.ytimg\.com/' then ok.thumb end, ok.views, ok.likes
          from ok
          on conflict (video_id) do update set
            title = excluded.title, description = excluded.description, views = excluded.views, likes = excluded.likes,
            thumbnail = coalesce(excluded.thumbnail, v.thumbnail), fetched_at = now(),
            title_ar = case when v.title = excluded.title then v.title_ar end,
            tr_tries = case when v.title = excluded.title then v.tr_tries else 0 end
          returning (xmax = 0) as inserted
        ) select count(*) filter (where inserted) into got from ins;
        n_new := n_new + coalesce(got, 0);
        -- one snapshot per video per ~20 minutes (only while the video is young enough to trend)
        insert into intel_yt_stats (video_id, views, likes)
        select v.video_id, v.views, v.likes from intel_yt_videos v
        where v.channel_id = f.channel_id and v.views is not null and v.published_at > now() - interval '7 days'
          and not exists (select 1 from intel_yt_stats s where s.video_id = v.video_id and s.at > now() - interval '20 minutes');
        update intel_yt_channels set last_ok_at = now(), last_error = null where channel_id = f.channel_id;
      exception when others then
        update intel_yt_channels set last_error = left('parse: ' || sqlerrm, 200) where channel_id = f.channel_id; n_err := n_err + 1;
      end;
    else
      update intel_yt_channels set last_error = left(coalesce('HTTP ' || f.status_code, f.error_msg, 'error'), 200) where channel_id = f.channel_id; n_err := n_err + 1;
    end if;
    delete from intel_yt_fetches where request_id = f.request_id;
  end loop;

  -- link new videos to the closest Lahza report (same language, last 48 h) and count that event's independent publishers
  update intel_yt_videos v set related_article_id = (
    select a.id from news_articles a
    where a.status = 'published' and a.duplicate_of is null and a.published_at > v.published_at - interval '48 hours'
      and a.language = v.language
      and similarity(a.title, regexp_replace(v.title, '\s*[|｜]\s*[^|｜]*$', '')) >= 0.35
    order by similarity(a.title, regexp_replace(v.title, '\s*[|｜]\s*[^|｜]*$', '')) desc limit 1)
  where v.related_article_id is null and v.first_seen_at > now() - interval '20 minutes';

  update intel_yt_videos v set related_publishers = least(30, coalesce(g.publisher_count, 1))
  from news_articles a left join news_global_events g on g.cluster_id = a.cluster_id and a.cluster_id is not null
  where v.related_article_id = a.id and v.published_at > now() - interval '7 days';

  -- a Google Trends term found as a whole word in the title
  perform intel_video_trend_match();

  perform intel_youtube_score();

  delete from intel_yt_stats where at < now() - interval '3 days';
  delete from intel_yt_videos where published_at < now() - interval '10 days';

  -- request feeds that are due: every channel about every 30 minutes, spread over the 10-minute runs
  with due as (
    select channel_id from intel_yt_channels
    where enabled and (last_fetch_at is null or last_fetch_at < now() - interval '25 minutes')
      and not exists (select 1 from intel_yt_fetches q where q.channel_id = intel_yt_channels.channel_id)
    order by last_fetch_at nulls first limit 20
  ), req as (
    insert into intel_yt_fetches (request_id, channel_id)
    select net.http_get('https://www.youtube.com/feeds/videos.xml?playlist_id=UULF' || substr(channel_id, 3),
                        timeout_milliseconds := 15000), channel_id from due
    returning channel_id
  ) update intel_yt_channels c set last_fetch_at = now() from req where req.channel_id = c.channel_id;
  get diagnostics n_req = row_count;

  return jsonb_build_object('new', n_new, 'requested', n_req, 'errors', n_err);
end $$;

revoke all on function public.intel_trends_refresh(), public.intel_video_trend_match(), public.intel_youtube_cycle(),
  public.intel_words(text), public.intel_has_term(text[], text) from public, anon, authenticated;

