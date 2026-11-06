-- 2026-11-06 — Global breaking-news intelligence.
--  * every article is tagged with countries (ISO-3166), world region, event type, global impact, wire service
--  * English reports are kept in English (title_en) as well as translated, for the Arabic/English site
--  * publisher groups (BBC Arabic + BBC World = one publisher) for independent-coverage counting
--  * news_global_events: the ranked worldwide events (0-100 score), rewritten by every ingest run
--  * new verified international feeds from every world region
-- Location is used for tagging and filtering only; it never adds ranking points (lib/rank.ts).
-- Safe to re-run. Touches only news_* objects.

-- 1) Sources: publisher group + national coverage flag ------------------------------------------
alter table public.news_sources add column if not exists publisher text check (publisher ~ '^[a-z0-9-]{2,40}$');
alter table public.news_sources add column if not exists national boolean not null default false;
comment on column public.news_sources.publisher is 'Newsroom/owner group; reports from one group count as ONE independent source';
comment on column public.news_sources.national is 'National outlet: an untagged story is assumed to be about its own country';
grant select (publisher, national) on public.news_sources to anon, authenticated;
grant update (publisher, national, country) on public.news_sources to authenticated;
grant insert (publisher, national) on public.news_sources to authenticated;

update public.news_sources set publisher = 'bbc'       where slug like 'bbc-%';
update public.news_sources set publisher = 'dw'        where slug like 'dw-%';
update public.news_sources set publisher = 'fmm'       where slug like 'france24-%' or slug = 'rfi-en';  -- France Médias Monde
update public.news_sources set publisher = 'euronews'  where slug like 'euronews-%' or slug = 'africanews';
update public.news_sources set publisher = 'aljazeera' where slug in ('aljazeera', 'aljazeera-en');
update public.news_sources set national = true where slug in ('jo24', 'roya', 'hala-jo', 'almamlaka', 'alghad', 'ammon', 'petra', 'jordan-times', 'wafa', 'arab48');

-- 2) Articles: global tags -------------------------------------------------------------------------
alter table public.news_articles add column if not exists countries  text[] not null default '{}';
alter table public.news_articles add column if not exists region     text;
alter table public.news_articles add column if not exists event_type text;
alter table public.news_articles add column if not exists impact     smallint not null default 0 check (impact between 0 and 30);
alter table public.news_articles add column if not exists wire       text;
alter table public.news_articles add column if not exists title_en   text check (char_length(title_en) <= 400);
create index if not exists news_articles_countries_idx on public.news_articles using gin (countries);
create index if not exists news_articles_region_idx on public.news_articles (region, published_at desc) where status = 'published' and duplicate_of is null;
-- English headline: originals of translated English items, and English items not (yet) translated.
update public.news_articles a set title_en = coalesce(a.title_original, a.title)
from public.news_sources s
where s.id = a.source_id and s.language = 'en' and a.title_en is null;

-- 3) Ranked worldwide events ------------------------------------------------------------------------
create table if not exists public.news_global_events (
  key               text primary key check (key ~ '^[ca][0-9]+$'),
  rank              smallint not null,
  cluster_id        bigint,
  lead_article_id   bigint not null references public.news_articles(id) on delete cascade,
  lead_ar_id        bigint references public.news_articles(id) on delete set null,
  lead_en_id        bigint references public.news_articles(id) on delete set null,
  first_article_id  bigint references public.news_articles(id) on delete set null,
  score             smallint not null check (score between 0 and 100),
  parts             jsonb not null default '{}',
  status            text not null check (status in ('developing', 'confirmed', 'updated')),
  confirmed         boolean not null default false,
  single_source     boolean not null default false,
  allegation        boolean not null default false,
  independent_count integer not null default 1,
  publisher_count   integer not null default 1,
  report_count      integer not null default 1,
  countries         text[] not null default '{}',
  region            text,
  event_type        text,
  first_seen        timestamptz not null,
  last_seen         timestamptz not null,
  is_breaking       boolean not null default false,
  updated_at        timestamptz not null default now()
);
create index if not exists news_global_events_rank_idx on public.news_global_events (rank);
alter table public.news_global_events enable row level security;
revoke all on public.news_global_events from public, anon, authenticated;
grant select on public.news_global_events to anon, authenticated;
drop policy if exists global_events_read on public.news_global_events;
create policy global_events_read on public.news_global_events for select using (true);

-- 4) Insert: carry the new tags ---------------------------------------------------------------------
create or replace function public.news_insert_articles(p_rows jsonb)
returns table (id bigint, url_hash text) language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
  cid bigint;
  new_id bigint;
  groups jsonb := '{}';
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    cid := null;
    if r ? 'match_id' and (r->>'match_id') is not null then
      select a.cluster_id into cid from public.news_articles a where a.id = (r->>'match_id')::bigint;
      if cid is null then
        insert into public.news_clusters default values returning news_clusters.id into cid;
        update public.news_articles a set cluster_id = cid where a.id = (r->>'match_id')::bigint;
      end if;
    end if;
    if r->>'group_key' is not null then
      if groups ? (r->>'group_key') then
        if cid is null then cid := (groups->>(r->>'group_key'))::bigint; end if;
      elsif r->>'group_size' is not null and (r->>'group_size')::int > 1 then
        if cid is null then insert into public.news_clusters default values returning news_clusters.id into cid; end if;
        groups := groups || jsonb_build_object(r->>'group_key', cid);
      end if;
    end if;

    insert into public.news_articles as a (
      source_id, guid, url, url_hash, title, title_original, title_en, summary, summary_kind, language, translated,
      category, categories, image_url, published_at, published_estimated, title_tokens, cluster_id,
      duplicate_of, verification, is_breaking, breaking_until, importance, status,
      countries, region, event_type, impact, wire)
    values (
      (r->>'source_id')::int, r->>'guid', r->>'url', r->>'url_hash', r->>'title', r->>'title_original', left(r->>'title_en', 400),
      r->>'summary', coalesce(r->>'summary_kind', 'feed'), coalesce(r->>'language', 'ar'),
      coalesce((r->>'translated')::boolean, false), r->>'category',
      coalesce(array(select jsonb_array_elements_text(r->'categories')), '{}'),
      r->>'image_url', (r->>'published_at')::timestamptz, coalesce((r->>'published_estimated')::boolean, false),
      coalesce(array(select jsonb_array_elements_text(r->'title_tokens')), '{}'), cid,
      nullif(r->>'dup_of', '')::bigint, coalesce(r->>'verification', 'reported'),
      coalesce((r->>'is_breaking')::boolean, false), (r->>'breaking_until')::timestamptz,
      coalesce((r->>'importance')::smallint, 0), coalesce(r->>'status', 'published'),
      coalesce(array(select upper(x) from jsonb_array_elements_text(r->'countries') x where x ~* '^[a-z]{2}$' limit 5), '{}'),
      nullif(r->>'region', ''), nullif(r->>'event_type', ''),
      least(30, greatest(0, coalesce((r->>'impact')::int, 0)))::smallint, nullif(r->>'wire', ''))
    on conflict do nothing
    returning a.id into new_id;

    if new_id is not null then
      id := new_id; url_hash := r->>'url_hash';
      return next;
    end if;
  end loop;
end $$;

-- 5) Cross-language matching: recent reports with a real event type -------------------------------
create or replace function public.news_recent_signatures(p_hours int default 3)
returns table (article_id bigint, cluster_id bigint, source_id int, language text, countries text[], event_type text,
               title text, published_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.id, a.cluster_id, a.source_id, a.language, a.countries, a.event_type, coalesce(a.title_en, a.title), a.published_at
  from public.news_articles a
  where a.created_at > now() - make_interval(hours => least(greatest(p_hours, 1), 12))
    and a.duplicate_of is null and a.status = 'published'
    and a.event_type is not null and a.event_type not in ('general', 'routine', 'government')
    and cardinality(a.countries) > 0
  order by a.published_at desc
  limit 400;
$$;

-- 6) Ranking input: recent reports, with their publisher group -------------------------------------
create or replace function public.news_rank_input(p_hours int default 12)
returns table (id bigint, cluster_id bigint, source_id int, publisher text, reliability smallint, official boolean,
               published_at timestamptz, language text, title text, title_en text, summary text, countries text[],
               event_type text, impact smallint, wire text, verification text, title_tokens text[])
language sql stable security definer set search_path = '' as $$
  select a.id, a.cluster_id, a.source_id, coalesce(s.publisher, s.slug), s.reliability, s.kind = 'official',
         a.published_at, a.language, a.title, a.title_en, left(a.summary, 300), a.countries,
         a.event_type, a.impact, a.wire, a.verification, a.title_tokens
  from public.news_articles a join public.news_sources s on s.id = a.source_id
  where a.published_at > now() - make_interval(hours => least(greatest(p_hours, 1), 24))
    and a.status = 'published' and a.duplicate_of is null
    and (a.impact >= 8 or a.cluster_id is not null or a.event_type is null)
  order by a.published_at desc
  limit 1500;
$$;

-- 7) Save the ranking and flag the lead report of each breaking event ------------------------------
create or replace function public.news_save_global_events(p jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare n int; hrs int := coalesce((select (value)::text::int from public.news_settings where key = 'breaking_hours'), 6);
begin
  delete from public.news_global_events where true;
  insert into public.news_global_events (key, rank, cluster_id, lead_article_id, lead_ar_id, lead_en_id, first_article_id,
      score, parts, status, confirmed, single_source, allegation, independent_count, publisher_count, report_count,
      countries, region, event_type, first_seen, last_seen, is_breaking)
  select e.key, e.rank, e.cluster_id, e.lead_article_id, e.lead_ar_id, e.lead_en_id, e.first_article_id,
      least(100, greatest(0, e.score)), coalesce(e.parts, '{}'), e.status, e.confirmed, e.single_source, e.allegation,
      e.independent_count, e.publisher_count, e.report_count, coalesce(e.countries, '{}'), e.region, e.event_type,
      e.first_seen, e.last_seen, e.is_breaking
  from jsonb_to_recordset(p) as e(key text, rank smallint, cluster_id bigint, lead_article_id bigint, lead_ar_id bigint,
      lead_en_id bigint, first_article_id bigint, score int, parts jsonb, status text, confirmed boolean, single_source boolean,
      allegation boolean, independent_count int, publisher_count int, report_count int, countries text[], region text,
      event_type text, first_seen timestamptz, last_seen timestamptz, is_breaking boolean)
  where exists (select 1 from public.news_articles a where a.id = e.lead_article_id)
  on conflict (key) do nothing;
  get diagnostics n = row_count;

  -- Breaking events reach the ticker through their lead reports (Arabic and English heads of the event).
  update public.news_articles a set is_breaking = true,
         breaking_until = greatest(coalesce(a.breaking_until, now()), now() + make_interval(hours => least(hrs, 3)))
  from public.news_global_events g
  where g.is_breaking and a.id in (g.lead_article_id, g.lead_ar_id, g.lead_en_id)
    and a.status = 'published' and (not a.is_breaking or a.breaking_until < now() + interval '1 hour');
  begin
    perform realtime.send(jsonb_build_object('events', n, 'at', now()), 'global_events', 'news-feed', false);
  exception when others then null;
  end;
  return n;
end $$;

-- 8) Late translation of the top English stories (headline only, never editor-edited rows) --------
create or replace function public.news_set_translations(p jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.news_articles a set
    title_original = a.title, title = left(r.title, 400), title_tokens = coalesce(r.title_tokens, a.title_tokens),
    summary = case when r.summary is not null and a.summary_kind <> 'editor' then left(r.summary, 1000) else a.summary end,
    summary_kind = case when r.summary is not null and a.summary_kind <> 'editor' then 'ai' else a.summary_kind end,
    translated = true, language = 'ar', title_en = coalesce(a.title_en, a.title)
  from jsonb_to_recordset(p) as r(id bigint, title text, summary text, title_tokens text[])
  where a.id = r.id and not a.translated and not a.edited and a.language = 'en'
    and char_length(r.title) between 3 and 400;
  get diagnostics n = row_count;
  return n;
end $$;

-- 9) The old cluster-size promotion ignored wire copies; the global ranking now decides (step 7).
create or replace function public.news_promote_multi_source_breaking(p_min_sources int default 2)
returns int language sql security definer set search_path = '' as $$ select 0; $$;

revoke execute on function public.news_recent_signatures(int), public.news_rank_input(int),
  public.news_save_global_events(jsonb), public.news_set_translations(jsonb),
  public.news_promote_multi_source_breaking(int) from public, anon, authenticated;
grant execute on function public.news_recent_signatures(int), public.news_rank_input(int),
  public.news_save_global_events(jsonb), public.news_set_translations(jsonb) to service_role;

-- 10) Public read helper: countries that currently have news (for the country filter) ----------------
create or replace function public.news_country_counts(p_hours int default 48)
returns table (country text, region text, n bigint)
language sql stable security invoker set search_path = '' as $$
  select c, max(a.region), count(*)
  from public.news_articles a, unnest(a.countries[1:1]) c
  where a.status = 'published' and a.duplicate_of is null
    and a.published_at > now() - make_interval(hours => least(greatest(p_hours, 1), 168))
  group by c order by count(*) desc limit 120;
$$;
grant execute on function public.news_country_counts(int) to anon, authenticated;

-- 11) New international sources, one or more per world region -------------------------------------
-- Each feed was fetched from this Supabase project on 2026-11-06 (HTTP 200, valid RSS/Atom, items from the
-- last 24 h) and its robots.txt read; the ingest function re-checks robots.txt before the first fetch.
-- Kept in English (and translated when the AI budget allows). Headline + short excerpt + link; images off.
-- Not added: Reuters, AP, AFP (no public RSS; apnews.com/index.rss → 403), CNN (edition feed: TLS error,
-- cnn_latest frozen since 2024), NHK World (English feed 404; Japanese feeds stale), Kyodo (404),
-- News24 (403), GDACS (request rejected), RNZ (feed stale), Rappler (robots.txt blocks AI crawlers).
insert into public.news_sources (slug, name_ar, name_en, homepage, feed_url, language, country, kind, reliability,
  default_category, topical, tz_offset_minutes, poll_interval_minutes, min_interval_minutes, max_items, enabled,
  publisher, national, terms_note) values
  ('usgs-quakes', 'هيئة المسح الجيولوجي الأمريكية — زلازل', 'USGS Earthquakes (M4.5+)', 'https://earthquake.usgs.gov/earthquakes/',
   'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.atom', 'en', null, 'official', 5, 'world', false, 0, 5, 3, 10, true, 'usgs', false, 'US government data feed (public domain)'),
  ('euronews-en', 'يورونيوز الإنجليزية', 'Euronews English', 'https://www.euronews.com/',
   'https://www.euronews.com/rss?level=theme&name=news', 'en', 'FR', 'media', 4, 'world', false, 0, 5, 3, 15, true, 'euronews', false, 'Public RSS'),
  ('rfi-en', 'إذاعة فرنسا الدولية', 'RFI English', 'https://www.rfi.fr/en/',
   'https://www.rfi.fr/en/rss', 'en', 'FR', 'media', 4, 'world', false, 0, 10, 5, 15, true, 'fmm', false, 'Public RSS'),
  ('cbs-world', 'سي بي إس نيوز — العالم', 'CBS News World', 'https://www.cbsnews.com/world/',
   'https://www.cbsnews.com/latest/rss/world', 'en', 'US', 'media', 4, 'world', false, 0, 5, 3, 15, true, 'cbs', false, 'Public RSS'),
  ('cbc-world', 'سي بي سي الكندية', 'CBC News World', 'https://www.cbc.ca/news/world',
   'https://www.cbc.ca/webfeed/rss/rss-world', 'en', 'CA', 'media', 4, 'world', false, 0, 10, 5, 15, true, 'cbc', false, 'Public RSS'),
  ('mexiconewsdaily', 'مكسيكو نيوز ديلي', 'Mexico News Daily', 'https://mexiconewsdaily.com/',
   'https://www.mexiconewsdaily.com/feed/', 'en', 'MX', 'media', 3, 'world', false, 0, 15, 5, 10, true, null, true, 'Public RSS'),
  ('mercopress', 'ميركوبرس (أمريكا الجنوبية)', 'MercoPress', 'https://en.mercopress.com/',
   'https://en.mercopress.com/rss', 'en', 'UY', 'media', 3, 'world', false, 0, 15, 5, 10, true, null, false, 'Public RSS'),
  ('agenciabrasil-en', 'وكالة البرازيل', 'Agência Brasil (English)', 'https://agenciabrasil.ebc.com.br/en',
   'https://agenciabrasil.ebc.com.br/en/rss/ultimasnoticias/feed.xml', 'en', 'BR', 'agency', 4, 'world', false, 0, 15, 5, 10, true, null, true, 'Public RSS of the Brazilian public news agency'),
  ('batimes', 'بوينس آيرس تايمز', 'Buenos Aires Times', 'https://www.batimes.com.ar/',
   'https://www.batimes.com.ar/feed', 'en', 'AR', 'media', 3, 'world', false, 0, 15, 5, 15, true, null, true, 'Public RSS'),
  ('africanews', 'أفريكا نيوز', 'Africanews', 'https://www.africanews.com/',
   'https://www.africanews.com/feed/rss', 'en', 'CG', 'media', 4, 'world', false, 0, 10, 5, 15, true, 'euronews', false, 'Public RSS'),
  ('premiumtimes', 'بريميوم تايمز (نيجيريا)', 'Premium Times Nigeria', 'https://www.premiumtimesng.com/',
   'https://www.premiumtimesng.com/feed', 'en', 'NG', 'media', 3, 'world', false, 0, 15, 5, 10, true, null, true, 'Public RSS'),
  ('cna-world', 'تشانل نيوز آسيا', 'CNA (Channel NewsAsia)', 'https://www.channelnewsasia.com/',
   'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6311', 'en', 'SG', 'media', 4, 'world', false, 0, 5, 3, 15, true, 'mediacorp', false, 'Public RSS'),
  ('straitstimes-world', 'ستريتس تايمز — العالم', 'The Straits Times World', 'https://www.straitstimes.com/world',
   'https://www.straitstimes.com/news/world/rss.xml', 'en', 'SG', 'media', 4, 'world', false, 0, 10, 5, 15, true, 'sph', false, 'Public RSS'),
  ('scmp-world', 'ساوث تشاينا مورنينغ بوست', 'South China Morning Post', 'https://www.scmp.com/',
   'https://www.scmp.com/rss/91/feed', 'en', 'HK', 'media', 4, 'world', false, 0, 10, 5, 15, true, 'scmp', false, 'Public RSS'),
  ('yonhap-en', 'وكالة يونهاب الكورية', 'Yonhap News Agency', 'https://en.yna.co.kr/',
   'https://en.yna.co.kr/RSS/news.xml', 'en', 'KR', 'agency', 4, 'world', false, 0, 5, 3, 15, true, 'yonhap', true, 'Public RSS'),
  ('japantimes', 'جابان تايمز', 'The Japan Times', 'https://www.japantimes.co.jp/',
   'https://www.japantimes.co.jp/feed/', 'en', 'JP', 'media', 4, 'world', false, 0, 10, 5, 15, true, null, true, 'Public RSS (/feed/ is not disallowed by robots.txt)'),
  ('thehindu-intl', 'ذا هندو — دولي', 'The Hindu International', 'https://www.thehindu.com/news/international/',
   'https://www.thehindu.com/news/international/feeder/default.rss', 'en', 'IN', 'media', 4, 'world', false, 0, 10, 5, 15, true, 'thehindu', false, 'Public RSS'),
  ('dawn', 'دون (باكستان)', 'Dawn', 'https://www.dawn.com/',
   'https://www.dawn.com/feeds/home', 'en', 'PK', 'media', 4, 'world', false, 0, 10, 5, 15, true, null, true, 'Public RSS'),
  ('timesca', 'تايمز أوف سنترال آسيا', 'The Times of Central Asia', 'https://timesca.com/',
   'https://timesca.com/feed/', 'en', null, 'media', 3, 'world', false, 0, 15, 5, 10, true, null, false, 'Public RSS'),
  ('akipress', 'أكي برس (قرغيزستان)', 'AKIpress', 'https://akipress.com/',
   'https://akipress.com/rss/news_en.rss', 'en', 'KG', 'agency', 3, 'world', false, 0, 15, 5, 10, true, null, true, 'Public RSS'),
  ('abc-au', 'إيه بي سي الأسترالية', 'ABC News Australia', 'https://www.abc.net.au/news',
   'https://www.abc.net.au/news/feed/51120/rss.xml', 'en', 'AU', 'media', 4, 'world', false, 0, 10, 5, 15, true, 'abc-au', true, 'Public RSS (Just In)')
on conflict (slug) do nothing;

update public.news_settings set value = '25' where key = 'max_sources_per_run' and value::int < 25;
