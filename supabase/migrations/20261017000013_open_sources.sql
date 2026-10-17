-- Additional open RSS feeds (probed 2026-10-17: HTTP 200 RSS, robots.txt allows generic crawlers,
-- no anti-bot challenge). Images stay off until the publisher's terms are confirmed.
--   jo24.net      robots: "Content-Signal: search=yes, ai-train=no, use=reference", Allow: /
--   hala.jo       robots: only /wp-admin disallowed
--   alquds.co.uk  robots: "all other crawlers are welcome (search engines, feed readers ...)"
insert into public.news_sources (slug, name_ar, name_en, homepage, feed_url, language, country, kind, reliability, default_category, topical, tz_offset_minutes, poll_interval_minutes, min_interval_minutes, enabled, terms_note) values
  ('jo24',        'جو24',          'JO24',          'https://www.jo24.net',     'https://www.jo24.net/rss.xml', 'ar', 'JO', 'media', 3, 'jordan', false, 0, 3, 3, true, 'Public RSS; robots content-signal: search=yes, ai-train=no, use=reference'),
  ('hala-jo',     'هلا أخبار',      'Hala News',     'https://www.hala.jo',      'https://www.hala.jo/feed/',    'ar', 'JO', 'media', 3, 'jordan', false, 0, 5, 3, true, 'Public RSS (WordPress)'),
  ('alquds-arabi','القدس العربي',   'Al-Quds Al-Arabi','https://www.alquds.co.uk','https://www.alquds.co.uk/feed/','ar', 'GB', 'media', 3, null,     false, 0, 5, 3, true, 'Public RSS (WordPress); robots welcomes feed readers')
on conflict (slug) do nothing;

update public.news_settings set value = '14' where key = 'max_sources_per_run';
