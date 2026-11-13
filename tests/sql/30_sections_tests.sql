-- Sections (science / nature / opinion), translation lane and search trends (migration 28).
-- Runs after 10_db_tests.sql and 20_story_tests.sql (sources 1 alpha, 2 beta).
\set ON_ERROR_STOP 1
create or replace function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'ok - %', label;
end $$;
reset role;
set request.jwt.claim.sub = '';

-- section rules
select pg_temp.ok(public.news_topic_category('ناسا تعلن موعد إطلاق مسبار جديد إلى المريخ', 'world', null) = 'science', 'space headline goes to science');
select pg_temp.ok(public.news_topic_category('دراسة: لقاح جديد يدرسه علماء الفلك', 'health', null) = 'health', 'medical words keep a story in health');
select pg_temp.ok(public.news_topic_category('إنقاذ الحيتان العالقة قبالة الساحل', 'world', null) = 'nature', 'animals headline goes to nature');
select pg_temp.ok(public.news_topic_category('New species of frog found', 'health', 'science') = 'nature', 'English animal words are recognised');
select pg_temp.ok(public.news_topic_category('الحكومة تقر الموازنة', 'politics', null) = 'politics', 'unrelated headline keeps its section');
select pg_temp.ok(public.news_topic_category('اشتباكات قرب حديقة الحيوان', 'security', null) = 'security', 'security stories are never moved');
select pg_temp.ok(public.news_topic_category('أي عنوان', 'world', 'opinion') = 'opinion', 'an opinion feed is always opinion');

-- trigger: source beat wins; opinion is never breaking and is listed only in its own section
insert into public.news_sources (slug, name_ar, homepage, feed_url, reliability, default_category, language) values
  ('sci', 'علوم', 'https://sci.example/', 'https://sci.example/rss', 4, 'science', 'en'),
  ('op',  'رأي',  'https://op.example/',  'https://op.example/rss',  4, 'opinion', 'en');
insert into public.news_articles (source_id, guid, url, url_hash, title, summary, summary_kind, category, categories, published_at, language, is_breaking, breaking_until) values
  ((select id from public.news_sources where slug = 'sci'), 'n1', 'https://sci.example/1', repeat('5', 63) || 'a', 'Physicists measure something new', 'An English excerpt.', 'feed', 'world', '{world}', now() - interval '5 minutes', 'en', false, null),
  ((select id from public.news_sources where slug = 'op'),  'n2', 'https://op.example/1',  repeat('5', 63) || 'b', 'Why the summit matters', 'Another English excerpt.', 'feed', 'politics', '{politics,world}', now() - interval '4 minutes', 'en', true, now() + interval '2 hours');
select pg_temp.ok((select category = 'science' and categories @> '{science,world}' from public.news_articles where guid = 'n1'), 'science feed item lands in science and keeps its other tags');
select pg_temp.ok((select category = 'opinion' and categories = '{opinion}' and not is_breaking and breaking_until is null from public.news_articles where guid = 'n2'), 'opinion item: own section only, never breaking');
select pg_temp.ok(not exists (select 1 from public.news_rank_input(12) r join public.news_articles a on a.id = r.id where a.category = 'opinion'), 'opinion never enters the global ranking');

-- translation lane
set role service_role;
select pg_temp.ok((select count(*) from public.news_translate_take(10)) = 2, 'translation lane hands out untranslated feature items');
select pg_temp.ok((select count(*) from public.news_translate_take(10)) = 2, 'second attempt allowed');
select pg_temp.ok((select count(*) from public.news_translate_take(10)) = 0, 'no third attempt');
select pg_temp.ok(public.news_set_translations(jsonb_build_array(
  jsonb_build_object('id', (select id from public.news_articles where guid = 'n1'), 'title', 'فيزيائيون يقيسون شيئاً جديداً', 'summary', 'ملخص عربي.'),
  jsonb_build_object('id', (select id from public.news_articles where guid = 'n2'), 'title', 'لماذا تهم القمة'))) = 2, 'translations saved');
reset role;
select pg_temp.ok((select language = 'ar' and translated and summary = 'ملخص عربي.' and summary_kind = 'ai' and title_en = 'Physicists measure something new' from public.news_articles where guid = 'n1'), 'translated with an Arabic summary');
select pg_temp.ok((select summary is null and summary_kind = 'none' from public.news_articles where guid = 'n2'), 'no English excerpt is left under an Arabic headline');
select pg_temp.ok(public.news_translate_tick() is null, 'translation tick is idle when nothing is waiting');

-- search trends: parse one feed response
insert into net._http_response (id, status_code, content) values (990001, 200,
'<?xml version="1.0" encoding="UTF-8"?><rss xmlns:ht="https://trends.google.com/trending/rss" version="2.0"><channel>
<item><title>قهوة</title><ht:approx_traffic>2000+</ht:approx_traffic><pubDate>Thu, 12 Nov 2026 22:50:00 -0800</pubDate>
<ht:news_item><ht:news_item_title>عنوان خبر</ht:news_item_title><ht:news_item_url>https://example.com/a</ht:news_item_url><ht:news_item_source>مصدر</ht:news_item_source></ht:news_item>
<ht:news_item><ht:news_item_title>bad</ht:news_item_title><ht:news_item_url>javascript:alert(1)</ht:news_item_url><ht:news_item_source>x</ht:news_item_source></ht:news_item></item>
<item><title>World Cup</title><ht:approx_traffic>1M+</ht:approx_traffic><pubDate>nonsense</pubDate></item></channel></rss>');
insert into public.news_trend_fetches (request_id, geo) values (990001, 'JO');
select pg_temp.ok((public.news_trends_cycle() ->> 'ok')::int = 1, 'trends feed parsed');
select pg_temp.ok((select rank = 1 and traffic = 2000 and started_at = '2026-11-13 06:50:00+00' and jsonb_array_length(news) = 1 and news -> 0 ->> 'u' = 'https://example.com/a' from public.news_trends where geo = 'JO' and title = 'قهوة'), 'trend row: rank, volume, time, only https news links');
select pg_temp.ok((select traffic = 1000000 and started_at is null from public.news_trends where geo = 'JO' and title = 'World Cup'), 'trend row: 1M+ volume, bad date ignored');
select pg_temp.ok((select last_ok_at is not null and last_error is null from public.news_trend_geos where geo = 'JO'), 'geo marked healthy');
set role anon;
select pg_temp.ok((select count(*) from public.news_trends) = 2, 'anon can read trends');
select pg_temp.ok((select count(*) from public.news_trend_geos) >= 20, 'anon can read the country list');
reset role;
