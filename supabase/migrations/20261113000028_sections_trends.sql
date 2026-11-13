-- 2026-11-13: new sections (science, nature & animals, opinion & analysis), worldwide search trends,
-- a guaranteed translation lane for those sections, and a fix for English excerpts under Arabic headlines.
-- Additive: existing tables keep their columns; the ingest Edge Function is unchanged.

-- 1) Sections -----------------------------------------------------------------------------------
insert into public.news_categories (slug, name_ar, sort_order) values
  ('health',  'صحة',               8),
  ('science', 'علوم وفضاء',        15),
  ('nature',  'طبيعة وحيوانات',    16),
  ('opinion', 'مقالات وتحليلات',   17)
on conflict (slug) do update set name_ar = excluded.name_ar, sort_order = excluded.sort_order;

-- Section chosen from the source's own beat, or from unmistakable words in the headline.
-- Runs in the database (before insert) so the ingest function does not need to know the new sections.
create or replace function public.news_topic_category(p_title text, p_category text, p_source_default text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_source_default = 'opinion' then 'opinion'
    when (p_source_default in ('science', 'nature') or p_category in ('health', 'world', 'tech', 'environment', 'education', 'arab', 'entertainment'))
      and (p_title ~ '(الحياة البرية|حيوانات|الحيوانات|حديقة الحيوان|محمية طبيعية|المحميات الطبيعية|مهددة? بالانقراض|خطر الانقراض|الشعاب المرجانية|الحيتان|أسماك القرش|سمكة قرش|الفيلة|الدببة|الباندا|الطيور المهاجرة|هجرة الطيور|التنوع البيولوجي|التنوع الحيوي|الغابات المطيرة|السلاحف|الدلافين|وحيد القرن|الحشرات|النحل|فصيلة جديدة|نوع جديد من)'
        or p_title ~* '\m(wildlife|animals?|species|birds?|whales?|sharks?|elephants?|dolphins?|turtles?|insects?|bees|endangered|extinction|coral|rainforests?|zoo|biodiversity)\M')
      then 'nature'
    when p_source_default in ('science', 'nature') then p_source_default
    when p_category in ('health', 'world', 'tech', 'environment', 'education', 'arab')
      and p_title ~ '(ناسا|وكالة الفضاء|محطة الفضاء|(رائد|رواد) فضاء|مركبة فضائية|مسبار|تلسكوب|علم الفلك|علماء الفلك|مجرة|المجرات|ثقب أسود|الثقوب السوداء|كويكب|نيزك|المريخ|كوكب المشتري|كوكب زحل|الكواكب|النظام الشمسي|كسوف|خسوف|فيزياء|الفيزياء|ميكانيكا الكم|أحفورة|أحافير|ديناصور|الديناصورات|علم الآثار|علماء الآثار|اكتشاف علمي|جائزة نوبل في (الفيزياء|الكيمياء|الطب))'
      and p_title !~ '(مرض|أمراض|علاج|لقاح|فيروس|سرطان|السكري|مستشفى|وباء|دواء)'
      then 'science'
    else p_category end;
$$;

create or replace function public.news_articles_topic_trg()
returns trigger language plpgsql set search_path = '' as $$
declare d text; c text;
begin
  select default_category into d from public.news_sources where id = new.source_id;
  c := public.news_topic_category(new.title, new.category, d);
  if c = 'opinion' then
    -- commentary is never breaking news and is listed only in its own section
    new.category := 'opinion'; new.categories := array['opinion'];
    new.is_breaking := false; new.breaking_until := null;
  elsif c is distinct from new.category then
    new.categories := array(select distinct x from unnest(array_append(new.categories, c)) x);
    new.category := c;
  end if;
  return new;
end $$;
drop trigger if exists articles_topic on public.news_articles;
create trigger articles_topic before insert on public.news_articles
  for each row execute function public.news_articles_topic_trg();

-- Commentary never enters the global event ranking / breaking selection.
create or replace function public.news_rank_input(p_hours int default 12)
returns table (id bigint, cluster_id bigint, source_id int, publisher text, reliability smallint, official boolean,
               published_at timestamptz, language text, title text, title_en text, summary text, countries text[],
               event_type text, impact smallint, wire text, verification text, title_tokens text[], category text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.cluster_id, a.source_id, coalesce(s.publisher, s.slug), s.reliability, s.kind = 'official',
         a.published_at, a.language, a.title, a.title_en, left(a.summary, 300), a.countries,
         a.event_type, a.impact, a.wire, a.verification, a.title_tokens, a.category
  from public.news_articles a join public.news_sources s on s.id = a.source_id
  where a.published_at > now() - make_interval(hours => least(greatest(p_hours, 1), 24))
    and a.status = 'published' and a.duplicate_of is null and a.category <> 'opinion'
    and (a.impact >= 8 or a.cluster_id is not null or a.event_type is null)
  order by a.published_at desc
  limit 1500;
$$;
revoke execute on function public.news_rank_input(int) from public, anon, authenticated;
grant execute on function public.news_rank_input(int) to service_role;

-- 2) Sources (every feed answered 200 with items on 2026-11-13) --------------------------------
update public.news_sources set default_category = 'science', topical = false, name_ar = 'دويتشه فيله — علوم' where slug = 'dw-ar-science';

insert into public.news_sources (slug, name_ar, name_en, homepage, feed_url, language, country, kind, reliability,
  default_category, topical, tz_offset_minutes, poll_interval_minutes, min_interval_minutes, max_items, enabled, allow_images, publisher, terms_note) values
  ('bbc-ar-scitech', 'بي بي سي عربي — علوم وتكنولوجيا', 'BBC Arabic Science & Tech', 'https://www.bbc.com/arabic', 'https://feeds.bbci.co.uk/arabic/scienceandtech/rss.xml', 'ar', 'GB', 'media', 5, 'science', false, 0, 15, 5, 12, true, false, 'bbc', 'BBC RSS: headlines + links'),
  ('sciencedaily', 'ساينس ديلي', 'ScienceDaily', 'https://www.sciencedaily.com/', 'https://www.sciencedaily.com/rss/all.xml', 'en', 'US', 'media', 4, 'science', false, 0, 30, 10, 8, true, false, 'sciencedaily', 'Public RSS; headlines + links; translated'),
  ('nasa-news', 'ناسا', 'NASA', 'https://www.nasa.gov/', 'https://www.nasa.gov/feed/', 'en', 'US', 'official', 5, 'science', false, 0, 30, 10, 8, true, true, null, 'NASA content is generally not copyrighted; headlines + links; translated'),
  ('newscientist', 'نيو ساينتست', 'New Scientist', 'https://www.newscientist.com/', 'https://www.newscientist.com/feed/home/', 'en', 'GB', 'media', 4, 'science', false, 0, 30, 10, 8, true, false, null, 'Public RSS; headlines + links; translated'),
  ('guardian-science', 'الغارديان — علوم', 'The Guardian Science', 'https://www.theguardian.com/science', 'https://www.theguardian.com/science/rss', 'en', 'GB', 'media', 4, 'science', false, 0, 20, 5, 8, true, false, 'guardian-world', 'Public RSS; headlines + links; translated'),
  ('space-com', 'سبيس دوت كوم', 'Space.com', 'https://www.space.com/', 'https://www.space.com/feeds/all', 'en', 'US', 'media', 4, 'science', false, 0, 30, 10, 6, true, false, null, 'Public RSS; headlines + links; translated'),
  ('livescience', 'لايف ساينس', 'Live Science', 'https://www.livescience.com/', 'https://www.livescience.com/feeds/all', 'en', 'US', 'media', 4, 'science', false, 0, 30, 10, 6, true, false, null, 'Public RSS; headlines + links; translated'),
  ('mongabay', 'مونغاباي', 'Mongabay', 'https://news.mongabay.com/', 'https://news.mongabay.com/feed/', 'en', 'US', 'media', 4, 'nature', false, 0, 30, 10, 8, true, false, null, 'Public RSS; headlines + links; translated'),
  ('guardian-wildlife', 'الغارديان — حياة برية', 'The Guardian Wildlife', 'https://www.theguardian.com/environment/wildlife', 'https://www.theguardian.com/environment/wildlife/rss', 'en', 'GB', 'media', 4, 'nature', false, 0, 30, 5, 8, true, false, 'guardian-world', 'Public RSS; headlines + links; translated'),
  ('sciencedaily-animals', 'ساينس ديلي — نبات وحيوان', 'ScienceDaily Plants & Animals', 'https://www.sciencedaily.com/news/plants_animals/', 'https://www.sciencedaily.com/rss/plants_animals.xml', 'en', 'US', 'media', 4, 'nature', false, 0, 30, 10, 8, true, false, 'sciencedaily', 'Public RSS; headlines + links; translated'),
  ('earth-com', 'إيرث دوت كوم', 'Earth.com', 'https://www.earth.com/', 'https://www.earth.com/feed/', 'en', 'US', 'media', 3, 'nature', false, 0, 30, 10, 6, true, false, null, 'Public RSS; headlines + links; translated'),
  ('smithsonian-nature', 'مجلة سميثسونيان — علوم وطبيعة', 'Smithsonian Magazine Science & Nature', 'https://www.smithsonianmag.com/science-nature/', 'https://www.smithsonianmag.com/rss/science-nature/', 'en', 'US', 'media', 4, 'nature', false, 0, 60, 15, 6, true, false, null, 'Public RSS; headlines + links; translated'),
  ('aawsat-opinion', 'الشرق الأوسط — الرأي', 'Asharq Al-Awsat Opinion', 'https://aawsat.com/', 'https://aawsat.com/feed/opinion', 'ar', 'SA', 'media', 4, 'opinion', false, 0, 30, 10, 10, true, false, 'aawsat', 'Public RSS (opinion section); headlines + links'),
  ('guardian-opinion', 'الغارديان — رأي', 'The Guardian Opinion', 'https://www.theguardian.com/commentisfree', 'https://www.theguardian.com/commentisfree/rss', 'en', 'GB', 'media', 4, 'opinion', false, 0, 30, 5, 8, true, false, 'guardian-world', 'Public RSS; headlines + links; translated'),
  ('theconversation', 'ذا كونفرسيشن', 'The Conversation', 'https://theconversation.com/global', 'https://theconversation.com/global/articles.atom', 'en', 'AU', 'media', 4, 'opinion', false, 0, 30, 10, 8, true, false, null, 'Articles are CC BY-ND; headlines + links; translated')
on conflict (slug) do nothing;

-- 3) Arabic headline + English excerpt: the late translation kept the publisher's English excerpt.
create or replace function public.news_set_translations(p jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.news_articles a set
    title_original = a.title, title = left(r.title, 400), title_tokens = coalesce(r.title_tokens, a.title_tokens),
    summary = case when a.summary_kind = 'editor' then a.summary when r.summary is not null then left(r.summary, 1000) else null end,
    summary_kind = case when a.summary_kind = 'editor' then a.summary_kind when r.summary is not null then 'ai' else 'none' end,
    translated = true, language = 'ar', title_en = coalesce(a.title_en, a.title)
  from jsonb_to_recordset(p) as r(id bigint, title text, summary text, title_tokens text[])
  where a.id = r.id and not a.translated and not a.edited and a.language = 'en'
    and char_length(r.title) between 3 and 400;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.news_set_translations(jsonb) from public, anon, authenticated;
grant execute on function public.news_set_translations(jsonb) to service_role;

update public.news_articles set summary = null, summary_kind = 'none'
where language = 'ar' and translated and summary_kind <> 'editor' and summary is not null and summary !~ '[ء-ي]';

-- 4) Translation lane for the feature sections (Edge Function news-translate, every 5 minutes) ---
-- The ingest run translates the biggest world events first, so science / nature / opinion headlines from
-- English publishers were mostly left in English. This lane translates them in small batches from the same
-- daily AI budget (news_ai_take), at most twice per article.
create table if not exists public.news_translate_attempts (
  article_id bigint primary key references public.news_articles(id) on delete cascade,
  tries smallint not null default 0,
  last_try_at timestamptz not null default now()
);
alter table public.news_translate_attempts enable row level security;
revoke all on public.news_translate_attempts from anon, authenticated;

create or replace function public.news_translate_take(p_limit int default 10)
returns table (id bigint, title text, summary text, source_name text)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with pick as (
    select a.id from public.news_articles a
    left join public.news_translate_attempts t on t.article_id = a.id
    where a.language = 'en' and not a.translated and not a.edited and a.status = 'published' and a.duplicate_of is null
      and a.category in ('science', 'nature', 'opinion') and a.published_at > now() - interval '36 hours'
      and coalesce(t.tries, 0) < 2
    order by a.published_at desc limit least(greatest(p_limit, 1), 12)
  ), mark as (
    insert into public.news_translate_attempts as t (article_id, tries) select pick.id, 1 from pick
    on conflict (article_id) do update set tries = t.tries + 1, last_try_at = now()
    returning article_id
  )
  select a.id, a.title, case when s.allow_excerpt then left(a.summary, 600) end, s.name_ar
  from mark join public.news_articles a on a.id = mark.article_id join public.news_sources s on s.id = a.source_id;
end $$;
revoke execute on function public.news_translate_take(int) from public, anon, authenticated;
grant execute on function public.news_translate_take(int) to service_role;

create or replace function public.news_translate_tick() returns bigint
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.news_articles a left join public.news_translate_attempts t on t.article_id = a.id
    where a.language = 'en' and not a.translated and not a.edited and a.status = 'published' and a.duplicate_of is null
      and a.category in ('science', 'nature', 'opinion') and a.published_at > now() - interval '36 hours' and coalesce(t.tries, 0) < 2
  ) then return null; end if;
  return public.news_call_edge_function('news-translate');
end $$;
revoke execute on function public.news_translate_tick() from public, anon, authenticated;
select cron.schedule('news-translate', '3-59/5 * * * *', $$ select public.news_translate_tick(); $$);

-- 5) Worldwide search trends (Google Trends public RSS per country; pg_cron + pg_net, no key) ----
create table if not exists public.news_trend_geos (
  geo          text primary key check (geo ~ '^[A-Z]{2}$'),
  enabled      boolean not null default true,
  sort_order   smallint not null default 100,
  last_fetch_at timestamptz,
  last_ok_at   timestamptz,
  last_error   text
);
create table if not exists public.news_trends (
  geo          text not null references public.news_trend_geos(geo) on delete cascade,
  title        text not null check (char_length(title) between 1 and 120),
  rank         smallint,                       -- position in the newest feed; null once it left the feed
  traffic      int,                            -- Google's approximate search volume ("2000+" → 2000)
  started_at   timestamptz,
  news         jsonb not null default '[]',    -- [{t: headline, u: url, s: publisher}] as listed by Google
  first_seen_at timestamptz not null default now(),
  seen_at      timestamptz not null default now(),
  primary key (geo, title)
);
create index if not exists news_trends_geo_rank on public.news_trends (geo, rank);
create table if not exists public.news_trend_fetches (
  request_id bigint primary key,
  geo        text not null references public.news_trend_geos(geo) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.news_trend_geos enable row level security;
alter table public.news_trends enable row level security;
alter table public.news_trend_fetches enable row level security;
revoke all on public.news_trend_geos, public.news_trends, public.news_trend_fetches from anon, authenticated;
grant select (geo, enabled, sort_order, last_ok_at) on public.news_trend_geos to anon, authenticated;
grant select on public.news_trends to anon, authenticated;
drop policy if exists trend_geos_read on public.news_trend_geos;
drop policy if exists trends_read on public.news_trends;
create policy trend_geos_read on public.news_trend_geos for select using (enabled);
create policy trends_read on public.news_trends for select using (true);

insert into public.news_trend_geos (geo, sort_order) values
  ('JO', 1), ('SA', 2), ('EG', 3), ('AE', 4), ('MA', 5), ('DZ', 6), ('IQ', 7), ('KW', 8), ('QA', 9), ('LB', 10),
  ('US', 20), ('GB', 21), ('FR', 22), ('DE', 23), ('TR', 24), ('ES', 25), ('IT', 26), ('IN', 27), ('JP', 28), ('BR', 29),
  ('ID', 30), ('NG', 31), ('ZA', 32), ('AU', 33), ('CA', 34), ('MX', 35), ('KR', 36), ('PK', 37)
on conflict (geo) do nothing;

create or replace function public.news_trends_cycle() returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare
  f record; n_ok int := 0; n_req int := 0; n_err int := 0;
begin
  for f in
    select q.request_id, q.geo, q.created_at, r.id as rid, r.status_code, r.content, r.error_msg
    from news_trend_fetches q left join net._http_response r on r.id = q.request_id
  loop
    if f.rid is null then
      if f.created_at > now() - interval '10 minutes' then continue; end if; -- still in flight
      update news_trend_geos set last_error = 'no response' where geo = f.geo; n_err := n_err + 1;
    elsif f.status_code = 200 and f.content like '%<rss%' then
      begin
        update news_trends set rank = null where geo = f.geo;
        insert into news_trends as t (geo, title, rank, traffic, started_at, news, seen_at)
        select distinct on (btrim(x.title)) f.geo, left(btrim(x.title), 120), x.ord::smallint,
          case when x.traffic ~ '^[0-9]+' then least(2000000000, (substring(x.traffic from '^[0-9]+'))::bigint
            * case when x.traffic ~* 'm' then 1000000 when x.traffic ~* 'k' then 1000 else 1 end)::int end,
          case when x.pub ~ '^[A-Za-z]{3}, [0-9]{1,2} [A-Za-z]{3} [0-9]{4} ' then x.pub::timestamptz end,
          coalesce((select jsonb_agg(jsonb_build_object('t', left(n.t, 240), 'u', n.u, 's', left(n.s, 80)))
            from xmltable(xmlnamespaces('https://trends.google.com/trending/rss' as ht), '//ht:news_item' passing x.item
              columns t text path 'ht:news_item_title', u text path 'ht:news_item_url', s text path 'ht:news_item_source') n
            where n.u ~ '^https://[^\s<>"]+$' and coalesce(n.t, '') <> ''), '[]'::jsonb),
          now()
        from xmltable(xmlnamespaces('https://trends.google.com/trending/rss' as ht), '/rss/channel/item' passing xmlparse(document f.content)
          columns ord for ordinality, title text path 'title', traffic text path 'ht:approx_traffic', pub text path 'pubDate', item xml path '.') x
        where coalesce(btrim(x.title), '') <> ''
        order by btrim(x.title), x.ord
        on conflict (geo, title) do update set rank = excluded.rank, traffic = excluded.traffic,
          started_at = coalesce(excluded.started_at, t.started_at), news = excluded.news, seen_at = now();
        update news_trend_geos set last_ok_at = now(), last_error = null where geo = f.geo; n_ok := n_ok + 1;
      exception when others then
        update news_trend_geos set last_error = left('parse: ' || sqlerrm, 200) where geo = f.geo; n_err := n_err + 1;
      end;
    else
      update news_trend_geos set last_error = left(coalesce('HTTP ' || f.status_code, f.error_msg, 'error'), 200) where geo = f.geo; n_err := n_err + 1;
    end if;
    delete from news_trend_fetches where request_id = f.request_id;
  end loop;

  delete from news_trends where seen_at < now() - interval '24 hours';

  with due as (
    select geo from news_trend_geos g
    where enabled and (last_fetch_at is null or last_fetch_at < now() - interval '4 minutes')
      and not exists (select 1 from news_trend_fetches q where q.geo = g.geo)
  ), req as (
    insert into news_trend_fetches (request_id, geo)
    select net.http_get('https://trends.google.com/trending/rss?geo=' || geo, timeout_milliseconds := 15000), geo from due
    returning geo
  ) update news_trend_geos g set last_fetch_at = now() from req where req.geo = g.geo;
  get diagnostics n_req = row_count;
  return jsonb_build_object('ok', n_ok, 'requested', n_req, 'errors', n_err);
end $$;
revoke all on function public.news_trends_cycle() from public, anon, authenticated;
select cron.schedule('news-trends', '1-59/5 * * * *', $$ select public.news_trends_cycle(); $$);

-- 6) Reels: default the Arabic edition to Arabic videos is a front-end choice; no schema change.

-- 7) Bring the last 3 days in line with the new sections (ingest rows only; editors' rows untouched).
update public.news_articles a set
  categories = array(select distinct x from unnest(array_append(a.categories, public.news_topic_category(a.title, a.category, s.default_category))) x),
  category = public.news_topic_category(a.title, a.category, s.default_category)
from public.news_sources s
where s.id = a.source_id and a.published_at > now() - interval '3 days' and not a.edited
  and public.news_topic_category(a.title, a.category, s.default_category) is distinct from a.category;

-- New Scientist's robots.txt disallows the fetcher (seen on the first run): kept in the list, switched off.
update public.news_sources set enabled = false, notes = 'robots.txt disallows our fetcher (2026-11-13)' where slug = 'newscientist';
