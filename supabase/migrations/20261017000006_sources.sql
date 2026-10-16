-- Initial news sources: official public RSS feeds published by each organisation.
-- Reliability (1–5) is an editorial default; adjust it in the admin dashboard.
-- Images are OFF by default (allow_images=false) until you confirm the source's terms allow thumbnails.
-- English sources are disabled until an AI key is configured for translation.
insert into public.news_sources (slug, name_ar, name_en, homepage, feed_url, language, country, kind, reliability, default_category, topical, tz_offset_minutes, poll_interval_minutes, min_interval_minutes, enabled, terms_note) values
  ('bbc-arabic',     'بي بي سي عربي',        'BBC Arabic',        'https://www.bbc.com/arabic',          'https://feeds.bbci.co.uk/arabic/rss.xml', 'ar', 'GB', 'media', 5, 'world', false, 0, 5, 3, true, 'BBC RSS: headlines+links permitted for display; non-commercial terms'),
  ('aljazeera',      'الجزيرة نت',           'Al Jazeera Arabic', 'https://www.aljazeera.net',            'https://www.aljazeera.net/aljazeerarss/a7c186be-1baa-4bd4-9d80-a84db769f779/73d0e1b4-532f-45ef-b135-bfdff8b8cab9', 'ar', 'QA', 'media', 4, null, false, 180, 5, 3, true, 'Public RSS'),
  ('france24-ar',    'فرانس 24',             'France 24 Arabic',  'https://www.france24.com/ar/',         'https://www.france24.com/ar/rss', 'ar', 'FR', 'media', 4, 'world', false, 0, 5, 3, true, 'Public RSS'),
  ('dw-arabic',      'دويتشه فيله عربي',      'DW Arabic',         'https://www.dw.com/ar/',               'https://rss.dw.com/xml/rss-ar-all', 'ar', 'DE', 'media', 4, 'world', false, 0, 10, 5, true, 'Public RSS'),
  ('euronews-ar',    'يورونيوز عربي',         'Euronews Arabic',   'https://arabic.euronews.com',          'https://arabic.euronews.com/rss', 'ar', 'FR', 'media', 4, 'world', false, 0, 10, 5, true, 'Public RSS'),
  ('cnn-arabic',     'سي إن إن بالعربية',     'CNN Arabic',        'https://arabic.cnn.com',               'https://arabic.cnn.com/api/v1/rss/rss.xml', 'ar', 'AE', 'media', 4, null, false, 0, 10, 5, true, 'Public RSS'),
  ('skynews-ar',     'سكاي نيوز عربية',       'Sky News Arabia',   'https://www.skynewsarabia.com',        'https://www.skynewsarabia.com/rss', 'ar', 'AE', 'media', 4, null, false, 240, 5, 3, true, 'Public RSS'),
  ('alarabiya',      'العربية نت',            'Al Arabiya',        'https://www.alarabiya.net',            'https://www.alarabiya.net/feed/rss2/ar.xml', 'ar', 'AE', 'media', 3, null, false, 0, 5, 3, true, 'Public RSS'),
  ('independent-ar', 'اندبندنت عربية',        'Independent Arabia','https://www.independentarabia.com',    'https://www.independentarabia.com/rss', 'ar', 'GB', 'media', 3, null, false, 0, 10, 5, true, 'Public RSS'),
  ('aawsat',         'الشرق الأوسط',          'Asharq Al-Awsat',   'https://aawsat.com',                   'https://aawsat.com/feed', 'ar', 'GB', 'media', 3, null, false, 0, 10, 5, true, 'Public RSS'),
  ('anadolu-ar',     'الأناضول',              'Anadolu Agency',    'https://www.aa.com.tr/ar',             'https://www.aa.com.tr/ar/rss/default?cat=guncel', 'ar', 'TR', 'agency', 3, null, false, 180, 5, 3, true, 'Public RSS'),
  ('un-news-ar',     'أخبار الأمم المتحدة',    'UN News Arabic',    'https://news.un.org/ar/',              'https://news.un.org/feed/subscribe/ar/news/all/rss.xml', 'ar', null, 'official', 5, 'world', false, 0, 15, 10, true, 'UN content; attribution required'),
  ('petra',          'وكالة الأنباء الأردنية (بترا)', 'Petra News Agency', 'https://petra.gov.jo',          'https://petra.gov.jo/Include/Rss.jsp?lang=ar', 'ar', 'JO', 'official', 5, 'jordan', false, 180, 5, 3, true, 'Official Jordanian state agency'),
  ('almamlaka',      'المملكة',               'Al Mamlaka TV',     'https://www.almamlakatv.com',          'https://www.almamlakatv.com/rss', 'ar', 'JO', 'media', 4, 'jordan', false, 180, 5, 3, true, 'Jordanian public broadcaster'),
  ('roya',           'رؤيا الإخباري',          'Roya News',         'https://royanews.tv',                  'https://royanews.tv/rss', 'ar', 'JO', 'media', 3, 'jordan', false, 180, 5, 3, true, 'Public RSS'),
  ('alghad',         'الغد',                  'Al Ghad',           'https://alghad.com',                   'https://alghad.com/feed/', 'ar', 'JO', 'media', 3, 'jordan', false, 180, 10, 5, true, 'Public RSS (WordPress)'),
  ('ammon',          'عمون',                  'Ammon News',        'https://www.ammonnews.net',            'https://www.ammonnews.net/rss.php', 'ar', 'JO', 'media', 3, 'jordan', false, 180, 10, 5, true, 'Public RSS'),
  ('wafa',           'وكالة وفا',             'WAFA',              'https://www.wafa.ps',                  'https://www.wafa.ps/rss.aspx', 'ar', 'PS', 'official', 4, 'palestine', false, 180, 5, 3, true, 'Official Palestinian news agency'),
  ('arab48',         'عرب 48',                'Arab48',            'https://www.arab48.com',               'https://www.arab48.com/rss', 'ar', 'PS', 'media', 3, 'palestine', false, 180, 10, 5, true, 'Public RSS'),
  ('aitnews',        'البوابة العربية للأخبار التقنية', 'AIT News', 'https://aitnews.com',                'https://aitnews.com/feed/', 'ar', null, 'media', 3, 'tech', true, 0, 15, 10, true, 'Public RSS (WordPress)'),
  ('aljazeera-en',   'الجزيرة الإنجليزية',     'Al Jazeera English','https://www.aljazeera.com',            'https://www.aljazeera.com/xml/rss/all.xml', 'en', 'QA', 'media', 4, 'world', false, 0, 10, 5, false, 'Enable after AI translation is configured'),
  ('jordan-times',   'جوردان تايمز',           'The Jordan Times',  'https://jordantimes.com',              'https://jordantimes.com/rss.xml', 'en', 'JO', 'media', 4, 'jordan', false, 180, 15, 10, false, 'Enable after AI translation is configured')
on conflict (slug) do nothing;

update public.news_settings set value = '10' where key = 'max_sources_per_run';
