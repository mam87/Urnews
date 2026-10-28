-- Hebrew (Israeli) media, published as Arabic machine translations.
-- Headline + short translated excerpt + link to the original only; nothing is shown in Hebrew:
-- items that could not be translated (no AI key, daily cap, rejected output) are skipped by news-ingest.
-- Feeds are the publishers' own public RSS. Images stay off until each publisher's terms are confirmed.
alter table public.news_sources drop constraint if exists news_sources_language_check;
alter table public.news_sources add constraint news_sources_language_check
  check (language in ('ar', 'en', 'fr', 'he'));

insert into public.news_sources (slug, name_ar, name_en, homepage, feed_url, language, country, kind, reliability, default_category, topical, tz_offset_minutes, poll_interval_minutes, min_interval_minutes, max_items, enabled, terms_note) values
  ('ynet-flash',     'يديعوت أحرونوت (واي نت)', 'Ynet (Yedioth)', 'https://www.ynet.co.il',      'https://www.ynet.co.il/Integration/StoryRss1854.xml',             'he', 'IL', 'media', 3, null, false, 120, 5, 3, 20, true, 'Public RSS (newsflashes); headlines + link, translated'),
  ('walla-flash',    'والا',                    'Walla! News',    'https://news.walla.co.il',    'https://www.walla.co.il/rss/feed/news/breaking-news',             'he', 'IL', 'media', 3, null, false, 120, 5, 3, 20, true, 'Public RSS (breaking); headlines + link, translated'),
  ('maariv-flash',   'معاريف',                  'Maariv',         'https://www.maariv.co.il',    'https://www.maariv.co.il/Rss/RssFeedsMivzakiChadashot',           'he', 'IL', 'media', 3, null, false, 120, 5, 3, 20, true, 'Public RSS (breaking); headlines + link, translated'),
  ('haaretz-he',     'هآرتس',                   'Haaretz (Hebrew)','https://www.haaretz.co.il',  'https://www.haaretz.co.il/srv/htz---all-articles',                'he', 'IL', 'media', 3, null, false, 120, 10, 5, 20, true, 'Public RSS; paywalled site — headline + link only'),
  ('israelhayom',    'يسرائيل هيوم',            'Israel Hayom',   'https://www.israelhayom.co.il','https://www.israelhayom.co.il/rss',                             'he', 'IL', 'media', 3, null, false, 120, 10, 5, 20, true, 'Public RSS; headlines + link, translated')
on conflict (slug) do nothing;

-- Room for the extra feeds per run, and translation budget (≈ 5 Hebrew feeds × ~80 new items/day).
update public.news_settings set value = '19' where key = 'max_sources_per_run' and value::int < 19;
update public.news_settings set value = '800' where key = 'ai_daily_limit' and value::int < 800;
