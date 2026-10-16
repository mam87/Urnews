-- Result of the first real ingest runs (2026-10-17). Not bypassed: robots.txt and anti-bot (403) are respected.
update public.news_sources set enabled = false,
  notes = case
    when slug in ('cnn-arabic','petra','un-news-ar') then 'Disabled 2026-10-17: robots.txt disallows automated access to this feed.'
    when slug in ('alarabiya','alghad','arab48','independent-ar') then 'Disabled 2026-10-17: server returns HTTP 403 to automated readers (anti-bot). Not bypassed by policy.'
    when slug in ('almamlaka','wafa') then 'Disabled 2026-10-17: feed URL returns HTTP 404 — find the official RSS URL and re-enable.'
    when slug = 'ammon' then 'Disabled 2026-10-17: URL returns an HTML page, not RSS — find the official feed URL.'
  end
where slug in ('cnn-arabic','petra','un-news-ar','alarabiya','alghad','arab48','independent-ar','almamlaka','wafa','ammon');
