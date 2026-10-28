-- Faster breaking news (2026-10-28): the scheduler runs every minute and news-first sources are
-- polled every 2 minutes (the schema minimum). Feeds are fetched with ETag/If-Modified-Since, so
-- unchanged feeds cost the publisher only a 304. Edge Function calls: ~1,440/day (free tier allows far more).
select cron.unschedule('news-ingest');
select cron.schedule('news-ingest', '* * * * *', $$ select public.news_call_edge_function('news-ingest'); $$);

update public.news_sources set poll_interval_minutes = 2, min_interval_minutes = 2
where slug in ('aljazeera','anadolu-ar','bbc-arabic','france24-ar','jo24','roya','skynews-ar',
               'alquds-arabi','hala-jo','maariv-flash','walla-flash','ynet-flash');
update public.news_sources set poll_interval_minutes = 5, min_interval_minutes = 3
where slug in ('aawsat','dw-arabic','euronews-ar');
