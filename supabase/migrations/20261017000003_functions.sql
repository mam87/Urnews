-- Ingestion, search, stats, alerting and retention functions.

-- ---------------------------------------------------------------------------
-- Ingest job (called by the edge function with the service_role key)
-- ---------------------------------------------------------------------------

create or replace function public.check_ingest_token(p_token text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select decrypted_secret = p_token and length(p_token) >= 32
       from vault.decrypted_secrets where name = 'ingest_token' limit 1),
    false);
$$;

create or replace function public.begin_ingest_run()
returns bigint language plpgsql security definer set search_path = '' as $$
declare rid bigint;
begin
  perform pg_advisory_xact_lock(hashtext('news_ingest_lock'));
  update public.ingest_runs set status = 'error', finished_at = now(), error = 'run did not finish (timeout or crash)'
    where status = 'running' and started_at < now() - interval '5 minutes';
  if exists (select 1 from public.ingest_runs where status = 'running') then return null; end if;
  if (select value from public.settings where key = 'ingest_enabled') = 'false'::jsonb then return null; end if;
  insert into public.ingest_runs default values returning id into rid;
  return rid;
end $$;

-- Leases due sources so overlapping runs never fetch the same feed.
create or replace function public.claim_due_sources(p_run bigint, p_limit int)
returns setof public.sources language plpgsql security definer set search_path = '' as $$
begin
  return query
  with due as (
    select s.id from public.sources s
    where s.enabled and (s.next_fetch_at is null or s.next_fetch_at <= now())
    order by s.next_fetch_at nulls first, s.reliability desc
    limit greatest(1, least(p_limit, 25))
    for update skip locked
  )
  update public.sources s set next_fetch_at = now() + interval '10 minutes', last_fetch_at = now()
  from due where s.id = due.id
  returning s.*;
end $$;

create or replace function public.record_fetch(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  sid int := (p->>'source_id')::int;
  ok boolean := (p->>'status') in ('ok', 'not_modified');
begin
  insert into public.fetch_logs (run_id, source_id, status, http_status, items_found, items_new, duration_ms, attempts, error)
  values ((p->>'run_id')::bigint, sid, p->>'status', nullif(p->>'http_status','')::smallint,
          coalesce((p->>'items_found')::int, 0), coalesce((p->>'items_new')::int, 0),
          (p->>'duration_ms')::int, coalesce((p->>'attempts')::smallint, 1), left(p->>'error', 1000));

  update public.sources set
    last_status          = p->>'status',
    last_http_status     = nullif(p->>'http_status','')::smallint,
    last_error           = case when ok then null else left(p->>'error', 1000) end,
    last_success_at      = case when ok then now() else last_success_at end,
    consecutive_failures = case when ok then 0 else consecutive_failures + 1 end,
    next_fetch_at        = (p->>'next_fetch_at')::timestamptz,
    etag                 = case when p ? 'etag' then p->>'etag' else etag end,
    last_modified        = case when p ? 'last_modified' then p->>'last_modified' else last_modified end,
    robots_checked_at    = case when p ? 'robots_allowed' then now() else robots_checked_at end,
    robots_allowed       = case when p ? 'robots_allowed' then (p->>'robots_allowed')::boolean else robots_allowed end,
    total_items          = total_items + coalesce((p->>'items_new')::int, 0)
  where id = sid;

  if ok then
    update public.alerts set resolved_at = now()
      where kind = 'source_failing:' || sid and resolved_at is null;
  end if;
end $$;

-- Which of these URL hashes / guids are already stored?
create or replace function public.existing_hashes(p_hashes text[])
returns setof text language sql stable security definer set search_path = '' as $$
  select url_hash from public.articles where url_hash = any(p_hashes);
$$;

-- Candidate near-duplicates for a batch of new titles (trigram prefilter; the
-- edge function then confirms with token overlap before clustering).
create or replace function public.similar_articles(p_titles text[], p_hours int default 36)
returns table (idx bigint, article_id bigint, cluster_id bigint, source_id int, sim real, title_tokens text[], language text)
language sql stable security definer set search_path = '' as $$
  select i.idx, a.id, a.cluster_id, a.source_id, a.sim, a.title_tokens, a.language
  from unnest(p_titles) with ordinality as i(t, idx)
  cross join lateral (
    select x.id, x.cluster_id, x.source_id, x.title_tokens, x.language,
           extensions.similarity(x.norm_title, public.news_normalize(i.t)) as sim
    from public.articles x
    where x.created_at > now() - make_interval(hours => least(greatest(p_hours, 1), 96))
      and x.duplicate_of is null
      and x.norm_title operator(extensions.%) public.news_normalize(i.t)
    order by sim desc
    limit 5
  ) a;
$$;

-- Insert a batch. Each row may carry:
--   match_id   : existing article it belongs with (same event)  -> join/create cluster
--   dup_of     : existing article it duplicates (same source)   -> stored as duplicate
--   group_key  : rows in this batch about the same event         -> share one cluster
create or replace function public.insert_articles(p_rows jsonb)
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
      select a.cluster_id into cid from public.articles a where a.id = (r->>'match_id')::bigint;
      if cid is null then
        insert into public.clusters default values returning clusters.id into cid;
        update public.articles a set cluster_id = cid where a.id = (r->>'match_id')::bigint;
      end if;
    end if;
    if r->>'group_key' is not null then
      if groups ? (r->>'group_key') then
        if cid is null then cid := (groups->>(r->>'group_key'))::bigint; end if;
      elsif r->>'group_size' is not null and (r->>'group_size')::int > 1 then
        if cid is null then insert into public.clusters default values returning clusters.id into cid; end if;
        groups := groups || jsonb_build_object(r->>'group_key', cid);
      end if;
    end if;

    insert into public.articles as a (
      source_id, guid, url, url_hash, title, title_original, summary, summary_kind, language, translated,
      category, categories, image_url, published_at, published_estimated, title_tokens, cluster_id,
      duplicate_of, verification, is_breaking, breaking_until, importance, status)
    values (
      (r->>'source_id')::int, r->>'guid', r->>'url', r->>'url_hash', r->>'title', r->>'title_original',
      r->>'summary', coalesce(r->>'summary_kind', 'feed'), coalesce(r->>'language', 'ar'),
      coalesce((r->>'translated')::boolean, false), r->>'category',
      coalesce(array(select jsonb_array_elements_text(r->'categories')), '{}'),
      r->>'image_url', (r->>'published_at')::timestamptz, coalesce((r->>'published_estimated')::boolean, false),
      coalesce(array(select jsonb_array_elements_text(r->'title_tokens')), '{}'), cid,
      nullif(r->>'dup_of', '')::bigint, coalesce(r->>'verification', 'reported'),
      coalesce((r->>'is_breaking')::boolean, false), (r->>'breaking_until')::timestamptz,
      coalesce((r->>'importance')::smallint, 0), coalesce(r->>'status', 'published'))
    on conflict do nothing
    returning a.id into new_id;

    if new_id is not null then
      id := new_id; url_hash := r->>'url_hash';
      return next;
    end if;
  end loop;
end $$;

-- Promote events covered by several independent sources to breaking (never to "confirmed").
create or replace function public.promote_multi_source_breaking(p_min_sources int default 3)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  with hot as (
    select c.id from public.clusters c
    where c.source_count >= p_min_sources and c.last_seen > now() - interval '90 minutes'
      and c.first_seen > now() - interval '3 hours'
  )
  update public.articles a set is_breaking = true, breaking_until = greatest(coalesce(a.breaking_until, now()), now() + interval '3 hours')
  from hot, public.clusters c
  where c.id = hot.id and a.id = c.lead_article_id and not a.is_breaking
    and a.status = 'published' and a.importance >= 40;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.ai_take(p_n int)
returns int language plpgsql security definer set search_path = '' as $$
declare
  lim int := coalesce((select (value)::text::int from public.settings where key = 'ai_daily_limit'), 0);
  used int;
  granted int;
begin
  insert into public.ai_usage (day, calls) values (current_date, 0) on conflict (day) do nothing;
  select calls into used from public.ai_usage where day = current_date for update;
  granted := greatest(0, least(p_n, lim - used));
  update public.ai_usage set calls = calls + granted where day = current_date;
  return granted;
end $$;

create or replace function public.finish_ingest_run(p_run bigint, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare n_new int := coalesce((p->>'items_new')::int, 0);
begin
  update public.ingest_runs set
    finished_at = now(),
    status = coalesce(p->>'status', 'ok'),
    sources_attempted = coalesce((p->>'sources_attempted')::int, 0),
    sources_ok = coalesce((p->>'sources_ok')::int, 0),
    sources_failed = coalesce((p->>'sources_failed')::int, 0),
    items_seen = coalesce((p->>'items_seen')::int, 0),
    items_new = n_new,
    ai_calls = coalesce((p->>'ai_calls')::int, 0),
    duration_ms = (extract(epoch from now() - started_at) * 1000)::int,
    error = left(p->>'error', 2000)
  where id = p_run;

  if coalesce(p->>'status', 'ok') <> 'error' then
    update public.alerts set resolved_at = now() where kind = 'ingest_stalled' and resolved_at is null;
  end if;

  if n_new > 0 then
    perform public.promote_multi_source_breaking();
    -- One lightweight broadcast per run; browsers then fetch only rows newer than they have.
    begin
      perform realtime.send(jsonb_build_object('new', n_new, 'at', now()), 'new_articles', 'news-feed', false);
    exception when others then null; -- realtime is best-effort; clients also poll
    end;
  end if;
end $$;

-- Broadcast editorial changes (hide, pin, breaking) so open pages refresh.
create or replace function public.articles_broadcast_edit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and (
       new.status is distinct from old.status or new.pinned is distinct from old.pinned or
       new.is_breaking is distinct from old.is_breaking or new.title is distinct from old.title or
       new.summary is distinct from old.summary or new.verification is distinct from old.verification) then
    begin
      perform realtime.send(jsonb_build_object('id', new.id), 'article_changed', 'news-feed', false);
    exception when others then null;
    end;
  end if;
  return null;
end $$;
create trigger articles_broadcast after update on public.articles
  for each row execute function public.articles_broadcast_edit();

-- ---------------------------------------------------------------------------
-- Public read helpers
-- ---------------------------------------------------------------------------

create or replace function public.search_articles(p_q text, p_category text default null, p_limit int default 30, p_before timestamptz default null)
returns setof public.articles language plpgsql stable security invoker set search_path = '' as $$
declare
  q text := public.news_normalize(left(coalesce(p_q, ''), 100));
  terms text[];
begin
  if char_length(q) < 2 then return; end if;
  terms := (select array_agg(t) from (select unnest(string_to_array(q, ' ')) t limit 6) s where char_length(t) >= 2);
  if terms is null then return; end if;
  return query
    select a.* from public.articles a
    where a.status = 'published' and a.duplicate_of is null
      and (p_category is null or a.categories @> array[p_category])
      and (p_before is null or a.published_at < p_before)
      and not exists (
        select 1 from unnest(terms) t
        where a.norm_title not like '%' || t || '%'
          and public.news_normalize(coalesce(a.summary, '')) not like '%' || t || '%')
    order by a.published_at desc
    limit least(greatest(coalesce(p_limit, 30), 1), 50);
end $$;
grant execute on function public.search_articles(text, text, int, timestamptz) to anon, authenticated;

create or replace function public.site_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'last_run_at',      (select max(finished_at) from public.ingest_runs where status in ('ok', 'partial')),
    'last_new_at',      (select max(created_at) from public.articles),
    'interval_minutes', (select (value)::text::int from public.settings where key = 'scheduler_interval_minutes'),
    'sources_active',   (select count(*) from public.sources where enabled),
    'sources_healthy',  (select count(*) from public.sources where enabled and consecutive_failures = 0 and last_success_at > now() - interval '1 hour'),
    'articles_24h',     (select count(*) from public.articles where created_at > now() - interval '24 hours' and status = 'published' and duplicate_of is null),
    'server_time',      now()
  );
$$;
grant execute on function public.site_status() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin helpers (security definer + explicit is_admin() check)
-- ---------------------------------------------------------------------------

create or replace function public.admin_sources()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(s) - 'etag' - 'last_modified' || jsonb_build_object(
      'fetches_24h', (select count(*) from public.fetch_logs f where f.source_id = s.id and f.started_at > now() - interval '24 hours'),
      'errors_24h',  (select count(*) from public.fetch_logs f where f.source_id = s.id and f.started_at > now() - interval '24 hours' and f.status in ('error','blocked')),
      'new_24h',     (select coalesce(sum(items_new), 0) from public.fetch_logs f where f.source_id = s.id and f.started_at > now() - interval '24 hours'),
      'published_7d',(select count(*) from public.articles a where a.source_id = s.id and a.created_at > now() - interval '7 days'),
      'rejected_7d', (select count(*) from public.articles a where a.source_id = s.id and a.created_at > now() - interval '7 days' and a.status in ('rejected','hidden'))
    ) order by s.enabled desc, s.name_ar)
    from public.sources s), '[]'::jsonb);
end $$;
grant execute on function public.admin_sources() to authenticated;

create or replace function public.admin_stats()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'runs_24h',        (select count(*) from public.ingest_runs where started_at > now() - interval '24 hours'),
    'runs_failed_24h', (select count(*) from public.ingest_runs where started_at > now() - interval '24 hours' and status = 'error'),
    'last_run',        (select to_jsonb(r) from public.ingest_runs r order by started_at desc limit 1),
    'last_ok_run_at',  (select max(finished_at) from public.ingest_runs where status in ('ok','partial')),
    'articles_total',  (select count(*) from public.articles),
    'articles_24h',    (select count(*) from public.articles where created_at > now() - interval '24 hours'),
    'duplicates_24h',  (select count(*) from public.articles where created_at > now() - interval '24 hours' and duplicate_of is not null),
    'breaking_now',    (select count(*) from public.articles where is_breaking and breaking_until > now() and status = 'published'),
    'pending',         (select count(*) from public.articles where status = 'pending'),
    'by_category_24h', (select coalesce(jsonb_object_agg(category, n), '{}') from (select category, count(*) n from public.articles where created_at > now() - interval '24 hours' and duplicate_of is null group by 1) x),
    'hourly_24h',      (select coalesce(jsonb_agg(jsonb_build_object('h', h, 'n', n) order by h), '[]') from (select date_trunc('hour', created_at) h, count(*) n from public.articles where created_at > now() - interval '24 hours' group by 1) x),
    'ai_today',        (select calls from public.ai_usage where day = current_date),
    'open_alerts',     (select coalesce(jsonb_agg(to_jsonb(a) order by created_at desc), '[]') from public.alerts a where resolved_at is null),
    'db_size',         pg_size_pretty(pg_database_size(current_database()))
  );
end $$;
grant execute on function public.admin_stats() to authenticated;

-- ---------------------------------------------------------------------------
-- Scheduler, watchdog, retention (run by pg_cron)
-- ---------------------------------------------------------------------------

create or replace function public.call_edge_function(p_name text, p_body jsonb default '{}')
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  base text := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url' limit 1);
  tok  text := (select decrypted_secret from vault.decrypted_secrets where name = 'ingest_token' limit 1);
begin
  if base is null or tok is null then
    raise warning 'vault secrets project_url / ingest_token missing';
    return null;
  end if;
  return net.http_post(
    url := base || '/functions/v1/' || p_name,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-ingest-token', tok),
    body := p_body,
    timeout_milliseconds := 150000);
end $$;

create or replace function public.raise_alert(p_kind text, p_message text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare new_id bigint;
begin
  insert into public.alerts (kind, message) values (p_kind, p_message)
    on conflict (kind) where resolved_at is null do nothing
    returning id into new_id;
  if new_id is not null then
    perform public.call_edge_function('notify', jsonb_build_object('alert_id', new_id));
    return true;
  end if;
  return false;
end $$;

create or replace function public.watchdog()
returns void language plpgsql security definer set search_path = '' as $$
declare
  stall int := coalesce((select (value)::text::int from public.settings where key = 'stall_alert_minutes'), 15);
  last_ok timestamptz := (select max(finished_at) from public.ingest_runs where status in ('ok','partial'));
  src record;
begin
  if (select value from public.settings where key = 'ingest_enabled') = 'false'::jsonb then return; end if;
  if last_ok is null or last_ok < now() - make_interval(mins => stall) then
    perform public.raise_alert('ingest_stalled',
      format('لم ينجح أي تشغيل للجلب منذ %s دقيقة (آخر نجاح: %s)', stall, coalesce(to_char(last_ok at time zone 'Asia/Amman', 'YYYY-MM-DD HH24:MI'), 'أبداً')));
  end if;
  for src in select id, name_ar, consecutive_failures, last_error from public.sources
           where enabled and consecutive_failures >= 5 loop
    perform public.raise_alert('source_failing:' || src.id,
      format('المصدر "%s" فشل %s مرات متتالية: %s', src.name_ar, src.consecutive_failures, left(coalesce(src.last_error, ''), 200)));
  end loop;
  -- resolve source alerts for sources that were disabled
  update public.alerts a set resolved_at = now()
    where a.resolved_at is null and a.kind like 'source_failing:%'
      and not exists (select 1 from public.sources s where 'source_failing:' || s.id = a.kind and s.enabled);
end $$;

create or replace function public.purge_old()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  days int := coalesce((select (value)::text::int from public.settings where key = 'retention_days'), 30);
  n_art int; n_logs int; n_runs int;
begin
  delete from public.articles where created_at < now() - make_interval(days => days) and not pinned;
  get diagnostics n_art = row_count;
  delete from public.fetch_logs where started_at < now() - interval '14 days';
  get diagnostics n_logs = row_count;
  delete from public.ingest_runs where started_at < now() - interval '14 days';
  get diagnostics n_runs = row_count;
  delete from public.clusters c where not exists (select 1 from public.articles a where a.cluster_id = c.id);
  delete from public.alerts where resolved_at < now() - interval '30 days';
  delete from public.ai_usage where day < current_date - 90;
  return jsonb_build_object('articles', n_art, 'fetch_logs', n_logs, 'runs', n_runs);
end $$;

-- Lock down: these are for service_role / pg_cron only.
revoke execute on function
  public.check_ingest_token(text), public.begin_ingest_run(), public.claim_due_sources(bigint, int),
  public.record_fetch(jsonb), public.existing_hashes(text[]), public.similar_articles(text[], int),
  public.insert_articles(jsonb), public.promote_multi_source_breaking(int), public.ai_take(int),
  public.finish_ingest_run(bigint, jsonb), public.call_edge_function(text, jsonb), public.raise_alert(text, text),
  public.watchdog(), public.purge_old(), public.refresh_cluster(bigint)
from public, anon, authenticated;
grant execute on function
  public.check_ingest_token(text), public.begin_ingest_run(), public.claim_due_sources(bigint, int),
  public.record_fetch(jsonb), public.existing_hashes(text[]), public.similar_articles(text[], int),
  public.insert_articles(jsonb), public.ai_take(int), public.finish_ingest_run(bigint, jsonb), public.raise_alert(text, text)
to service_role;
