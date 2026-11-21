-- Global intelligence, performance fix (2026-11-21): the whole-word matcher of migration 30 compared every trend
-- term with every report one by one (~5 million function calls) and exhausted the free instance's memory.
-- Reports, videos and terms are now split into words once, and matched with a single hash join on the first word;
-- multi-word terms are then checked as a phrase. Same rules and results, a few hundred times less work.

create or replace function public.intel_trends_refresh() returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare n int;
begin
  create temp table if not exists _it_terms (key text primary key, term text, geos text[], n_countries int, traffic_max int,
    first_seen timestamptz, last_seen timestamptz, news jsonb, first_word text, phrase text, n_words int) on commit drop;
  create temp table if not exists _it_docs (kind char(1), id text, at timestamptz, cat text, pub text, pop int, ws text) on commit drop;
  create temp table if not exists _it_words (kind char(1), id text, word text) on commit drop;
  truncate _it_terms, _it_docs, _it_words;

  insert into _it_terms
  select k.key, k.term, k.geos, k.n_countries, k.traffic_max, k.first_seen, k.last_seen, k.news,
         w[1], ' ' || array_to_string(w, ' ') || ' ', coalesce(array_length(w, 1), 0)
  from (
    select lower(btrim(t.title)) as key, min(t.title) as term, array_agg(distinct t.geo order by t.geo) as geos,
           count(distinct t.geo)::int as n_countries, max(t.traffic) as traffic_max, min(t.first_seen_at) as first_seen,
           max(t.seen_at) as last_seen, (array_agg(t.news order by t.traffic desc nulls last))[1] as news
    from news_trends t
    where t.seen_at > now() - interval '6 hours' and char_length(btrim(t.title)) between 4 and 120
      and btrim(t.title) !~ '^[0-9\s.,:/-]+$'
    group by lower(btrim(t.title))
  ) k cross join lateral intel_words(k.key) w
  where coalesce(array_length(w, 1), 0) between 1 and 8;

  insert into _it_docs
  select 'a', x.id::text, x.published_at, x.category, coalesce(s.publisher, s.slug), null,
         ' ' || array_to_string(intel_words(x.title) || intel_words(x.title_en), ' ') || ' '
  from news_articles x join news_sources s on s.id = x.source_id
  where x.status = 'published' and x.duplicate_of is null and x.published_at > now() - interval '24 hours';
  insert into _it_docs
  select 'v', v.video_id, v.published_at, v.section, null, v.popularity,
         ' ' || array_to_string(intel_words(v.title) || intel_words(v.title_ar), ' ') || ' '
  from intel_yt_videos v where v.published_at > now() - interval '72 hours';

  insert into _it_words
  select distinct d.kind, d.id, u.word from _it_docs d cross join lateral unnest(string_to_array(btrim(d.ws), ' ')) u(word) where u.word <> '';
  create index on _it_words (word);
  analyze _it_terms; analyze _it_docs; analyze _it_words;

  with m as (   -- one row per (term, matching document)
    select distinct t.key, d.kind, d.id, d.at, d.cat, d.pub, d.pop
    from _it_terms t
    join _it_words w on w.word = t.first_word
    join _it_docs d on d.kind = w.kind and d.id = w.id
    where t.n_words = 1 or position(t.phrase in d.ws) > 0
  ), agg as (
    select t.*,
      count(*) filter (where m.kind = 'a')::int as hits,
      count(distinct m.pub) filter (where m.kind = 'a')::int as publishers,
      (array_agg(m.id::bigint order by m.at desc) filter (where m.kind = 'a'))[1:3] as ids,
      mode() within group (order by m.cat) filter (where m.kind = 'a') as cat,
      count(*) filter (where m.kind = 'v')::int as vhits,
      (array_agg(m.id order by m.pop desc nulls last) filter (where m.kind = 'v'))[1:3] as vids,
      (array_agg(m.cat) filter (where m.kind = 'v'))[1] as vcat
    from _it_terms t left join m on m.key = t.key
    group by t.key, t.term, t.geos, t.n_countries, t.traffic_max, t.first_seen, t.last_seen, t.news, t.first_word, t.phrase, t.n_words
  ), scored as (
    select a.*,
      ((a.n_countries > 0)::int + (a.hits > 0)::int + (a.vhits > 0)::int)::smallint as platforms,
      least(100, round(
          30 * least(1, a.n_countries / 5.0)
        + 20 * least(1, log(1 + coalesce(a.traffic_max, 0)) / 6)
        + 30 * least(1, coalesce(a.publishers, 0) / 5.0)
        + 20 * least(1, coalesce(a.vhits, 0) / 3.0)))::smallint as score
    from agg a
  )
  insert into intel_trends as t (key, term, term_is_ar, geos, n_countries, traffic_max, news_hits, news_publishers, video_hits, platforms,
                                 is_global, category, score, prev_score, direction, google_news, article_ids, video_ids, first_seen_at, last_seen_at, updated_at)
  select s.key, s.term, s.term ~ '[ء-ي]', s.geos, s.n_countries, s.traffic_max, coalesce(s.hits, 0), coalesce(s.publishers, 0), coalesce(s.vhits, 0), s.platforms,
         s.platforms >= 2 and (s.n_countries >= 3 or (s.n_countries >= 2 and coalesce(s.publishers, 0) >= 5)),
         coalesce(s.cat, s.vcat), s.score, null, 'new', coalesce(s.news, '[]'), coalesce(s.ids, '{}'), coalesce(s.vids, '{}'), s.first_seen, s.last_seen, now()
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

  delete from intel_trends where last_seen_at < now() - interval '48 hours' or char_length(key) < 4 or key ~ '^[0-9\s.,:/-]+$';
  return jsonb_build_object('trends', n);
end $$;

-- video ↔ search trend: same word index, only the videos of the last 3 days
create or replace function public.intel_video_trend_match() returns int
language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare n int;
begin
  with t as (
    select k.key, k.title, k.traffic, w[1] as first_word, ' ' || array_to_string(w, ' ') || ' ' as phrase, array_length(w, 1) as n_words
    from (select distinct on (lower(btrim(title))) lower(btrim(title)) as key, title, traffic from news_trends
          where seen_at > now() - interval '12 hours' and char_length(btrim(title)) >= 4 and btrim(title) !~ '^[0-9\s.,:/-]+$'
          order by lower(btrim(title)), traffic desc nulls last) k
    cross join lateral intel_words(k.key) w
    where coalesce(array_length(w, 1), 0) between 1 and 8
  ), v as (
    select x.video_id, intel_words(x.title) as w, ' ' || array_to_string(intel_words(x.title), ' ') || ' ' as ws
    from intel_yt_videos x where x.published_at > now() - interval '3 days'
  ), best as (
    select distinct on (v.video_id) v.video_id, t.title
    from v join t on t.first_word = any(v.w)
    where t.n_words = 1 or position(t.phrase in v.ws) > 0
    order by v.video_id, t.traffic desc nulls last
  )
  update intel_yt_videos x set trend_match = b.title
  from (select v.video_id, best.title from v left join best using (video_id)) b
  where b.video_id = x.video_id and x.trend_match is distinct from b.title;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.intel_trends_refresh(), public.intel_video_trend_match() from public, anon, authenticated;
select cron.alter_job(jobid, active := true) from cron.job where jobname = 'intel-trends';
select cron.alter_job(jobid, active := true) from cron.job where jobname = 'intel-youtube';
