-- Global intelligence (migration 29): YouTube analysis feeds, scores, fused trends, translation lane, permissions.
\set ON_ERROR_STOP 1
create or replace function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'ok - %', label;
end $$;
reset role;
set request.jwt.claim.sub = '';

-- whole-word matching
select pg_temp.ok(public.intel_has_term(public.intel_words('Ukraine war: front line update'), 'rain') = false, 'rain does not match Ukraine');
select pg_temp.ok(public.intel_has_term(public.intel_words('Heavy rain floods the city'), 'rain'), 'rain matches the word rain');
select pg_temp.ok(public.intel_has_term(public.intel_words('Carney meets leaders'), 'car') = false, 'car does not match Carney');
select pg_temp.ok(public.intel_has_term(public.intel_words('Real Madrid win, Champions League'), 'champions league'), 'two-word phrase matches');
select pg_temp.ok(public.intel_has_term(public.intel_words('قمة «إسرائيل» والعراق؟'), 'إسرائيل'), 'Arabic word matches through punctuation');

-- sections
select pg_temp.ok(public.intel_video_section('Missile strikes hit the front line', 'politics') = 'war', 'war words move a newsroom video to war');
select pg_temp.ok(public.intel_video_section('غارات جوية على مواقع عسكرية', 'politics') = 'war', 'Arabic war words recognised');
select pg_temp.ok(public.intel_video_section('Why inflation is falling', 'politics') = 'economy', 'economy words from a newsroom');
select pg_temp.ok(public.intel_video_section('New vaccine trial results', 'politics') = 'medical', 'health words go to medical');
select pg_temp.ok(public.intel_video_section('The new electric SUV tested', 'automotive') = 'automotive', 'specialist channels keep their beat');
select pg_temp.ok(public.intel_video_section('Election results explained', 'politics') = 'politics', 'plain politics stays politics');

-- one long-form feed: a regular video, a Short (skipped), a foreign channel entry (skipped), a too-old video (skipped)
insert into net._http_response (id, status_code, content) values (991001, 200,
'<?xml version="1.0" encoding="UTF-8"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
<entry><yt:videoId>AAAAAAAAAA1</yt:videoId><yt:channelId>UC0p5jTq6Xx_DosDFxVXnWaQ</yt:channelId><title>Why the summit matters | The Economist</title>
<link rel="alternate" href="https://www.youtube.com/watch?v=AAAAAAAAAA1"/><published>' || to_char(now() - interval '5 hours', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"') || '</published>
<media:group><media:thumbnail url="https://i1.ytimg.com/vi/AAAAAAAAAA1/hqdefault.jpg"/><media:description>Our analysis of the summit.

Subscribe http://x</media:description><media:community><media:starRating count="2000" average="5.00"/><media:statistics views="50000"/></media:community></media:group></entry>
<entry><yt:videoId>AAAAAAAAAA2</yt:videoId><yt:channelId>UC0p5jTq6Xx_DosDFxVXnWaQ</yt:channelId><title>A short</title>
<link rel="alternate" href="https://www.youtube.com/shorts/AAAAAAAAAA2"/><published>' || to_char(now() - interval '1 hours', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"') || '</published>
<media:group><media:community><media:statistics views="10"/></media:community></media:group></entry>
<entry><yt:videoId>AAAAAAAAAA3</yt:videoId><yt:channelId>UCxxxxxxxxxxxxxxxxxxxxxx</yt:channelId><title>Injected</title>
<link rel="alternate" href="https://www.youtube.com/watch?v=AAAAAAAAAA3"/><published>' || to_char(now() - interval '1 hours', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"') || '</published></entry>
<entry><yt:videoId>AAAAAAAAAA4</yt:videoId><yt:channelId>UC0p5jTq6Xx_DosDFxVXnWaQ</yt:channelId><title>Old video</title>
<link rel="alternate" href="https://www.youtube.com/watch?v=AAAAAAAAAA4"/><published>' || to_char(now() - interval '20 days', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"') || '</published></entry>
</feed>');
insert into public.intel_yt_fetches (request_id, channel_id) values (991001, 'UC0p5jTq6Xx_DosDFxVXnWaQ');
select pg_temp.ok((public.intel_youtube_cycle() ->> 'new')::int = 1, 'feed parsed: one new long-form video');
select pg_temp.ok((select count(*) from public.intel_yt_videos where video_id in ('AAAAAAAAAA2', 'AAAAAAAAAA3', 'AAAAAAAAAA4')) = 0, 'Shorts, foreign-channel and old entries skipped');
select pg_temp.ok((select views = 50000 and likes = 2000 and section = 'economy' and description = 'Our analysis of the summit.' and language = 'en'
  from public.intel_yt_videos where video_id = 'AAAAAAAAAA1'), 'video row: views, likes, section, first caption paragraph');
select pg_temp.ok((select count(*) from public.intel_yt_stats where video_id = 'AAAAAAAAAA1') = 1, 'one view snapshot stored');
select pg_temp.ok((select popularity between 1 and 100 and editorial between 1 and 100 and score_parts ? 'velocity' and score_parts ? 'source'
  from public.intel_yt_videos where video_id = 'AAAAAAAAAA1'), 'both scores computed with their parts');
select pg_temp.ok((select editorial = 35 + 20 + 0 + 15 from public.intel_yt_videos where video_id = 'AAAAAAAAAA1'), 'editorial = tier 5 + economy + no coverage + analysis format');
select pg_temp.ok((select last_ok_at is not null and last_error is null from public.intel_yt_channels where channel_id = 'UC0p5jTq6Xx_DosDFxVXnWaQ'), 'channel marked healthy');
select pg_temp.ok((select count(*) from public.intel_yt_fetches) between 1 and 20, 'due channels requested (at most 20 per run)');

-- velocity from snapshots: 50,000 views 2 h ago, 70,000 now → 10,000 views/hour
update public.intel_yt_stats set at = now() - interval '2 hours' where video_id = 'AAAAAAAAAA1';
update public.intel_yt_videos set views = 70000 where video_id = 'AAAAAAAAAA1';
select public.intel_youtube_score();
select pg_temp.ok((select vph between 9900 and 10100 and (score_parts ->> 'measured')::boolean from public.intel_yt_videos where video_id = 'AAAAAAAAAA1'), 'velocity measured from snapshots');
select pg_temp.ok((select popularity <= 100 from public.intel_yt_videos where video_id = 'AAAAAAAAAA1'), 'popularity capped at 100');

-- an error response
insert into net._http_response (id, status_code, content) values (991002, 404, 'not found');
insert into public.intel_yt_fetches (request_id, channel_id) values (991002, 'UCddiUEpeqJcYeBxX1IVBKvQ') on conflict do nothing;
select public.intel_youtube_cycle();
select pg_temp.ok((select last_error = 'HTTP 404' from public.intel_yt_channels where channel_id = 'UCddiUEpeqJcYeBxX1IVBKvQ'), 'HTTP error recorded, nothing invented');

-- fused trends: one term searched in 3 countries and found in a Lahza report and in the video → global
insert into public.news_trends (geo, title, rank, traffic, seen_at) values
  ('JO', 'summit', 1, 5000, now()), ('SA', 'summit', 2, 2000, now()), ('EG', 'Summit', 3, 1000, now()),
  ('JO', 'local fair', 4, 100, now()), ('JO', 'leaders', 5, 100, now()), ('JO', '2027', 6, 100, now());
insert into public.news_articles (source_id, guid, url, url_hash, title, summary, summary_kind, category, categories, published_at, language)
values (1, 'i1', 'https://alpha.example/i1', repeat('6', 64), 'Leaders gather for the summit', null, 'none', 'politics', '{politics}', now() - interval '1 hour', 'en');
select pg_temp.ok((public.intel_trends_refresh() ->> 'trends')::int >= 2, 'trend terms fused');
select pg_temp.ok((select count(*) from public.intel_trends where key in ('summit', 'local fair')) = 2, 'case-insensitive: one row per term across countries');
select pg_temp.ok((select n_countries = 3 and news_hits >= 1 and video_hits = 1 and platforms = 3 and is_global and geos = '{EG,JO,SA}'
  from public.intel_trends where key = 'summit'), 'summit: 3 countries, news + YouTube → global');
select pg_temp.ok((select not is_global and platforms = 1 from public.intel_trends where key = 'local fair'), 'one platform in one country is never global');
select pg_temp.ok((select not is_global and platforms >= 2 from public.intel_trends where key = 'leaders'), 'searched in one country is never global, even when covered');
select pg_temp.ok(not exists (select 1 from public.intel_trends where key = '2027'), 'numbers-only terms are not fused');
select pg_temp.ok((select direction = 'new' from public.intel_trends where key = 'summit'), 'new trend marked new');
select public.intel_trends_refresh();
select pg_temp.ok((select direction = 'flat' and prev_score is not null from public.intel_trends where key = 'summit'), 'second run compares with the previous score');

-- translation lane
set role service_role;
create temp table took as select * from public.intel_translate_take(10);
select pg_temp.ok((select count(*) filter (where kind = 'video') = 1 and count(*) filter (where kind = 'trend') >= 1 from took), 'lane hands out the top video and multi-platform English trends');
select pg_temp.ok(public.intel_set_translations((select jsonb_agg(jsonb_build_object('kind', kind, 'id', id, 'title',
  case kind when 'video' then 'لماذا تهم القمة' else 'القمة' end)) from took)) = (select count(*) from took), 'translations saved');
reset role;
select pg_temp.ok((select title_ar = 'لماذا تهم القمة' from public.intel_yt_videos where video_id = 'AAAAAAAAAA1'), 'video has an Arabic title');
select pg_temp.ok((select term_ar = 'القمة' from public.intel_trends where key = 'summit'), 'trend has an Arabic name');
select pg_temp.ok(public.intel_translate_tick() is null, 'translation tick is idle when nothing is waiting');

-- permissions
set role anon;
select pg_temp.ok((select count(*) from public.intel_yt_videos) = 1, 'anon reads videos');
select pg_temp.ok((select count(*) from public.intel_trends where key in ('summit', 'local fair')) = 2, 'anon reads trends');
select pg_temp.ok((select count(*) from public.intel_yt_channels) >= 40, 'anon reads the channel list');
reset role;
create or replace function pg_temp.denied(q text) returns boolean language plpgsql as $$
begin execute q; return false; exception when insufficient_privilege then return true; end $$;
set role anon;
select pg_temp.ok(pg_temp.denied($$select tr_tries from public.intel_yt_videos$$), 'anon cannot read internal columns');
select pg_temp.ok(pg_temp.denied($$select * from public.intel_yt_stats$$), 'anon cannot read raw snapshots');
select pg_temp.ok(pg_temp.denied($$select public.intel_youtube_cycle()$$), 'anon cannot run the collector');
select pg_temp.ok(pg_temp.denied($$update public.intel_yt_channels set tier = 1$$), 'anon cannot change channels');
reset role;
update public.intel_yt_channels set enabled = false where channel_id = 'UC0p5jTq6Xx_DosDFxVXnWaQ';
set role anon;
select pg_temp.ok((select count(*) from public.intel_yt_videos) = 0, 'videos of a disabled channel are hidden');
reset role;
update public.intel_yt_channels set enabled = true where channel_id = 'UC0p5jTq6Xx_DosDFxVXnWaQ';
