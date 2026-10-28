-- 1) Weather section («طقس»): articles are routed here by keywords (classify.ts).
insert into public.news_categories (slug, name_ar, sort_order) values ('weather', 'طقس', 10)
on conflict (slug) do update set name_ar = excluded.name_ar, sort_order = excluded.sort_order;

-- 2) International sources, published only as Arabic machine translations (headline + short translated
--    excerpt + link). Publishers' own public RSS; images off until terms are confirmed.
insert into public.news_sources (slug, name_ar, name_en, homepage, feed_url, language, country, kind, reliability, default_category, topical, tz_offset_minutes, poll_interval_minutes, min_interval_minutes, max_items, enabled, terms_note) values
  ('bbc-world',     'بي بي سي العالمية',     'BBC News World',   'https://www.bbc.com/news/world',    'https://feeds.bbci.co.uk/news/world/rss.xml',          'en', 'GB', 'media', 5, 'world', false, 0, 5, 3, 15, true, 'BBC RSS: headlines + links; translated'),
  ('guardian-world','الغارديان',             'The Guardian World','https://www.theguardian.com/world', 'https://www.theguardian.com/world/rss',                'en', 'GB', 'media', 4, 'world', false, 0, 5, 3, 15, true, 'Public RSS; headlines + links; translated'),
  ('france24-en',   'فرانس 24 الإنجليزية',   'France 24 English','https://www.france24.com/en/',      'https://www.france24.com/en/rss',                      'en', 'FR', 'media', 4, 'world', false, 0, 5, 3, 15, true, 'Public RSS; translated'),
  ('dw-english',    'دويتشه فيله الإنجليزية', 'DW English',       'https://www.dw.com/en/',            'https://rss.dw.com/xml/rss-en-all',                    'en', 'DE', 'media', 4, 'world', false, 0, 5, 3, 15, true, 'Public RSS; translated'),
  ('sky-world',     'سكاي نيوز البريطانية',  'Sky News World',   'https://news.sky.com/world',        'https://feeds.skynews.com/feeds/rss/world.xml',        'en', 'GB', 'media', 4, 'world', false, 0, 5, 3, 15, true, 'Public RSS; translated'),
  ('npr-world',     'الإذاعة الأمريكية العامة NPR', 'NPR World',  'https://www.npr.org/sections/world/','https://feeds.npr.org/1004/rss.xml',                  'en', 'US', 'media', 4, 'world', false, 0, 10, 5, 15, true, 'Public RSS; translated')
on conflict (slug) do nothing;

-- Existing English sources that were waiting for a translation key.
update public.news_sources set enabled = true, max_items = 15, poll_interval_minutes = 5, min_interval_minutes = 3
where slug in ('aljazeera-en', 'jordan-times');

update public.news_settings set value = '25' where key = 'max_sources_per_run' and value::int < 25;
update public.news_settings set value = '1200' where key = 'ai_daily_limit' and value::int < 1200;
