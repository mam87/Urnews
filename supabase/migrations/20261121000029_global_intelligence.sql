-- «مركز لحظة للذكاء والتحليل العالمي» — increment 1 (free, no API key, no paid service).
--
-- 1) YouTube analysis intelligence: the public long-form upload feeds (…/feeds/videos.xml?playlist_id=UULF…) of
--    verified news, analysis, economy, tech, automotive, science, health and documentary channels. Each feed gives the
--    title, description, time, thumbnail, view count and like count of the channel's 15 newest long videos. Every
--    30 minutes a view snapshot is stored, so the database can measure view velocity against the channel's own
--    baseline. Two separate, explainable scores: POPULARITY (attention) and EDITORIAL IMPORTANCE (credibility and
--    subject weight). Popularity never raises editorial importance. Comment counts and audience retention are not
--    in the public feed and are not invented.
-- 2) Cross-platform trends: Google Trends "trending now" (28 countries, collected since migration 28) fused with
--    Lahza's own reports (65 publisher feeds) and the YouTube videos above. A topic is labelled GLOBAL only when it
--    appears on 2+ platforms AND in 3+ countries or 3+ independent publishers — never from one platform or country.
-- 3) A separate Edge Function, intel-translate, translates the top videos' titles and non-Arabic trend keywords
--    (same daily AI budget and guard rails as news-translate).
-- Collected by pg_cron + pg_net like the Reels feeds. Additive only: no existing table, function or job is changed.

-- ---------------------------------------------------------------------------------------------------------
-- 1) Channels
create table if not exists public.intel_yt_channels (
  channel_id    text primary key check (channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  name_ar       text not null check (char_length(name_ar) between 2 and 60),
  name_en       text not null check (char_length(name_en) between 2 and 60),
  language      text not null check (language in ('ar', 'en')),
  country       text,
  section       text not null check (section in ('politics', 'war', 'sports', 'tech', 'automotive', 'science', 'medical', 'economy', 'documentary')),
  tier          smallint not null default 3 check (tier between 1 and 5),   -- 5 = major newsroom / official institution
  enabled       boolean not null default true,
  baseline_vph  numeric,                                                    -- median views per hour of the channel's recent videos
  last_fetch_at timestamptz,
  last_ok_at    timestamptz,
  last_error    text,
  created_at    timestamptz not null default now()
);

-- 2) Videos (metadata only; played with YouTube's official embedded player and always linked to YouTube)
create table if not exists public.intel_yt_videos (
  video_id      text primary key check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  tid           bigint generated always as identity unique,                 -- numeric handle for the translation lane
  channel_id    text not null references public.intel_yt_channels(channel_id) on delete cascade,
  title         text not null check (char_length(title) between 1 and 300),
  title_ar      text check (char_length(title_ar) <= 300),
  description   text check (char_length(description) <= 240),
  description_ar text check (char_length(description_ar) <= 400),
  language      text not null check (language in ('ar', 'en')),
  section       text not null,
  published_at  timestamptz not null,
  thumbnail     text check (thumbnail ~ '^https://i[0-9]?\.ytimg\.com/'),
  views         bigint,
  likes         bigint,
  vph           numeric,                       -- current views per hour (from snapshots, else lifetime average)
  velocity_ratio numeric,                      -- vph ÷ channel baseline
  popularity    smallint,                      -- 0–100
  editorial     smallint,                      -- 0–100
  score_parts   jsonb not null default '{}',   -- every component of both scores, shown to readers
  related_article_id bigint references public.news_articles(id) on delete set null,
  related_publishers smallint not null default 0,
  trend_match   text,                          -- a Google Trends term found in the title
  tr_tries      smallint not null default 0,
  first_seen_at timestamptz not null default now(),
  fetched_at    timestamptz not null default now()
);
create index if not exists intel_yt_videos_recent on public.intel_yt_videos (published_at desc);
create index if not exists intel_yt_videos_section on public.intel_yt_videos (section, published_at desc);

-- 3) View snapshots (kept 3 days) — the basis of velocity
create table if not exists public.intel_yt_stats (
  video_id text not null references public.intel_yt_videos(video_id) on delete cascade,
  at       timestamptz not null default now(),
  views    bigint not null,
  likes    bigint,
  primary key (video_id, at)
);

create table if not exists public.intel_yt_fetches (
  request_id bigint primary key,
  channel_id text not null references public.intel_yt_channels(channel_id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 4) Fused trends
create table if not exists public.intel_trends (
  key            text primary key check (char_length(key) between 2 and 120),
  tid            bigint generated always as identity unique,
  term           text not null,
  term_ar        text check (char_length(term_ar) <= 120),
  term_is_ar     boolean not null default false,
  geos           text[] not null default '{}',
  n_countries    smallint not null default 0,
  traffic_max    int,
  news_hits      int not null default 0,
  news_publishers int not null default 0,
  video_hits     int not null default 0,
  platforms      smallint not null default 0,
  is_global      boolean not null default false,
  category       text,
  score          smallint not null default 0,
  prev_score     smallint,
  direction      text not null default 'new' check (direction in ('new', 'up', 'down', 'flat')),
  google_news    jsonb not null default '[]',
  article_ids    bigint[] not null default '{}',
  video_ids      text[] not null default '{}',
  tr_tries       smallint not null default 0,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists intel_trends_score on public.intel_trends (score desc);

-- RLS: readers see enabled channels and their videos and the fused trends; everything is written by the scheduler.
alter table public.intel_yt_channels enable row level security;
alter table public.intel_yt_videos enable row level security;
alter table public.intel_yt_stats enable row level security;
alter table public.intel_yt_fetches enable row level security;
alter table public.intel_trends enable row level security;
revoke all on public.intel_yt_channels, public.intel_yt_videos, public.intel_yt_stats, public.intel_yt_fetches, public.intel_trends from anon, authenticated;
grant select (channel_id, name_ar, name_en, language, country, section, tier, enabled, baseline_vph, last_ok_at) on public.intel_yt_channels to anon, authenticated;
grant select (video_id, channel_id, title, title_ar, description, description_ar, language, section, published_at, thumbnail, views, likes,
              vph, velocity_ratio, popularity, editorial, score_parts, related_article_id, related_publishers, trend_match, first_seen_at, fetched_at)
  on public.intel_yt_videos to anon, authenticated;
grant select (key, term, term_ar, term_is_ar, geos, n_countries, traffic_max, news_hits, news_publishers, video_hits, platforms, is_global,
              category, score, prev_score, direction, google_news, article_ids, video_ids, first_seen_at, last_seen_at, updated_at)
  on public.intel_trends to anon, authenticated;
drop policy if exists intel_channels_read on public.intel_yt_channels;
drop policy if exists intel_videos_read on public.intel_yt_videos;
drop policy if exists intel_trends_read on public.intel_trends;
drop policy if exists intel_channels_admin on public.intel_yt_channels;
create policy intel_channels_read on public.intel_yt_channels for select using (enabled or public.news_is_admin());
create policy intel_videos_read on public.intel_yt_videos for select using (
  exists (select 1 from public.intel_yt_channels c where c.channel_id = intel_yt_videos.channel_id and c.enabled));
create policy intel_trends_read on public.intel_trends for select using (true);
-- editors can switch a channel on/off or change its tier from the admin side
grant update (enabled, tier, section) on public.intel_yt_channels to authenticated;
create policy intel_channels_admin on public.intel_yt_channels for update to authenticated
  using (public.news_is_admin()) with check (public.news_is_admin());

-- Channel IDs verified on 2026-11-21: each feed answered 200 and its <author> matched the publisher.
insert into public.intel_yt_channels (channel_id, name_ar, name_en, language, country, section, tier) values
  -- Arabic newsrooms
  ('UCfiwzLy-8yKzIbsmZTzxDgw', 'الجزيرة',            'Al Jazeera Arabic',        'ar', 'QA', 'politics', 4),
  ('UCahpxixMCwoANAftn6IxkTg', 'العربية',            'Al Arabiya',               'ar', 'AE', 'politics', 4),
  ('UCIJXOvggjKtCagMfxvcCzAA', 'سكاي نيوز عربية',    'Sky News Arabia',          'ar', 'AE', 'politics', 4),
  ('UCelk6aHijZq-GJBBB9YpReA', 'بي بي سي عربي',      'BBC News Arabic',          'ar', 'GB', 'politics', 5),
  ('UCdTyuXgmJkG_O8_75eqej-w', 'فرانس 24 عربي',      'France 24 Arabic',         'ar', 'FR', 'politics', 4),
  ('UC30ditU5JI16o5NbFsHde_Q', 'DW عربية',           'DW Arabic',                'ar', 'DE', 'politics', 5),
  ('UC65i3Fyq91uiUkIS0i5GLNQ', 'العربي',             'Alaraby TV',               'ar', 'QA', 'politics', 3),
  ('UC0jiFAzTgl17k7awGbuoYew', 'المملكة',            'Al Mamlaka TV',            'ar', 'JO', 'politics', 4),
  -- international newsrooms and analysis
  ('UChqUTb7kYRX8-EiaN3XFrSQ', 'رويترز',             'Reuters',                  'en', 'GB', 'politics', 5),
  ('UC52X5wxOL_s5yw0dQk7NtgA', 'أسوشيتد برس',        'Associated Press',         'en', 'US', 'politics', 5),
  ('UC16niRr50-MSBwiO3YDb3RA', 'بي بي سي نيوز',      'BBC News',                 'en', 'GB', 'politics', 5),
  ('UCNye-wNBqNL5ZzHSJj3l8Bg', 'الجزيرة الإنجليزية', 'Al Jazeera English',       'en', 'QA', 'politics', 4),
  ('UCknLrEdhRCp1aegoMqRaCZg', 'DW نيوز',            'DW News',                  'en', 'DE', 'politics', 5),
  ('UCoMdktPbSTixAyNGwb-UYkQ', 'سكاي نيوز',          'Sky News',                 'en', 'GB', 'politics', 4),
  ('UC6ZFN9Tx6xh-skXCuRHCDpQ', 'بي بي إس نيوز آور',  'PBS NewsHour',             'en', 'US', 'politics', 5),
  ('UCwnKziETDbHJtx78nIkfYug', 'كاسبيان ريبورت',     'CaspianReport',            'en', null, 'politics', 3),
  -- economy
  ('UCIALMKvObZNtJ6AmdCLP7Lg', 'بلومبرغ',            'Bloomberg Television',     'en', 'US', 'economy', 5),
  ('UCvJJ_dzjViJCoLf5uKUTwoA', 'سي إن بي سي',        'CNBC',                     'en', 'US', 'economy', 4),
  ('UCoUxsWakJucWg46KW5RsvPw', 'فايننشال تايمز',     'Financial Times',          'en', 'GB', 'economy', 5),
  ('UC0p5jTq6Xx_DosDFxVXnWaQ', 'ذي إيكونوميست',      'The Economist',            'en', 'GB', 'economy', 5),
  ('UCK7tptUDHh-RYDsdxO1-5QQ', 'وول ستريت جورنال',   'The Wall Street Journal',  'en', 'US', 'economy', 5),
  -- technology and AI
  ('UCddiUEpeqJcYeBxX1IVBKvQ', 'ذا فيرج',            'The Verge',                'en', 'US', 'tech', 4),
  ('UCOmcA3f_RrH6b9NmcNa4tdg', 'سي نت',              'CNET',                     'en', 'US', 'tech', 4),
  ('UCP7jMXSY2xbc3KCAE0MHQ-A', 'غوغل ديب مايند',     'Google DeepMind',          'en', 'GB', 'tech', 4),
  ('UCXZCJLdBC09xxGZ6gcdrc6A', 'أوبن إيه آي',        'OpenAI',                   'en', 'US', 'tech', 4),
  ('UCBJycsmduvYEL83R_U4JriQ', 'ماركيز براونلي',     'Marques Brownlee',         'en', 'US', 'tech', 3),
  ('UCbfYPyITQ-7l4upoX8nvctg', 'تو مينِت بيبرز',     'Two Minute Papers',        'en', null, 'tech', 3),
  ('UCsBjURrPoezykLs9EqgamOA', 'فايرشيب',            'Fireship',                 'en', 'US', 'tech', 3),
  -- automotive
  ('UCjOl2AUblVmg2rA_cRgZkFg', 'توب غير',            'Top Gear',                 'en', 'GB', 'automotive', 4),
  ('UCsAegdhiYLEoaFGuJFVrqFQ', 'موتور ترند',         'MotorTrend',               'en', 'US', 'automotive', 4),
  ('UCsqjHFMB_JYTaEnf_vmTNqg', 'دوغ ديمورو',         'Doug DeMuro',              'en', 'US', 'automotive', 3),
  ('UCUhFaUpnq31m6TNX2VKVSVA', 'كارواو',             'carwow',                   'en', 'GB', 'automotive', 3),
  ('UCzz4CoEgSgWNs9ZAvRMhW2A', 'إفريثينغ إلكتريك',   'Everything Electric CARS', 'en', 'GB', 'automotive', 3),
  -- science and space
  ('UCLA_DiR1FfKNvjuUpBHmylQ', 'ناسا',               'NASA',                     'en', 'US', 'science', 5),
  ('UCIBaDdAbGlFDeS33shmlD0A', 'وكالة الفضاء الأوروبية', 'European Space Agency', 'en', null, 'science', 5),
  ('UCsXVk37bltHxD1rDPwtNM8Q', 'كورتسغزاغت',         'Kurzgesagt',               'en', 'DE', 'science', 4),
  ('UCHnyfMqiRRG1u-2MsSQLbXA', 'فيريتاسيوم',         'Veritasium',               'en', null, 'science', 4),
  ('UCZYTClx2T1of7BRZ86-8fow', 'ساي شو',             'SciShow',                  'en', 'US', 'science', 4),
  ('UC7_gcs09iThXybpVgjHZ_7g', 'بي بي إس سبيس تايم', 'PBS Space Time',           'en', 'US', 'science', 4),
  -- health
  ('UC07-dOwgza1IguKA86jqxNA', 'منظمة الصحة العالمية', 'World Health Organization', 'en', null, 'medical', 5),
  -- documentaries
  ('UCW39zufHfsuGgpLviKh297Q', 'دي دبليو وثائقي',    'DW Documentary',           'en', 'DE', 'documentary', 5),
  ('UCZaT_X_mc0BI-djXOlfhqWQ', 'فايس نيوز',          'VICE News',                'en', 'US', 'documentary', 3),
  -- sports
  ('UCNAf1k0yIjyGu3k9BwAg3lg', 'سكاي سبورتس',        'Sky Sports Premier League','en', 'GB', 'sports', 4),
  ('UCpcTrCXblq78GZrTUTLWeBw', 'فيفا',               'FIFA',                     'en', null, 'sports', 5),
  ('UCyGa1YEx9ST66rYrJTGIKOw', 'يويفا',              'UEFA',                     'en', null, 'sports', 5)
on conflict (channel_id) do nothing;

-- ---------------------------------------------------------------------------------------------------------
-- Section of one video: the channel's beat, refined by unmistakable words for general newsrooms.
create or replace function public.intel_video_section(p_title text, p_channel_section text)
returns text language sql immutable set search_path = pg_catalog as $$
  select case
    when p_channel_section not in ('politics', 'economy') then p_channel_section
    when p_title ~* '\m(war|wars|military|army|missiles?|drones?|airstrikes?|troops|frontline|front line|ceasefire|nato|shelling|offensive|weapons?|warship|invasion)\M'
      or p_title ~ '(حرب|الحرب|عسكري|عسكرية|صاروخ|صواريخ|مسيّرة|مسيرة|مسيرات|غارة|غارات|الجيش|جيش|قصف|هدنة|وقف إطلاق النار|اشتباكات|الناتو|اجتياح)'
      then 'war'
    when p_channel_section = 'politics' and (p_title ~* '\m(health|disease|vaccines?|virus|cancer|outbreak|epidemic|pandemic|hospital|medicine)\M'
      or p_title ~ '(الصحة|مرض|لقاح|فيروس|سرطان|وباء|مستشفى|دواء)') then 'medical'
    when p_channel_section = 'politics' and (p_title ~* '\m(economy|inflation|markets?|stocks?|oil prices?|tariffs?|interest rates?|recession|gdp|central bank)\M'
      or p_title ~ '(الاقتصاد|اقتصادي|التضخم|الأسواق|البورصة|أسعار النفط|الرسوم الجمركية|أسعار الفائدة|الركود|البنك المركزي)') then 'economy'
    when p_title ~* '\m(ai|artificial intelligence|chatgpt|openai|nvidia|chips?|semiconductors?|robots?|robotics)\M'
      or p_title ~ '(الذكاء الاصطناعي|رقائق|روبوت)' then 'tech'
    when p_channel_section = 'politics' and (p_title ~* '\m(football|soccer|world cup|olympics?)\M' or p_title ~ '(كرة القدم|كأس العالم|الدوري|المنتخب)') then 'sports'
    else p_channel_section end
$$;

-- Score both dimensions for the videos of the last 7 days. Every component is stored in score_parts.
create or replace function public.intel_youtube_score() returns int
language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare n int;
begin
  -- channel baseline: median views per hour of its videos aged 1–10 days (falls back to all its videos)
  update intel_yt_channels c set baseline_vph = b.med
  from (
    select v.channel_id,
      coalesce(
        percentile_cont(0.5) within group (order by v.views / greatest(extract(epoch from now() - v.published_at) / 3600, 1))
          filter (where v.published_at < now() - interval '24 hours'),
        percentile_cont(0.5) within group (order by v.views / greatest(extract(epoch from now() - v.published_at) / 3600, 1))) as med
    from intel_yt_videos v where v.views is not null group by v.channel_id
  ) b where b.channel_id = c.channel_id;

  with base as (
    select v.video_id, v.views, v.likes, v.section, v.title, v.related_publishers, v.trend_match, v.related_article_id,
           greatest(extract(epoch from now() - v.published_at) / 3600, 1) as age_h, c.tier, c.baseline_vph,
           old.views as old_views, old.at as old_at
    from intel_yt_videos v join intel_yt_channels c using (channel_id)
    left join lateral (
      select s.views, s.at from intel_yt_stats s
      where s.video_id = v.video_id and s.at <= now() - interval '90 minutes' and s.at >= now() - interval '12 hours'
      order by s.at desc limit 1) old on true
    where v.published_at > now() - interval '7 days' and v.views is not null
  ), m as (
    select b.*,
      case when b.old_views is not null and b.views >= b.old_views
           then (b.views - b.old_views) / greatest(extract(epoch from now() - b.old_at) / 3600, 0.5)
           else b.views / b.age_h end as vph,
      b.old_views is not null as measured
    from base b
  ), p as (
    select m.*,
      case when coalesce(m.baseline_vph, 0) > 0 then m.vph / m.baseline_vph end as ratio,
      case when m.views > 0 and m.likes is not null then m.likes::numeric / m.views end as eng
    from m
  ), s as (
    select p.*,
      round(40 * least(1, ln(1 + coalesce(p.ratio, 1)) / ln(9)))::int                             as s_velocity,
      round(20 * least(1, log(1 + p.vph) / 4))::int                                                  as s_growth,
      round(25 * least(1, coalesce(p.eng, 0) / 0.04))::int                                           as s_engagement,
      (case when p.related_article_id is not null then 10 else 0 end + case when p.trend_match is not null then 5 else 0 end) as s_cross,
      (p.tier * 7)                                                                                   as e_source,
      (case p.section when 'war' then 25 when 'politics' then 23 when 'medical' then 22 when 'economy' then 20
                      when 'science' then 20 when 'tech' then 18 when 'documentary' then 16 else 12 end) as e_subject,
      least(25, 5 * p.related_publishers)                                                            as e_coverage,
      (case when p.title ~* '(analysis|explained|explainer|\mwhy\M|\mhow\M|what .* means|documentary|investigat|inside|deep dive|interview)'
              or p.title ~ '(تحليل|لماذا|كيف|ماذا يعني|وثائقي|تحقيق|قراءة في|حوار|مقابلة)' then 15 else 6 end) as e_format
    from p
  )
  update intel_yt_videos v set
    vph = round(s.vph, 1),
    velocity_ratio = round(s.ratio, 2),
    popularity = least(100, s.s_velocity + s.s_growth + s.s_engagement + s.s_cross),
    editorial  = least(100, s.e_source + s.e_subject + s.e_coverage + s.e_format),
    score_parts = jsonb_build_object(
      'velocity', s.s_velocity, 'growth', s.s_growth, 'engagement', s.s_engagement, 'cross', s.s_cross,
      'source', s.e_source, 'subject', s.e_subject, 'coverage', s.e_coverage, 'format', s.e_format,
      'measured', s.measured, 'ratio', round(s.ratio, 1), 'eng_pct', round(100 * s.eng, 2))
  from s where s.video_id = v.video_id;
  get diagnostics n = row_count;
  return n;
end $$;

-- One scheduler step: collect finished feed requests, store videos + snapshots, link, score, request due feeds.
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

  -- a Google Trends term (seen in the last 12 h, 4+ characters) that appears in the title
  update intel_yt_videos v set trend_match = (
    select t.title from news_trends t
    where t.seen_at > now() - interval '12 hours' and char_length(t.title) >= 4
      and position(lower(t.title) in lower(v.title)) > 0
    order by t.traffic desc nulls last limit 1)
  where v.published_at > now() - interval '3 days';

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

-- ---------------------------------------------------------------------------------------------------------
-- Fused trends, recomputed every 10 minutes.
create or replace function public.intel_trends_refresh() returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare n int;
begin
  with g as (
    select lower(btrim(t.title)) as key, min(t.title) as term, array_agg(distinct t.geo order by t.geo) as geos,
           count(distinct t.geo)::int as n_countries, max(t.traffic) as traffic_max, min(t.first_seen_at) as first_seen,
           max(t.seen_at) as last_seen, (array_agg(t.news order by t.traffic desc nulls last))[1] as news
    from news_trends t
    where t.seen_at > now() - interval '6 hours' and char_length(btrim(t.title)) between 3 and 120
    group by lower(btrim(t.title))
  ), hits as (
    select g.*, a.hits, a.publishers, a.ids, a.cat, vv.vhits, vv.vids
    from g
    left join lateral (
      select count(*)::int as hits, count(distinct coalesce(s.publisher, s.slug))::int as publishers,
             (array_agg(x.id order by x.published_at desc))[1:3] as ids, mode() within group (order by x.category) as cat
      from news_articles x join news_sources s on s.id = x.source_id
      where x.status = 'published' and x.duplicate_of is null and x.published_at > now() - interval '24 hours'
        and (position(g.key in lower(x.title)) > 0 or position(g.key in lower(coalesce(x.title_en, ''))) > 0)
    ) a on true
    left join lateral (
      select count(*)::int as vhits, (array_agg(v.video_id order by v.popularity desc nulls last))[1:3] as vids
      from intel_yt_videos v
      where v.published_at > now() - interval '72 hours'
        and (position(g.key in lower(v.title)) > 0 or position(g.key in lower(coalesce(v.title_ar, ''))) > 0)
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
         s.platforms >= 2 and (s.n_countries >= 3 or coalesce(s.publishers, 0) >= 3),
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

  delete from intel_trends where last_seen_at < now() - interval '48 hours';
  return jsonb_build_object('trends', n);
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Translation lane (Edge Function news-translate): top non-Arabic video titles and trend keywords.
create or replace function public.intel_translate_take(p_limit int default 10)
returns table (kind text, id bigint, title text, summary text, source_name text)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with v as (
    select x.tid from public.intel_yt_videos x
    where x.language = 'en' and x.title_ar is null and x.tr_tries < 2 and x.published_at > now() - interval '72 hours'
      and (coalesce(x.popularity, 0) >= 35 or coalesce(x.editorial, 0) >= 60)
    order by coalesce(x.popularity, 0) + coalesce(x.editorial, 0) desc limit least(greatest(p_limit, 1), 12)
  ), mv as (
    update public.intel_yt_videos x set tr_tries = x.tr_tries + 1 from v where x.tid = v.tid returning x.tid
  ), t as (
    select y.tid from public.intel_trends y
    where not y.term_is_ar and y.term_ar is null and y.tr_tries < 2 and y.platforms >= 2
    order by y.score desc limit greatest(0, least(greatest(p_limit, 1), 12) - (select count(*) from v))
  ), mt as (
    update public.intel_trends y set tr_tries = y.tr_tries + 1 from t where y.tid = t.tid returning y.tid
  )
  select 'video'::text, x.tid, x.title, x.description, c.name_ar
    from mv join public.intel_yt_videos x on x.tid = mv.tid join public.intel_yt_channels c on c.channel_id = x.channel_id
  union all
  select 'trend'::text, y.tid, y.term, null::text, 'Google Trends'::text
    from mt join public.intel_trends y on y.tid = mt.tid;
end $$;

create or replace function public.intel_set_translations(p jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare n1 int; n2 int;
begin
  update public.intel_yt_videos x set title_ar = left(r.title, 300),
         description_ar = case when r.summary is not null and x.description is not null then left(r.summary, 400) end
  from jsonb_to_recordset(p) as r(kind text, id bigint, title text, summary text)
  where r.kind = 'video' and x.tid = r.id and char_length(r.title) between 3 and 300;
  get diagnostics n1 = row_count;
  update public.intel_trends y set term_ar = left(r.title, 120)
  from jsonb_to_recordset(p) as r(kind text, id bigint, title text, summary text)
  where r.kind = 'trend' and y.tid = r.id and char_length(r.title) between 2 and 120;
  get diagnostics n2 = row_count;
  return n1 + n2;
end $$;

-- Wakes the Edge Function intel-translate only when something waits (existing functions are left unchanged).
create or replace function public.intel_translate_tick() returns bigint
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.intel_yt_videos x
    where x.language = 'en' and x.title_ar is null and x.tr_tries < 2 and x.published_at > now() - interval '72 hours'
      and (coalesce(x.popularity, 0) >= 35 or coalesce(x.editorial, 0) >= 60)
  ) and not exists (
    select 1 from public.intel_trends y where not y.term_is_ar and y.term_ar is null and y.tr_tries < 2 and y.platforms >= 2
  ) then return null; end if;
  return public.news_call_edge_function('intel-translate');
end $$;

revoke all on function public.intel_video_section(text, text), public.intel_youtube_score(), public.intel_youtube_cycle(),
  public.intel_trends_refresh(), public.intel_translate_take(int), public.intel_set_translations(jsonb), public.intel_translate_tick()
  from public, anon, authenticated;
grant execute on function public.intel_translate_take(int), public.intel_set_translations(jsonb) to service_role;

select cron.schedule('intel-youtube', '6-59/10 * * * *', $$ select public.intel_youtube_cycle(); $$);
select cron.schedule('intel-trends',  '8-59/10 * * * *', $$ select public.intel_trends_refresh(); $$);
select cron.schedule('intel-translate', '9-59/10 * * * *', $$ select public.intel_translate_tick(); $$);
