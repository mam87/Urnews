-- Database tests: dedup, clustering, RLS/permissions, admin auth, scheduler lease, alerts, search, retention.
-- Run: tests/run-sql-tests.sh  (applies migrations to a throwaway local Postgres first)
\set ON_ERROR_STOP 1
create or replace function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'ok - %', label;
end $$;
create or replace function pg_temp.fails(sql text, label text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then raise notice 'ok - % (%)', label, sqlerrm; return; end;
  raise exception 'FAIL (expected error): %', label;
end $$;

select pg_temp.ok(public.news_normalize('إِعلانُ الحكومـــة ٢٠٢٦!') = 'اعلان الحكومه 2026', 'news_normalize matches TS normaliser');

-- fixtures ---------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'random@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'editor@example.com');
insert into public.sources (slug, name_ar, homepage, feed_url, reliability) values
  ('alpha', 'ألفا', 'https://alpha.example/', 'https://alpha.example/rss', 4),
  ('beta',  'بيتا', 'https://beta.example/',  'https://beta.example/rss', 3);

set role service_role;
select pg_temp.ok((select count(*) from public.insert_articles(jsonb_build_array(
  jsonb_build_object('source_id', 1, 'guid', 'g1', 'url', 'https://alpha.example/1', 'url_hash', repeat('a', 64),
    'title', 'الحكومة الأردنية تقر نظام الخدمة المدنية', 'category', 'jordan', 'categories', jsonb_build_array('jordan','politics'),
    'published_at', now() - interval '10 minutes', 'group_key', 'g0', 'group_size', 2, 'importance', 60),
  jsonb_build_object('source_id', 2, 'guid', 'h1', 'url', 'https://beta.example/1', 'url_hash', repeat('b', 64),
    'title', 'الحكومة تقر نظام الخدمة المدنية الجديد', 'category', 'jordan', 'categories', jsonb_build_array('jordan'),
    'published_at', now() - interval '8 minutes', 'group_key', 'g0', 'group_size', 2),
  -- exact duplicate URL hash in same batch: skipped
  jsonb_build_object('source_id', 2, 'guid', 'h1-dup', 'url', 'https://beta.example/1', 'url_hash', repeat('b', 64),
    'title', 'نسخة مكررة', 'category', 'jordan', 'published_at', now()),
  -- same (source, guid) with different URL: skipped (second unique constraint)
  jsonb_build_object('source_id', 1, 'guid', 'g1', 'url', 'https://alpha.example/1b', 'url_hash', repeat('c', 64),
    'title', 'نفس المعرف', 'category', 'jordan', 'published_at', now())
))) = 2, 'insert_articles skips URL-hash and guid duplicates without failing the batch');

select pg_temp.ok((select count(distinct cluster_id) = 1 and count(cluster_id) = 2 from public.articles), 'batch group shares one cluster');
select pg_temp.ok((select source_count = 2 and article_count = 2 and lead_article_id = 1 from public.clusters limit 1), 'cluster stats + lead article maintained by trigger');

select public.insert_articles(jsonb_build_array(
  jsonb_build_object('source_id', 1, 'guid', 'g2', 'url', 'https://alpha.example/2', 'url_hash', repeat('d', 64),
    'title', 'خبر قيد المراجعة', 'category', 'world', 'published_at', now(), 'status', 'pending'),
  jsonb_build_object('source_id', 2, 'guid', 'h3', 'url', 'https://beta.example/3', 'url_hash', repeat('e', 64),
    'title', 'مجلس الوزراء يقر نظام الخدمة المدنية', 'category', 'jordan', 'published_at', now(), 'match_id', 1),
  jsonb_build_object('source_id', 1, 'guid', 'g4', 'url', 'https://alpha.example/4', 'url_hash', repeat('f', 64),
    'title', 'الحكومة الأردنية تقر نظام الخدمة المدنية رسمياً', 'category', 'jordan', 'published_at', now(), 'dup_of', 1),
  jsonb_build_object('source_id', 1, 'guid', 'old', 'url', 'https://alpha.example/old', 'url_hash', repeat('0', 64),
    'title', 'خبر قديم للحذف', 'category', 'world', 'published_at', now() - interval '40 days')
));
update public.articles set created_at = now() - interval '40 days' where guid = 'old';
select pg_temp.ok((select cluster_id from public.articles where guid = 'h3') = (select cluster_id from public.articles where guid = 'g1'), 'match_id joins the existing event cluster');
select pg_temp.ok((select article_count from public.clusters c join public.articles a on a.cluster_id = c.id where a.guid = 'g1') = 3, 'duplicates are not counted in cluster');

select pg_temp.ok((select count(*) from public.similar_articles(array['الحكومة الأردنية تقر نظام الخدمة المدنية الجديد'], 36)) >= 1, 'similar_articles finds trigram candidates');
select pg_temp.ok(not exists (select 1 from public.similar_articles(array['الحكومة الأردنية تقر نظام الخدمة المدنية'], 36) where article_id = 4), 'similar_articles ignores stored duplicates');
select pg_temp.ok((select count(*) from public.existing_hashes(array[repeat('a',64), repeat('9',64)])) = 1, 'existing_hashes');

-- scheduler lease
select pg_temp.ok(public.begin_ingest_run() is not null, 'begin_ingest_run starts a run');
select pg_temp.ok(public.begin_ingest_run() is null, 'overlapping run is refused');
select pg_temp.ok((select count(*) from public.claim_due_sources(1, 10)) = 2, 'claim_due_sources leases due sources');
select pg_temp.ok((select count(*) from public.claim_due_sources(1, 10)) = 0, 'leased sources are not handed out twice');
select public.record_fetch(jsonb_build_object('run_id', 1, 'source_id', 2, 'status', 'error', 'error', 'HTTP 503', 'http_status', 503, 'next_fetch_at', now() + interval '10 minutes'));
select public.record_fetch(jsonb_build_object('run_id', 1, 'source_id', 2, 'status', 'error', 'error', 'HTTP 503', 'next_fetch_at', now() + interval '20 minutes'));
select pg_temp.ok((select consecutive_failures = 2 and last_error = 'HTTP 503' from public.sources where id = 2), 'failures counted');
select public.record_fetch(jsonb_build_object('run_id', 1, 'source_id', 2, 'status', 'ok', 'items_found', 5, 'items_new', 1, 'next_fetch_at', now() + interval '5 minutes', 'etag', 'W/"x"'));
select pg_temp.ok((select consecutive_failures = 0 and last_error is null and last_success_at is not null and etag = 'W/"x"' from public.sources where id = 2), 'success resets failures and stores etag');
select public.finish_ingest_run(1, '{"status":"ok","items_new":3}');
select pg_temp.ok((select status = 'ok' and finished_at is not null from public.ingest_runs where id = 1), 'run finished');
select pg_temp.ok((select count(*) from realtime.sent where event = 'new_articles' and topic = 'news-feed' and not private) = 1, 'one public realtime broadcast per run with new items');
update public.ingest_runs set status = 'running', finished_at = null, started_at = now() - interval '10 minutes' where id = 1;
select pg_temp.ok(public.begin_ingest_run() is not null, 'stale crashed run is closed and a new run can start');
select pg_temp.ok((select status from public.ingest_runs where id = 1) = 'error', 'crashed run marked error');

select pg_temp.ok(public.ai_take(5) = 5 and public.ai_take(1000) = 295 and public.ai_take(1) = 0, 'AI daily budget enforced');
reset role;

-- alerts / watchdog
update public.ingest_runs set finished_at = now() - interval '1 hour', status = 'ok';
update public.sources set consecutive_failures = 6, last_error = 'timeout' where id = 1;
select public.watchdog();
select public.watchdog();
select pg_temp.ok((select count(*) from public.alerts where kind = 'ingest_stalled' and resolved_at is null) = 1, 'stall alert raised once (deduplicated)');
select pg_temp.ok((select count(*) from public.alerts where kind = 'source_failing:1') = 1, 'failing-source alert raised');
set role service_role;
select public.record_fetch(jsonb_build_object('run_id', 2, 'source_id', 1, 'status', 'ok', 'next_fetch_at', now()));
select public.finish_ingest_run(2, '{"status":"ok"}');
reset role;
select pg_temp.ok((select count(*) from public.alerts where resolved_at is null) = 0, 'alerts auto-resolve on recovery');

-- anon --------------------------------------------------------------------
set role anon;
select pg_temp.ok((select count(*) from public.articles) = 5, 'anon sees only published articles (pending hidden)');
select pg_temp.ok((select count(*) from public.articles where status <> 'published') = 0, 'no unpublished rows leak');
select pg_temp.fails($$insert into public.articles (source_id, guid, url, url_hash, title, category, published_at) values (1,'x','https://x.example','1111111111111111111111111111111111111111111111111111111111111111','عنوان مزيف','world',now())$$, 'anon cannot insert articles');
select pg_temp.fails($$update public.articles set title = 'hacked'$$, 'anon cannot update articles');
select pg_temp.fails($$delete from public.articles$$, 'anon cannot delete');
select pg_temp.fails($$select last_error from public.sources$$, 'anon cannot read source internals');
select pg_temp.ok((select count(*) from public.sources) = 2, 'anon can read public source columns via explicit select');
select pg_temp.fails($$select * from public.fetch_logs$$, 'anon cannot read fetch logs');
select pg_temp.fails($$select * from public.admins$$, 'anon cannot read admins');
select pg_temp.fails($$select public.begin_ingest_run()$$, 'anon cannot start ingestion');
select pg_temp.fails($$select public.insert_articles('[]')$$, 'anon cannot call insert_articles');
select pg_temp.fails($$select public.check_ingest_token('x')$$, 'anon cannot probe the ingest token');
select pg_temp.fails($$select public.watchdog()$$, 'anon cannot run watchdog');
select pg_temp.fails($$select public.admin_stats()$$, 'anon cannot read admin stats');
select pg_temp.ok((select count(*) from public.settings) = (select count(*) from public.settings where is_public), 'anon sees only public settings');
select pg_temp.ok((select count(*) from public.search_articles('الحكومه', null, 10, null)) = 2, 'search is normalisation-insensitive (ة/ه)');
select pg_temp.ok((select count(*) from public.search_articles('خدمة مدنية', 'jordan', 10, null)) = 2, 'multi-term search with category filter');
select pg_temp.ok((select count(*) from public.search_articles('قيد المراجعة', null, 10, null)) = 0, 'search never returns unpublished');
select pg_temp.ok((select count(*) from public.search_articles('%', null, 10, null)) = 0, 'search ignores wildcard-only input');
select pg_temp.ok((public.site_status() ->> 'sources_active')::int = 2, 'site_status is public');
reset role;

-- authenticated but not admin -------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
update public.articles set title = 'تعديل غير مصرح' where id = 1;
select pg_temp.ok((select title from public.articles where id = 1) <> 'تعديل غير مصرح', 'non-admin update affects 0 rows (RLS)');
select pg_temp.fails($$select public.admin_stats()$$, 'non-admin cannot read admin stats');
select pg_temp.fails($$select public.admin_sources()$$, 'non-admin cannot read admin sources');
select pg_temp.fails($$insert into public.admins (user_id, role) values ('00000000-0000-0000-0000-00000000000b', 'owner')$$, 'non-admin cannot self-promote');
reset role;
-- claim_first_owner: first caller becomes owner, then it is closed for everyone
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.ok(public.claim_first_owner(), 'first user claims owner');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok(not public.claim_first_owner(), 'second claim refused');
select pg_temp.fails($$select public.add_admin_by_email('random@example.com', 'owner')$$, 'non-owner cannot add admins');

-- owner / editor ------------------------------------------------------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.ok(public.add_admin_by_email('editor@example.com') = 'ok', 'owner adds editor by email');
select pg_temp.ok(public.add_admin_by_email('nobody@example.com') = 'not_found', 'unknown email reported');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.ok(public.is_admin(), 'editor is admin');
select pg_temp.ok((select count(*) from public.articles) = 6, 'admin sees pending articles');
update public.articles set title = 'عنوان معدل من المحرر', summary = 'ملخص المحرر', pinned = true, verification = 'confirmed' where id = 1;
select pg_temp.ok((select edited and summary_kind = 'editor' and pinned from public.articles where id = 1), 'admin edit applied + flagged');
select pg_temp.ok((select count(*) from public.article_history where article_id = 1 and changed_by = '00000000-0000-0000-0000-00000000000c') = 1, 'edit recorded in history');
select pg_temp.ok((select new_values ? 'title' and old_values ? 'verification' from public.article_history where article_id = 1), 'history stores old and new values');
select pg_temp.ok((select count(*) from realtime.sent where event = 'article_changed') = 1, 'editorial change broadcast');
update public.articles set is_breaking = true where id = 2;
select pg_temp.ok((select breaking_until > now() from public.articles where id = 2), 'marking breaking sets an expiry');
select pg_temp.fails($$update public.articles set title = '<script>alert(1)</script>' where id = 1$$, 'HTML rejected in headline');
select pg_temp.fails($$update public.articles set categories = '{hacked}' where id = 1$$, 'unknown category rejected');
select pg_temp.fails($$update public.articles set url = 'https://evil.example' where id = 1$$, 'original URL is immutable for admins');
select pg_temp.fails($$update public.articles set published_at = now() where id = 1$$, 'original publication time is immutable');
select pg_temp.fails($$delete from public.articles where id = 1$$, 'admins hide/reject rather than delete');
update public.sources set enabled = false, poll_interval_minutes = 10 where id = 2;
select pg_temp.ok((select not enabled and poll_interval_minutes = 10 from public.sources where id = 2), 'admin toggles source and interval');
select pg_temp.fails($$update public.sources set poll_interval_minutes = 1 where id = 2$$, 'interval below permitted minimum rejected');
select pg_temp.fails($$update public.sources set min_interval_minutes = 2 where id = 2$$, 'admins cannot lower the source-terms floor');
select pg_temp.fails($$update public.sources set etag = 'x' where id = 2$$, 'admins cannot write runtime state');
insert into public.sources (slug, name_ar, homepage, feed_url) values ('gamma', 'غاما', 'https://gamma.example/', 'https://gamma.example/feed');
select pg_temp.fails($$insert into public.sources (slug, name_ar, homepage, feed_url) values ('bad', 'سيء', 'https://b.example/', 'javascript:alert(1)')$$, 'non-http feed URL rejected');
select pg_temp.ok(jsonb_array_length(public.admin_sources()) = 3, 'admin_sources lists all sources');
select pg_temp.ok((public.admin_stats() ->> 'articles_total')::int = 6, 'admin_stats works for admins');
update public.settings set value = '10' where key = 'max_sources_per_run';
select pg_temp.fails($$update public.settings set key = 'x' where key = 'max_sources_per_run'$$, 'settings keys immutable');
delete from public.admins where user_id = '00000000-0000-0000-0000-00000000000a';
reset role;
select pg_temp.ok(exists (select 1 from public.admins where role = 'owner'), 'editor cannot remove owner (RLS: 0 rows)');
reset role;

-- retention & time zone
select pg_temp.ok((public.purge_old() ->> 'articles')::int = 1, 'retention deletes old unpinned articles');
select pg_temp.ok(to_char(timestamptz '2026-10-16 21:30:00+00' at time zone 'Asia/Amman', 'YYYY-MM-DD HH24:MI') = '2026-10-17 00:30', 'Asia/Amman is UTC+3 in the database');
select 'ALL DB TESTS PASSED' as result;
