-- 2026-11-06 — verified feeds for the new and thin sections.
-- Each feed was fetched from this Supabase project on 2026-11-06 (HTTP 200, valid RSS/RDF) and its
-- robots.txt checked: BBC feeds, WHO, The National, France 24, DW allow it. The ingest function re-checks
-- robots.txt before the first fetch and daily. Headlines + short excerpt + link only; images off.
-- Not added (and why): Reuters, AP — no official public RSS; UN News — robots.txt allows /feed only for
-- Google's fetcher and returns an empty feed; Al Mamlaka — robots.txt "Disallow: /" for all agents;
-- Petra — robots.txt disallows feed readers (unchanged since 2026-10-17).
-- English feeds are published only as Arabic machine translations; they poll every 15 min with
-- max 10 items so the daily AI budget (ai_daily_limit) stays available for breaking news.
insert into public.news_sources (slug, name_ar, name_en, homepage, feed_url, language, country, kind, reliability,
  default_category, topical, tz_offset_minutes, poll_interval_minutes, min_interval_minutes, max_items, enabled, terms_note) values
  ('france24-ar-sports', 'فرانس 24 — رياضة', 'France 24 Arabic Sports', 'https://www.france24.com/ar/',
   'https://www.france24.com/ar/%D8%B1%D9%8A%D8%A7%D8%B6%D8%A9/rss', 'ar', 'FR', 'media', 4, 'sports', true, 0, 5, 3, 20, true, 'Public RSS (sports section)'),
  ('dw-ar-science', 'دويتشه فيله — علوم وصحة', 'DW Arabic Science', 'https://www.dw.com/ar/',
   'https://rss.dw.com/rdf/rss-ar-sci', 'ar', 'DE', 'media', 4, 'health', true, 0, 15, 5, 15, true, 'Public RSS (science section)'),
  ('who-news', 'منظمة الصحة العالمية', 'World Health Organization', 'https://www.who.int/news',
   'https://www.who.int/rss-feeds/news-english.xml', 'en', null, 'official', 5, 'health', true, 0, 30, 10, 10, true, 'Official WHO news RSS; translated'),
  ('bbc-health', 'بي بي سي — صحة', 'BBC News Health', 'https://www.bbc.com/news/health',
   'https://feeds.bbci.co.uk/news/health/rss.xml', 'en', 'GB', 'media', 5, 'health', true, 0, 15, 5, 10, true, 'BBC RSS: headlines + links; translated'),
  ('bbc-science', 'بي بي سي — علوم وبيئة', 'BBC Science & Environment', 'https://www.bbc.com/news/science_and_environment',
   'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', 'en', 'GB', 'media', 5, 'environment', false, 0, 15, 5, 10, true, 'BBC RSS: headlines + links; translated'),
  ('bbc-tech', 'بي بي سي — تكنولوجيا', 'BBC News Technology', 'https://www.bbc.com/news/technology',
   'https://feeds.bbci.co.uk/news/technology/rss.xml', 'en', 'GB', 'media', 5, 'tech', true, 0, 15, 5, 10, true, 'BBC RSS: headlines + links; translated'),
  ('bbc-entertainment', 'بي بي سي — فن وثقافة', 'BBC Entertainment & Arts', 'https://www.bbc.com/news/entertainment_and_arts',
   'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml', 'en', 'GB', 'media', 5, 'entertainment', true, 0, 15, 5, 10, true, 'BBC RSS: headlines + links; translated'),
  ('thenational', 'ذا ناشونال (الإمارات)', 'The National (UAE)', 'https://www.thenationalnews.com',
   'https://www.thenationalnews.com/arc/outboundfeeds/rss/?outputType=xml', 'en', 'AE', 'media', 4, 'arab', false, 0, 10, 5, 10, true, 'Public RSS; headlines + links; translated')
on conflict (slug) do nothing;

-- Al Mamlaka: record why it stays disabled.
update public.news_sources set notes = 'Re-checked 2026-11-06: /rss is 404 and robots.txt disallows all agents.'
where slug = 'almamlaka';
