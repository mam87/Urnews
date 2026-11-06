-- Full-article (stories) tests: drafts only from the generator, editorial approval enforced in the database,
-- public visibility, corrections, scheduling, permissions, AI budgets. Runs after 10_db_tests.sql
-- (users: a = owner, c = editor, b = signed-up stranger; sources 1 alpha, 2 beta).
\set ON_ERROR_STOP 1
create or replace function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'ok - %', label;
end $$;
create or replace function pg_temp.fails(sql text, label text, expect text default null) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if expect is not null and sqlerrm !~* expect then raise exception 'FAIL (wrong error "%"): %', sqlerrm, label; end if;
    raise notice 'ok - % (%)', label, left(sqlerrm, 90); return;
  end;
  raise exception 'FAIL (expected error): %', label;
end $$;

reset role;
set request.jwt.claim.sub = '';
-- event material: three reports in one cluster
insert into public.news_clusters (id) values (900);
insert into public.news_articles (source_id, guid, url, url_hash, title, summary, category, published_at, cluster_id, language) values
  (1, 's1', 'https://alpha.example/s1', repeat('1', 63) || 'a', 'زلزال بقوة 7 درجات يضرب جزيرة', 'قالت السلطات إن الزلزال وقع صباحاً.', 'world', now() - interval '50 minutes', 900, 'ar'),
  (2, 's2', 'https://beta.example/s2',  repeat('1', 63) || 'b', 'هزة قوية تضرب الجزيرة',          'أفادت وكالة بوقوع أضرار.',           'world', now() - interval '40 minutes', 900, 'ar'),
  (2, 's3', 'https://beta.example/s3',  repeat('1', 63) || 'c', 'تحذير من موجات بعد الزلزال',      'دعت السلطات السكان إلى الابتعاد عن الشاطئ.', 'world', now() - interval '30 minutes', 900, 'ar');

-- generator path (service_role) ------------------------------------------------------------------
set role service_role;
select pg_temp.ok((select count(*) from public.news_story_material(900, 24)) = 3, 'material = the stored reports of the event');
select pg_temp.ok((select bool_and(publisher is not null) and count(distinct publisher) = 2 from public.news_story_material(900, 24)), 'material carries the publisher group');

create temp table body_ok as select jsonb_build_object(
  'sections', jsonb_build_array(
    jsonb_build_object('key', 'event', 'paras', jsonb_build_array(
      jsonb_build_object('t', 'ضرب زلزال بقوة 7 درجات الجزيرة صباح اليوم بحسب السلطات.', 'k', 'fact', 'r', jsonb_build_array(1, 2)),
      jsonb_build_object('t', 'وأفادت وكالة بوقوع أضرار لم تحدد حجمها.', 'k', 'developing', 'r', jsonb_build_array(2)))),
    jsonb_build_object('key', 'analysis', 'paras', jsonb_build_array(
      jsonb_build_object('t', 'تبقى الصورة غير مكتملة في الساعات الأولى.', 'k', 'analysis', 'r', '[]'::jsonb)))),
  'timeline', jsonb_build_array(jsonb_build_object('at', now() - interval '50 minutes', 't', 'أول تقرير عن الزلزال', 'r', jsonb_build_array(1)))) b;
grant select on body_ok to authenticated, anon;

create temp table src_payload as select jsonb_build_array(
  jsonb_build_object('article_id', (select id from public.news_articles where guid = 's1'), 'source_id', 1, 'publisher_name', 'ألفا', 'url', 'https://alpha.example/s1', 'title', 'زلزال', 'language', 'ar', 'published_at', now() - interval '50 minutes', 'verification', 'reported'),
  jsonb_build_object('article_id', (select id from public.news_articles where guid = 's2'), 'source_id', 2, 'publisher_name', 'بيتا', 'url', 'https://beta.example/s2', 'title', 'هزة', 'language', 'ar', 'published_at', now() - interval '40 minutes', 'verification', 'reported')) s;

select pg_temp.ok(public.news_story_save_draft(jsonb_build_object('mode', 'new', 'language', 'ar', 'cluster_id', 900, 'event_key', 'c900',
  'category', 'world', 'countries', jsonb_build_array('JP', 'bad', 'JP'), 'title', 'زلزال قوي يضرب جزيرة ويثير تحذيرات للسكان', 'dek', 'ضرب زلزال قوي جزيرة صباح اليوم، ودعت السلطات السكان إلى الابتعاد عن الشاطئ.',
  'body', (select b from body_ok), 'sources', (select s from src_payload), 'ai_model', 'test-model',
  'generation', jsonb_build_object('warnings', jsonb_build_array(jsonb_build_object('where', 'event#1', 'code', 'low_overlap', 'detail', 'x'))))) > 0,
  'generator saves a draft');
select pg_temp.ok((select status = 'draft' and source_count = 2 and publisher_count = 2 and countries = '{JP}' and word_count > 20 from public.news_stories where cluster_id = 900),
  'draft stored with counts, cleaned country tags and word count');
select pg_temp.ok((select count(*) from public.news_story_revisions r join public.news_stories s on s.id = r.story_id where s.cluster_id = 900 and r.action = 'generate:new') = 1, 'generation recorded in revision history');
select pg_temp.ok(public.news_story_save_draft(jsonb_build_object('mode', 'new', 'language', 'en', 'cluster_id', 900, 'event_key', 'c900',
  'category', 'world', 'title', 'Strong quake strikes island, residents warned', 'dek', 'A strong earthquake struck an island this morning, authorities said.',
  'body', jsonb_build_object('sections', jsonb_build_array(jsonb_build_object('key', 'event', 'paras', jsonb_build_array(
      jsonb_build_object('t', 'A magnitude 7 quake struck the island, authorities said.', 'k', 'fact', 'r', jsonb_build_array(1, 2)))))),
  'sources', (select s from src_payload))) > 0, 'English version saved');
select pg_temp.ok((select count(distinct event_id) = 1 and count(*) = 2 from public.news_stories where cluster_id = 900), 'Arabic and English versions share one event id');

select pg_temp.fails($$insert into public.news_stories (language, category, title, dek, body, status) values ('ar', 'world', 'عنوان منشور مباشرة', 'مقدمة منشورة مباشرة دون مراجعة', (select b from body_ok), 'published')$$,
  'even the service role cannot insert a published story', 'drafts');
select pg_temp.fails($$update public.news_stories set status = 'published', published_at = now(), approved_by = '00000000-0000-0000-0000-00000000000b', approved_at = now() where cluster_id = 900$$,
  'approval by a non-editor is refused', 'only an editor');
select pg_temp.fails($$update public.news_stories set status = 'published', published_at = now(), approved_by = '00000000-0000-0000-0000-00000000000c', approved_at = now() where cluster_id = 900$$,
  'status cannot be advanced outside the editorial workflow', 'news_story_transition');
select pg_temp.fails($$select public.news_story_save_draft(jsonb_build_object('mode', 'new', 'language', 'ar', 'cluster_id', 901, 'category', 'world',
  'title', 'عنوان تجريبي طويل كفاية', 'dek', 'مقدمة تجريبية طويلة بما يكفي للاختبار', 'body', (select b from body_ok), 'sources', jsonb_build_array((select s -> 0 from src_payload))))$$,
  'a body citing a source that is not in the list is refused', 'not in the source list');
select pg_temp.fails($$select public.news_story_save_draft(jsonb_build_object('mode', 'new', 'language', 'ar', 'cluster_id', 902, 'category', 'world',
  'title', 'عنوان تجريبي طويل كفاية', 'dek', 'مقدمة تجريبية طويلة بما يكفي للاختبار',
  'body', jsonb_build_object('sections', jsonb_build_array(jsonb_build_object('key', 'event', 'paras', jsonb_build_array(jsonb_build_object('t', 'نص بلا مصدر', 'k', 'fact', 'r', '[]'::jsonb))))),
  'sources', (select s from src_payload)))$$, 'a factual paragraph without a source is refused', 'must cite a source');
select pg_temp.fails($$select public.news_story_save_draft(jsonb_build_object('mode', 'new', 'language', 'ar', 'cluster_id', 903, 'category', 'world',
  'title', 'عنوان تجريبي طويل كفاية', 'dek', 'مقدمة تجريبية طويلة بما يكفي للاختبار',
  'body', jsonb_build_object('sections', jsonb_build_array(jsonb_build_object('key', 'event', 'paras', jsonb_build_array(jsonb_build_object('t', 'نص <img src=x onerror=alert(1)>', 'k', 'fact', 'r', '[1]'::jsonb))))),
  'sources', (select s from src_payload)))$$, 'HTML in article text is refused', 'HTML');
select pg_temp.ok(not exists (select 1 from public.news_story_candidates(10) where cluster_id = 900), 'an event that is not in the ranking is not a candidate');
reset role;

create temp table ids as select (select id from public.news_stories where cluster_id = 900 and language = 'ar') ar, (select id from public.news_stories where cluster_id = 900 and language = 'en') en;
grant select on ids to anon, authenticated, service_role;

-- public & stranger cannot see or touch drafts ----------------------------------------------------
set request.jwt.claim.sub = ''; set role anon;
select pg_temp.ok((select count(*) from public.news_stories) = 0, 'anon cannot see drafts');
select pg_temp.ok((select count(*) from public.news_story_sources) = 0, 'anon cannot see draft sources');
select pg_temp.fails($$select generation from public.news_stories$$, 'anon cannot read generation notes / validator output', 'permission');
select pg_temp.fails($$select public.news_story_transition(1, 'publish')$$, 'anon cannot publish', 'permission');
select pg_temp.fails($$select public.news_story_save_draft('{}')$$, 'anon cannot save drafts', 'permission');
select pg_temp.fails($$select public.news_story_ai_take(1)$$, 'anon cannot take AI budget', 'permission');
select pg_temp.fails($$insert into public.news_story_corrections (story_id, kind, note) values (1, 'correction', 'xxx')$$, 'anon cannot add corrections', 'permission');
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok((select count(*) from public.news_stories) = 0, 'a signed-up non-editor cannot see drafts');
select pg_temp.fails($$select public.news_admin_story(1)$$, 'a non-editor cannot read the admin view', 'forbidden');
select pg_temp.fails(format($$select public.news_story_transition(%s, 'publish', null, null, true)$$, (select ar from ids)), 'a non-editor cannot publish', 'forbidden');
select pg_temp.fails($$update public.news_stories set title = 'x' where true$$, 'no direct UPDATE on stories', 'permission');
select pg_temp.fails($$delete from public.news_stories$$, 'no DELETE on stories', 'permission');
select pg_temp.ok((select count(*) from public.news_story_revisions) = 0 and (select count(*) from public.news_story_attempts) = 0, 'non-editors cannot read revisions or generator logs');

-- editorial workflow (editor c) -------------------------------------------------------------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.ok((select count(*) from public.news_stories) = 2, 'an editor sees drafts');
select pg_temp.ok((public.news_admin_story((select ar from ids)) -> 'sibling' ->> 'language') = 'en', 'admin view links the other-language version');
select pg_temp.ok(jsonb_array_length(public.news_admin_story((select ar from ids)) -> 'sources') = 2, 'admin view lists sources');
select pg_temp.ok((public.news_admin_stories() -> 'counts' ->> 'draft')::int = 2, 'admin list counts drafts');
select pg_temp.fails(format($$select public.news_story_transition(%s, 'publish')$$, (select ar from ids)), 'publishing with unchecked validator warnings is refused', 'warnings_unacknowledged');
select pg_temp.fails(format($$select public.news_story_save(%s, '{"status": "published"}')$$, (select ar from ids)), 'status cannot be changed through the edit function', 'unknown field');
select pg_temp.fails(format($$select public.news_story_save(%s, jsonb_build_object('body', jsonb_build_object('sections', jsonb_build_array(jsonb_build_object('key', 'event', 'paras', jsonb_build_array(jsonb_build_object('t', 'نص', 'k', 'fact', 'r', '[7]'::jsonb)))))))$$, (select ar from ids)),
  'an edit cannot cite a source the story does not list', 'not in this story');
select pg_temp.ok((public.news_story_save((select ar from ids), jsonb_build_object('title', 'زلزال قوي يضرب جزيرة ويدفع السلطات لتحذير السكان')) ->> 'title') like '%لتحذير%', 'editor edits a draft');
select pg_temp.ok(public.news_story_add_source((select ar from ids), 'هيئة رسمية', 'https://gov.example/statement', 'بيان رسمي') = 3, 'editor adds a hand-picked source reference');
select pg_temp.fails(format($$select public.news_story_add_source(%s, 'x', 'javascript:alert(1)')$$, (select ar from ids)), 'source URLs must be http(s)', 'invalid URL');
select pg_temp.ok((public.news_story_transition((select ar from ids), 'publish', null, null, true) ->> 'status') = 'published', 'editor publishes after checking warnings');
select pg_temp.ok((select (x ->> 'approved_by') = '00000000-0000-0000-0000-00000000000c' and x ->> 'approved_by_email' = 'editor@example.com' and x ->> 'published_at' is not null
  from public.news_admin_story((select ar from ids)) x), 'approver and publication time recorded (admin view)');
select pg_temp.fails($$select approved_by from public.news_stories$$, 'approver identity is not readable through the public table', 'permission');
select pg_temp.ok((public.news_story_transition((select en from ids), 'schedule', now() + interval '2 hours') ->> 'status') = 'scheduled', 'editor schedules the English version');
select pg_temp.fails(format($$select public.news_story_transition(%s, 'schedule', now() - interval '1 hour')$$, (select en from ids)), 'cannot schedule in the past');

-- published story: corrections are explicit and public
select pg_temp.fails(format($$select public.news_story_save(%s, jsonb_build_object('dek', 'مقدمة معدلة للتقرير المنشور بعد التحقق من المصادر.'))$$, (select ar from ids)),
  'editing a published story requires saying what kind of change it is', 'change_kind_required');
select pg_temp.fails(format($$select public.news_story_save(%s, jsonb_build_object('dek', 'مقدمة معدلة للتقرير المنشور بعد التحقق من المصادر.'), 'correction')$$, (select ar from ids)),
  'a correction needs a public note', 'public note');
select pg_temp.ok((public.news_story_save((select ar from ids), jsonb_build_object('dek', 'مقدمة معدلة للتقرير المنشور بعد التحقق من المصادر.'), 'correction', 'صُحّح وصف موقع الزلزال.') ->> 'content_updated_at') is not null,
  'a correction is saved and stamps the update time');
select pg_temp.ok((public.news_story_save((select ar from ids), jsonb_build_object('dek', 'مقدمة معدلة للتقرير المنشور بعد التحقق من المصادر'), 'minor') ->> 'dek') not like '%.', 'a minor edit is allowed without a public note');
select pg_temp.ok((select count(*) from public.news_story_corrections where story_id = (select ar from ids) and kind = 'correction') = 1, 'correction history kept');
select pg_temp.ok((select count(*) from public.news_story_revisions where story_id = (select ar from ids)) >= 5, 'every change is in the revision history');

-- update proposal from the generator does not change the live text
reset role;
set role service_role;
select public.news_story_save_draft(jsonb_build_object('mode', 'propose', 'story_id', (select ar from ids), 'language', 'ar', 'cluster_id', 900,
  'title', 'زلزال قوي يضرب جزيرة: تحذيرات للسكان والسلطات تقيّم الأضرار', 'dek', 'أفادت تقارير جديدة بأن السلطات بدأت تقييم الأضرار بعد الزلزال.',
  'body', jsonb_build_object('sections', jsonb_build_array(jsonb_build_object('key', 'event', 'paras', jsonb_build_array(
    jsonb_build_object('t', 'دعت السلطات السكان إلى الابتعاد عن الشاطئ بحسب التقارير.', 'k', 'statement', 'r', jsonb_build_array(1)),
    jsonb_build_object('t', 'ضرب الزلزال الجزيرة صباحاً بحسب مصدرين.', 'k', 'fact', 'r', jsonb_build_array(2, 3)))))),
  'sources', jsonb_build_array(
    jsonb_build_object('article_id', (select id from public.news_articles where guid = 's3'), 'source_id', 2, 'publisher_name', 'بيتا', 'url', 'https://beta.example/s3', 'language', 'ar', 'published_at', now() - interval '30 minutes'),
    jsonb_build_object('article_id', (select id from public.news_articles where guid = 's1'), 'source_id', 1, 'publisher_name', 'ألفا', 'url', 'https://alpha.example/s1', 'language', 'ar'),
    jsonb_build_object('article_id', (select id from public.news_articles where guid = 's2'), 'source_id', 2, 'publisher_name', 'بيتا', 'url', 'https://beta.example/s2', 'language', 'ar'))));
select pg_temp.ok((select pending_body is not null and has_new_reports and status = 'published' and title like '%لتحذير%' from public.news_stories where id = (select ar from ids)),
  'a proposed update waits beside the published text');
select pg_temp.ok((select pending_body -> 'sections' -> 0 -> 'paras' -> 1 -> 'r' = '[1, 2]'::jsonb from public.news_stories where id = (select ar from ids)),
  'proposed update re-uses the numbers of sources the story already cites');
select pg_temp.ok((select n = 4 and pending from public.news_story_sources where story_id = (select ar from ids) and url = 'https://beta.example/s3'), 'new source appended as pending');
reset role;

set request.jwt.claim.sub = ''; set role anon;
select pg_temp.ok((select count(*) from public.news_stories) = 1, 'anon sees the published story only (scheduled one is not due)');
select pg_temp.ok((select count(*) from public.news_story_sources) = 3, 'anon sees the published sources, not pending ones');
select pg_temp.ok((select count(*) from public.news_story_corrections) = 1, 'anon sees the public correction');
select pg_temp.ok((select title from public.news_stories) like '%لتحذير%', 'anon sees the approved text, not the proposed update');
select pg_temp.fails($$select pending_body from public.news_stories$$, 'anon cannot read proposed updates', 'permission');
reset role;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.ok((public.news_story_transition((select ar from ids), 'apply_update') ->> 'status') = 'published', 'editor applies the proposed update (story stays published)');
reset role;
select pg_temp.ok((select title like '%تقيّم%' and pending_body is null and not has_new_reports from public.news_stories where id = (select ar from ids)), 'applied update replaces the live text');
select pg_temp.ok((select count(*) from public.news_story_sources where story_id = (select ar from ids) and pending) = 0, 'applied update makes its sources public');
select pg_temp.ok((select count(*) from public.news_story_corrections where story_id = (select ar from ids) and kind = 'update') = 1, 'applied update adds a public "updated" note');

-- scheduled publication
update public.news_stories set publish_at = now() - interval '1 minute' where id = (select en from ids);
set request.jwt.claim.sub = ''; set role anon;
select pg_temp.ok((select count(*) from public.news_stories) = 2, 'a scheduled story becomes visible once due');
reset role;
select pg_temp.ok(public.news_publish_due_stories() = 1, 'the minute job publishes due stories');
select pg_temp.ok((select status = 'published' and published_at is not null from public.news_stories where id = (select en from ids)), 'scheduled story is now published');

-- unpublish / reject
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.fails(format($$select public.news_story_transition(%s, 'unpublish')$$, (select en from ids)), 'unpublishing needs a reason', 'reason');
select pg_temp.ok((public.news_story_transition((select en from ids), 'unpublish', null, 'خطأ في المصدر') ->> 'status') = 'unpublished', 'editor unpublishes');
select pg_temp.fails(format($$select public.news_story_transition(%s, 'reject', null, 'x')$$, (select ar from ids)), 'published stories are unpublished, not rejected', 'unpublish');
reset role;
set request.jwt.claim.sub = ''; set role anon;
select pg_temp.ok((select count(*) from public.news_stories) = 1, 'unpublished story disappears');
select pg_temp.ok((select count(*) from public.news_story_corrections where kind = 'editor_note') = 0, 'internal editor notes are never public');
reset role;

-- purge keeps stories: when the source report is deleted the reference survives
delete from public.news_articles where guid = 's1';
select pg_temp.ok((select article_id is null and url = 'https://alpha.example/s1' from public.news_story_sources where story_id = (select ar from ids) and n = 1),
  'source reference survives report retention');

-- AI budgets ---------------------------------------------------------------------------------------
update public.news_settings set value = to_jsonb(coalesce((select calls from public.news_ai_usage where day = current_date), 0) + 100) where key = 'ai_daily_limit';
update public.news_settings set value = 'null' where key = 'ai_cooldown_until';
set role service_role;
select pg_temp.ok(public.news_story_ai_take(1) = 0, 'story budget is zero while story_enabled = false');
reset role;
update public.news_settings set value = 'true' where key = 'story_enabled';
update public.news_settings set value = '3' where key = 'story_ai_daily_limit';
set role service_role;
select pg_temp.ok(public.news_story_ai_take(5) = 3, 'story daily limit enforced');
select pg_temp.ok(public.news_story_ai_take(1) = 0, 'no more story calls today');
select pg_temp.ok((select calls >= 3 and story_calls = 3 from public.news_ai_usage where day = current_date), 'story calls also count against the general daily limit');
select public.news_story_ai_refund(2);
select pg_temp.ok((select story_calls = 1 from public.news_ai_usage where day = current_date), 'unused story calls are refunded');
reset role;
update public.news_settings set value = to_jsonb((select calls from public.news_ai_usage where day = current_date) + 2) where key = 'ai_monthly_limit';
set role service_role;
select pg_temp.ok(public.news_ai_take(10) = 2, 'monthly limit caps headline translation too');
select pg_temp.ok(public.news_ai_take(1) = 0, 'monthly limit reached');
reset role;
update public.news_settings set value = 'null' where key = 'ai_monthly_limit';
set role service_role;
select pg_temp.ok(public.news_ai_take(1) = 1, 'ai_monthly_limit = null means no monthly cap (previous behaviour)');
reset role;

-- scheduler jobs exist; generation job only calls out while enabled
select pg_temp.ok((select count(*) from cron.job where jobname in ('news-stories-publish', 'news-stories-generate')) = 2, 'story cron jobs scheduled');
select pg_temp.ok((select command like '%story_enabled%' from cron.job where jobname = 'news-stories-generate'), 'generation job is gated on story_enabled');
select pg_temp.ok((select count(*) from cron.job where jobname like 'news-%') = 6, 'existing jobs untouched');
select 'ALL STORY TESTS PASSED' as result;
