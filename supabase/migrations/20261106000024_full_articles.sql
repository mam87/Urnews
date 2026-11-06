-- 2026-11-06 — Full original articles («تقارير كاملة» / "Full reports").
--
-- An optional generator (Edge Function `news-stories`) writes ORIGINAL articles about important events from the
-- headlines + publisher-provided excerpts already stored for that event (never full copied articles, never past
-- paywalls). Every paragraph is labelled (confirmed fact / official statement / allegation / developing /
-- editorial analysis) and cites numbered sources. AI output is ALWAYS a draft: only a signed-in editor can
-- approve, publish or schedule it, and that rule is enforced here in the database, not in the browser.
--
-- Additive only: new news_story_* tables, new settings, two new nullable/defaulted columns, new functions,
-- and news_ai_take() re-created with an optional monthly cap (identical behaviour while the cap is not reached).
-- Existing articles, clusters, events and their relationships are untouched. Safe to re-run.

-- ---------------------------------------------------------------------------------------------------------
-- 1) Source licensing (shown with source references; a licence never enables automatic copying)
-- ---------------------------------------------------------------------------------------------------------
alter table public.news_sources add column if not exists license text check (char_length(license) <= 80);
alter table public.news_sources add column if not exists license_url text check (license_url ~ '^https://' and char_length(license_url) <= 500);
comment on column public.news_sources.license is 'Licence the publisher grants for its content (e.g. CC BY 4.0). Empty = all rights reserved.';
grant select (license, license_url) on public.news_sources to anon, authenticated;
grant update (license, license_url) on public.news_sources to authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- 2) AI budget: monthly cap for all AI use + a separate daily/monthly budget for full articles
-- ---------------------------------------------------------------------------------------------------------
alter table public.news_ai_usage add column if not exists story_calls integer not null default 0;

insert into public.news_settings (key, value, description, is_public) values
  ('ai_monthly_limit',          '30000', 'أقصى عدد طلبات ذكاء اصطناعي في الشهر لكل الاستخدامات (null = بلا حد شهري)', false),
  ('story_enabled',             'false', 'تشغيل كاتب التقارير الكاملة الآلي (مسودات فقط — لا يُنشر شيء دون موافقة محرر)', false),
  ('story_ai_daily_limit',      '40',    'أقصى طلبات AI يومياً لكتابة التقارير الكاملة (ضمن الحد اليومي العام)', false),
  ('story_ai_monthly_limit',    '600',   'أقصى طلبات AI شهرياً لكتابة التقارير الكاملة', false),
  ('story_languages',           '["ar", "en"]', 'لغات التقارير الكاملة (ar و/أو en)، نسخة مرتبطة لكل لغة', false),
  ('story_min_score',           '55',    'أدنى درجة أهمية للحدث (0–100) ليُكتب عنه تقرير كامل', false),
  ('story_min_reports',         '3',     'أدنى عدد تقارير مخزّنة عن الحدث قبل الكتابة', false),
  ('story_min_publishers',      '2',     'أدنى عدد جهات نشر مستقلة عن الحدث قبل الكتابة', false),
  ('story_min_material_chars',  '600',   'أدنى حجم للمادة المصدرية (عناوين + مقتطفات) — أقل منه = معلومات غير كافية', false),
  ('story_max_events_per_run',  '2',     'أقصى عدد أحداث يكتب عنها كل تشغيل', false)
on conflict (key) do nothing;

-- Requests used this calendar month (UTC), all AI use.
create or replace function public.news_ai_month_used()
returns int language sql stable security definer set search_path = '' as $$
  select coalesce(sum(calls), 0)::int from public.news_ai_usage where day >= date_trunc('month', current_date)::date;
$$;

create or replace function public.news_setting_int(p_key text)
returns int language sql stable security definer set search_path = '' as $$
  select case when jsonb_typeof(value) = 'number' then (value)::text::numeric::int
              when jsonb_typeof(value) = 'string' and value #>> '{}' ~ '^\d+$' then (value #>> '{}')::int end
  from public.news_settings where key = p_key;
$$;

-- Same as 2026-11-03, plus the optional monthly cap.
create or replace function public.news_ai_take(p_n int)
returns int language plpgsql security definer set search_path = '' as $$
declare
  lim int := coalesce(public.news_setting_int('ai_daily_limit'), 0);
  mlim int := public.news_setting_int('ai_monthly_limit');
  cool jsonb := (select value from public.news_settings where key = 'ai_cooldown_until');
  used int;
  granted int;
begin
  if cool is not null and jsonb_typeof(cool) = 'string' and (cool #>> '{}')::timestamptz > now() then
    return 0;
  end if;
  insert into public.news_ai_usage (day, calls) values (current_date, 0) on conflict (day) do nothing;
  select calls into used from public.news_ai_usage where day = current_date for update;
  granted := greatest(0, least(p_n, lim - used));
  if mlim is not null then granted := greatest(0, least(granted, mlim - public.news_ai_month_used())); end if;
  update public.news_ai_usage set calls = calls + granted where day = current_date;
  return granted;
end $$;

-- Full-article requests count against the general daily/monthly caps AND their own daily/monthly caps,
-- so article writing can never starve headline translation beyond its own budget.
create or replace function public.news_story_ai_take(p_n int)
returns int language plpgsql security definer set search_path = '' as $$
declare
  lim int := coalesce(public.news_setting_int('ai_daily_limit'), 0);
  mlim int := public.news_setting_int('ai_monthly_limit');
  slim int := coalesce(public.news_setting_int('story_ai_daily_limit'), 0);
  smlim int := coalesce(public.news_setting_int('story_ai_monthly_limit'), 0);
  cool jsonb := (select value from public.news_settings where key = 'ai_cooldown_until');
  r record;
  smonth int;
  granted int;
begin
  if (select value from public.news_settings where key = 'story_enabled') is distinct from 'true'::jsonb then return 0; end if;
  if cool is not null and jsonb_typeof(cool) = 'string' and (cool #>> '{}')::timestamptz > now() then return 0; end if;
  insert into public.news_ai_usage (day, calls) values (current_date, 0) on conflict (day) do nothing;
  select calls, story_calls into r from public.news_ai_usage where day = current_date for update;
  smonth := (select coalesce(sum(story_calls), 0) from public.news_ai_usage where day >= date_trunc('month', current_date)::date);
  granted := greatest(0, least(p_n, lim - r.calls, slim - r.story_calls, smlim - smonth));
  if mlim is not null then granted := greatest(0, least(granted, mlim - public.news_ai_month_used())); end if;
  update public.news_ai_usage set calls = calls + granted, story_calls = story_calls + granted where day = current_date;
  return granted;
end $$;

create or replace function public.news_story_ai_refund(p_n int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(p_n, 0) <= 0 then return; end if;
  update public.news_ai_usage set calls = greatest(0, calls - p_n), story_calls = greatest(0, story_calls - p_n) where day = current_date;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 3) Stories
-- ---------------------------------------------------------------------------------------------------------
-- body (jsonb):
-- { "sections": [ { "key": "event|background|statements|reactions|impact|next|disagreements|analysis",
--                   "heading": "optional custom heading",
--                   "paras": [ { "t": "text", "k": "fact|statement|allegation|developing|analysis", "r": [1, 3] } ] } ],
--   "timeline": [ { "at": "2026-11-06T09:12:00Z", "t": "text", "r": [2] } ] }
-- "r" = numbers of rows in news_story_sources for this story. Every paragraph except editorial analysis cites a source.

create or replace function public.news_story_body_problem(b jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare
  s jsonb; p jsonb; t jsonb; x jsonb;
  total int := 0; nparas int := 0;
  keys text[] := array['event','background','statements','reactions','impact','next','disagreements','analysis'];
  kinds text[] := array['fact','statement','allegation','developing','analysis'];
begin
  if b is null or jsonb_typeof(b) <> 'object' then return 'body must be a JSON object'; end if;
  if jsonb_typeof(b -> 'sections') is distinct from 'array' then return 'body.sections must be an array'; end if;
  if jsonb_array_length(b -> 'sections') not between 1 and 12 then return 'body needs 1-12 sections'; end if;
  for s in select * from jsonb_array_elements(b -> 'sections') loop
    if jsonb_typeof(s) <> 'object' or not (s ->> 'key' = any(keys)) then return 'unknown section key: ' || coalesce(s ->> 'key', '?'); end if;
    if s ? 'heading' and (jsonb_typeof(s -> 'heading') <> 'string' or char_length(s ->> 'heading') > 120 or s ->> 'heading' ~ '<[a-zA-Z/!]') then
      return 'bad section heading'; end if;
    if jsonb_typeof(s -> 'paras') is distinct from 'array' or jsonb_array_length(s -> 'paras') not between 1 and 30 then
      return 'section ' || (s ->> 'key') || ' needs 1-30 paragraphs'; end if;
    for p in select * from jsonb_array_elements(s -> 'paras') loop
      if jsonb_typeof(p -> 't') is distinct from 'string' or char_length(btrim(p ->> 't')) not between 2 and 2500 then return 'paragraph text must be 2-2500 characters'; end if;
      if p ->> 't' ~ '<[a-zA-Z/!]' then return 'HTML is not allowed in article text'; end if;
      if not (coalesce(p ->> 'k', '') = any(kinds)) then return 'unknown paragraph kind: ' || coalesce(p ->> 'k', '?'); end if;
      if p ? 'r' and jsonb_typeof(p -> 'r') <> 'array' then return 'paragraph sources must be an array'; end if;
      for x in select * from jsonb_array_elements(coalesce(p -> 'r', '[]')) loop
        if jsonb_typeof(x) <> 'number' or (x)::text !~ '^\d{1,2}$' or (x)::text::int < 1 then return 'source references are numbers 1-99'; end if;
      end loop;
      if p ->> 'k' <> 'analysis' and jsonb_array_length(coalesce(p -> 'r', '[]')) = 0 then
        return 'every paragraph except editorial analysis must cite a source'; end if;
      if (s ->> 'key') = 'analysis' and p ->> 'k' <> 'analysis' then return 'the analysis section may only hold analysis paragraphs'; end if;
      total := total + char_length(p ->> 't');
      nparas := nparas + 1;
    end loop;
  end loop;
  if nparas > 80 or total > 40000 then return 'article is too long'; end if;
  if b ? 'timeline' then
    if jsonb_typeof(b -> 'timeline') <> 'array' or jsonb_array_length(b -> 'timeline') > 40 then return 'timeline must be an array of at most 40 entries'; end if;
    for t in select * from jsonb_array_elements(b -> 'timeline') loop
      if jsonb_typeof(t -> 't') is distinct from 'string' or char_length(btrim(t ->> 't')) not between 2 and 400 or t ->> 't' ~ '<[a-zA-Z/!]' then
        return 'timeline entries need 2-400 characters of plain text'; end if;
      begin
        perform (t ->> 'at')::timestamptz;
      exception when others then return 'timeline time is not a valid timestamp';
      end;
      if t ->> 'at' is null then return 'timeline time is required'; end if;
      if jsonb_typeof(t -> 'r') is distinct from 'array' or jsonb_array_length(t -> 'r') = 0 then return 'every timeline entry must cite a source'; end if;
    end loop;
  end if;
  return null;
end $$;

-- All source numbers cited anywhere in a body.
create or replace function public.news_story_refs(b jsonb)
returns int[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct (r)::text::int), '{}') from (
    select jsonb_array_elements(coalesce(p -> 'r', '[]')) r
      from jsonb_array_elements(coalesce(b -> 'sections', '[]')) s, jsonb_array_elements(coalesce(s -> 'paras', '[]')) p
    union all
    select jsonb_array_elements(coalesce(t -> 'r', '[]')) from jsonb_array_elements(coalesce(b -> 'timeline', '[]')) t
  ) x where jsonb_typeof(r) = 'number';
$$;

create table if not exists public.news_stories (
  id                 bigserial primary key,
  event_id           uuid not null default gen_random_uuid(),   -- shared by the Arabic and English versions of one event
  language           text not null check (language in ('ar', 'en')),
  cluster_id         bigint,                                     -- report cluster at generation time (clusters are purged; plain id)
  event_key          text,                                       -- news_global_events.key at generation time
  category           text not null references public.news_categories(slug),
  countries          text[] not null default '{}',
  region             text,
  title              text not null check (char_length(title) between 10 and 200),
  dek                text not null check (char_length(dek) between 20 and 600),
  body               jsonb not null,
  word_count         integer not null default 0,
  pending_title      text check (char_length(pending_title) between 10 and 200),
  pending_dek        text check (char_length(pending_dek) between 20 and 600),
  pending_body       jsonb,
  hero_image_url     text check (hero_image_url ~ '^https://' and char_length(hero_image_url) <= 2048),
  hero_image_credit  text check (char_length(hero_image_credit) <= 160),
  hero_source_id     integer references public.news_sources(id) on delete set null,
  byline             text not null default 'editorial' check (char_length(byline) between 2 and 80 and byline !~ '[<>{}\\]'),
  origin             text not null default 'ai' check (origin in ('ai', 'editor')),
  ai_model           text check (char_length(ai_model) <= 80),
  generation         jsonb not null default '{}',               -- validator warnings, counts, rejected paragraphs (admin only)
  status             text not null default 'draft'
                     check (status in ('draft', 'approved', 'scheduled', 'published', 'rejected', 'unpublished')),
  approved_by        uuid,
  approved_at        timestamptz,
  publish_at         timestamptz,
  published_at       timestamptz,                                -- first publication
  content_updated_at timestamptz,                                -- last public update/correction (shown as "Updated")
  status_note        text check (char_length(status_note) <= 500), -- rejection / unpublish reason (admin only)
  source_count       integer not null default 0,
  publisher_count    integer not null default 0,
  has_new_reports    boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (event_id, language),
  check (status not in ('approved', 'scheduled', 'published') or (approved_by is not null and approved_at is not null)),
  check (status <> 'scheduled' or publish_at is not null),
  check (status <> 'published' or published_at is not null),
  check (hero_image_url is null or char_length(coalesce(hero_image_credit, '')) >= 2)
);
create index if not exists news_stories_public_idx on public.news_stories (language, published_at desc) where status = 'published';
create index if not exists news_stories_status_idx on public.news_stories (status, updated_at desc);
create index if not exists news_stories_cluster_idx on public.news_stories (cluster_id, language);
create index if not exists news_stories_due_idx on public.news_stories (publish_at) where status = 'scheduled';
create index if not exists news_stories_countries_idx on public.news_stories using gin (countries);
drop trigger if exists stories_touch on public.news_stories;
create trigger stories_touch before update on public.news_stories for each row execute function public.news_touch_updated_at();

create table if not exists public.news_story_sources (
  story_id        bigint not null references public.news_stories(id) on delete cascade,
  n               smallint not null check (n between 1 and 99),
  article_id      bigint references public.news_articles(id) on delete set null,   -- stored report (purged after retention_days)
  source_id       integer references public.news_sources(id) on delete set null,
  publisher_name  text not null check (char_length(publisher_name) between 2 and 120),
  url             text not null check (url ~ '^https?://' and char_length(url) <= 2048),
  title           text check (char_length(title) <= 400),
  language        text,
  published_at    timestamptz,
  verification    text,
  license         text,
  pending         boolean not null default false,  -- cited only by a proposed update that is not approved yet
  added_by        uuid,                            -- set when an editor adds a reference by hand
  created_at      timestamptz not null default now(),
  primary key (story_id, n)
);
create index if not exists news_story_sources_article_idx on public.news_story_sources (article_id);

create table if not exists public.news_story_corrections (
  id          bigserial primary key,
  story_id    bigint not null references public.news_stories(id) on delete cascade,
  kind        text not null check (kind in ('correction', 'update', 'clarification', 'editor_note')),
  note        text not null check (char_length(btrim(note)) between 3 and 1000 and note !~ '<[a-zA-Z/!]'),
  is_public   boolean generated always as (kind <> 'editor_note') stored,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists news_story_corrections_story_idx on public.news_story_corrections (story_id, created_at desc);

create table if not exists public.news_story_revisions (
  id          bigserial primary key,
  story_id    bigint not null references public.news_stories(id) on delete cascade,
  changed_by  uuid,
  action      text not null,
  snapshot    jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists news_story_revisions_story_idx on public.news_story_revisions (story_id, created_at desc);

create table if not exists public.news_story_attempts (
  id            bigserial primary key,
  cluster_id    bigint,
  event_key     text,
  language      text,
  story_id      bigint references public.news_stories(id) on delete set null,
  outcome       text not null check (outcome in ('drafted', 'redrafted', 'update_proposed', 'insufficient', 'rejected_output', 'no_budget', 'error', 'skipped')),
  reason        text check (char_length(reason) <= 1000),
  report_count  integer,
  created_at    timestamptz not null default now()
);
create index if not exists news_story_attempts_cluster_idx on public.news_story_attempts (cluster_id, language, created_at desc);
create index if not exists news_story_attempts_created_idx on public.news_story_attempts (created_at desc);

-- ---------------------------------------------------------------------------------------------------------
-- 4) Integrity triggers (apply to every writer, including the service role)
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.news_story_word_count(p_title text, p_dek text, b jsonb)
returns int language sql immutable set search_path = '' as $$
  select coalesce(array_length(regexp_split_to_array(btrim(concat_ws(' ', p_title, p_dek,
    (select string_agg(p ->> 't', ' ') from jsonb_array_elements(coalesce(b -> 'sections', '[]')) s, jsonb_array_elements(coalesce(s -> 'paras', '[]')) p))), '\s+'), 1), 0);
$$;

create or replace function public.news_stories_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare problem text;
begin
  -- Machine-written or not, every new story starts as an unpublished draft.
  if tg_op = 'INSERT' and new.status <> 'draft' then
    raise exception 'new stories must start as drafts (editorial approval required)' using errcode = '42501';
  end if;
  -- Approval must come from a listed editor.
  if new.status in ('approved', 'scheduled', 'published')
     and (new.approved_by is null or not exists (select 1 from public.news_admins a where a.user_id = new.approved_by)) then
    raise exception 'only an editor can approve or publish a story' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.status in ('approved', 'scheduled', 'published') and old.status not in ('approved', 'scheduled', 'published')
     and coalesce(current_setting('lahza.story_action', true), '') not in ('approve', 'publish', 'schedule') then
    raise exception 'status can only be advanced through news_story_transition()' using errcode = '42501';
  end if;
  new.title := btrim(regexp_replace(new.title, '[[:cntrl:]]', ' ', 'g'));
  new.dek := btrim(regexp_replace(new.dek, '[[:cntrl:]]', ' ', 'g'));
  if new.title ~ '<[a-zA-Z/!]' or new.dek ~ '<[a-zA-Z/!]' or coalesce(new.pending_title, '') ~ '<[a-zA-Z/!]' or coalesce(new.pending_dek, '') ~ '<[a-zA-Z/!]' then
    raise exception 'HTML is not allowed in headlines or introductions' using errcode = '22023';
  end if;
  problem := public.news_story_body_problem(new.body);
  if problem is not null then raise exception 'invalid article body: %', problem using errcode = '22023'; end if;
  if new.pending_body is not null then
    problem := public.news_story_body_problem(new.pending_body);
    if problem is not null then raise exception 'invalid proposed update: %', problem using errcode = '22023'; end if;
  end if;
  if new.countries is distinct from coalesce(case when tg_op = 'UPDATE' then old.countries end, '{}') then
    new.countries := (select coalesce(array_agg(distinct c), '{}') from unnest(new.countries) c where c ~ '^[A-Z]{2}$');
  end if;
  new.word_count := public.news_story_word_count(new.title, new.dek, new.body);
  return new;
end $$;
drop trigger if exists stories_guard on public.news_stories;
create trigger stories_guard before insert or update on public.news_stories for each row execute function public.news_stories_guard();

-- Every content or status change is kept (who, what, when) — the correction history.
create or replace function public.news_stories_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.title is not distinct from old.title and new.dek is not distinct from old.dek
     and new.body is not distinct from old.body and new.status is not distinct from old.status
     and new.pending_body is not distinct from old.pending_body and new.publish_at is not distinct from old.publish_at
     and new.hero_image_url is not distinct from old.hero_image_url then
    return null;
  end if;
  insert into public.news_story_revisions (story_id, changed_by, action, snapshot)
  values (new.id, (select auth.uid()), coalesce(nullif(current_setting('lahza.story_action', true), ''), lower(tg_op)),
          jsonb_build_object('title', new.title, 'dek', new.dek, 'body', new.body, 'status', new.status, 'publish_at', new.publish_at,
                             'pending', new.pending_body is not null, 'hero_image_url', new.hero_image_url));
  return null;
end $$;
drop trigger if exists stories_revision on public.news_stories;
create trigger stories_revision after insert or update on public.news_stories for each row execute function public.news_stories_revision();

-- ---------------------------------------------------------------------------------------------------------
-- 5) Row Level Security and grants
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.news_story_is_public(p_status text, p_publish_at timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select p_status = 'published' or (p_status = 'scheduled' and p_publish_at <= now());
$$;

alter table public.news_stories enable row level security;
alter table public.news_story_sources enable row level security;
alter table public.news_story_corrections enable row level security;
alter table public.news_story_revisions enable row level security;
alter table public.news_story_attempts enable row level security;
revoke all on public.news_stories, public.news_story_sources, public.news_story_corrections, public.news_story_revisions,
  public.news_story_attempts from public, anon, authenticated;
revoke all on sequence public.news_stories_id_seq, public.news_story_corrections_id_seq, public.news_story_revisions_id_seq,
  public.news_story_attempts_id_seq from public, anon, authenticated;

-- Readers see published stories only, and only the public columns. Editors read everything through
-- news_admin_story()/news_admin_stories(); all writes go through the functions below.
grant select (id, event_id, language, cluster_id, category, countries, region, title, dek, body, word_count,
              hero_image_url, hero_image_credit, hero_source_id, byline, origin, status, publish_at, published_at,
              content_updated_at, source_count, publisher_count, created_at)
  on public.news_stories to anon, authenticated;
drop policy if exists stories_read on public.news_stories;
create policy stories_read on public.news_stories for select
  using (public.news_story_is_public(status, publish_at) or public.news_is_admin());

grant select (story_id, n, article_id, source_id, publisher_name, url, title, language, published_at, verification, license, pending)
  on public.news_story_sources to anon, authenticated;
drop policy if exists story_sources_read on public.news_story_sources;
create policy story_sources_read on public.news_story_sources for select
  using ((not pending and exists (select 1 from public.news_stories s where s.id = story_id and public.news_story_is_public(s.status, s.publish_at)))
         or public.news_is_admin());

grant select (id, story_id, kind, note, is_public, created_at) on public.news_story_corrections to anon, authenticated;
drop policy if exists story_corrections_read on public.news_story_corrections;
create policy story_corrections_read on public.news_story_corrections for select
  using ((is_public and exists (select 1 from public.news_stories s where s.id = story_id and public.news_story_is_public(s.status, s.publish_at)))
         or public.news_is_admin());

grant select on public.news_story_revisions, public.news_story_attempts to authenticated;
drop policy if exists story_revisions_admin on public.news_story_revisions;
create policy story_revisions_admin on public.news_story_revisions for select to authenticated using (public.news_is_admin());
drop policy if exists story_attempts_admin on public.news_story_attempts;
create policy story_attempts_admin on public.news_story_attempts for select to authenticated using (public.news_is_admin());

-- ---------------------------------------------------------------------------------------------------------
-- 6) Editorial functions (signed-in editors; each re-checks news_is_admin())
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.news_admin_story(p_id bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.news_is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return (select to_jsonb(s)
    || jsonb_build_object(
      'sources', (select coalesce(jsonb_agg(to_jsonb(x) order by x.n), '[]') from public.news_story_sources x where x.story_id = s.id),
      'corrections', (select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc), '[]') from public.news_story_corrections c where c.story_id = s.id),
      'sibling', (select jsonb_build_object('id', o.id, 'language', o.language, 'status', o.status) from public.news_stories o
                  where o.event_id = s.event_id and o.id <> s.id limit 1),
      'approved_by_email', (select u.email from auth.users u where u.id = s.approved_by))
    from public.news_stories s where s.id = p_id);
end $$;

create or replace function public.news_admin_stories(p_status text default null, p_language text default null, p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.news_is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'rows', (select coalesce(jsonb_agg(r order by r.updated_at desc), '[]') from (
      select s.id, s.event_id, s.language, s.title, s.status, s.category, s.countries, s.origin, s.word_count, s.source_count,
             s.publisher_count, s.publish_at, s.published_at, s.content_updated_at, s.updated_at, s.created_at, s.has_new_reports,
             s.pending_body is not null as has_pending,
             jsonb_array_length(coalesce(s.generation -> 'warnings', '[]')) as warnings
      from public.news_stories s
      where (p_status is null or s.status = p_status) and (p_language is null or s.language = p_language)
      order by s.updated_at desc limit greatest(1, least(coalesce(p_limit, 100), 300))) r),
    'counts', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from public.news_stories group by 1) c),
    'budget', jsonb_build_object(
      'enabled', (select value from public.news_settings where key = 'story_enabled'),
      'today', (select story_calls from public.news_ai_usage where day = current_date),
      'month', (select coalesce(sum(story_calls), 0) from public.news_ai_usage where day >= date_trunc('month', current_date)::date),
      'daily_limit', public.news_setting_int('story_ai_daily_limit'),
      'monthly_limit', public.news_setting_int('story_ai_monthly_limit'),
      'ai_month', public.news_ai_month_used(),
      'ai_monthly_limit', public.news_setting_int('ai_monthly_limit')),
    'attempts', (select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]') from (
      select * from public.news_story_attempts order by created_at desc limit 30) a));
end $$;

-- Edit content. p_change: required once the story is public —
--   'minor' (typo/style, no public note) | 'correction' | 'update' | 'clarification' (public note p_note required).
create or replace function public.news_story_save(p_id bigint, p_patch jsonb, p_change text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.news_stories;
  n public.news_stories;
  refs int[];
  missing int;
  content_changed boolean;
  uid uuid := (select auth.uid());
begin
  if not public.news_is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into s from public.news_stories where id = p_id for update;
  if s.id is null then raise exception 'story not found' using errcode = 'P0002'; end if;
  if exists (select 1 from jsonb_object_keys(p_patch) k
             where k not in ('title', 'dek', 'body', 'category', 'countries', 'hero_image_url', 'hero_image_credit', 'byline')) then
    raise exception 'unknown field in patch' using errcode = '22023';
  end if;
  n := s;
  if p_patch ? 'title' then n.title := p_patch ->> 'title'; end if;
  if p_patch ? 'dek' then n.dek := p_patch ->> 'dek'; end if;
  if p_patch ? 'body' then n.body := p_patch -> 'body'; end if;
  if p_patch ? 'category' then n.category := p_patch ->> 'category'; end if;
  if p_patch ? 'countries' then n.countries := array(select jsonb_array_elements_text(p_patch -> 'countries')); end if;
  if p_patch ? 'hero_image_url' then n.hero_image_url := nullif(p_patch ->> 'hero_image_url', ''); n.hero_source_id := null; end if;
  if p_patch ? 'hero_image_credit' then n.hero_image_credit := nullif(btrim(p_patch ->> 'hero_image_credit'), ''); end if;
  if p_patch ? 'byline' then n.byline := coalesce(nullif(btrim(p_patch ->> 'byline'), ''), 'editorial'); end if;

  refs := public.news_story_refs(n.body);
  select r into missing from unnest(refs) r
    where not exists (select 1 from public.news_story_sources x where x.story_id = p_id and x.n = r and not x.pending) limit 1;
  if missing is not null then raise exception 'reference [%] is not in this story''s source list', missing using errcode = '22023'; end if;

  content_changed := n.title is distinct from s.title or n.dek is distinct from s.dek or n.body is distinct from s.body;
  if content_changed and public.news_story_is_public(s.status, s.publish_at) then
    if p_change is null or p_change not in ('minor', 'correction', 'update', 'clarification') then
      raise exception 'change_kind_required: say whether this is a minor edit, a correction, an update or a clarification' using errcode = '22023';
    end if;
    if p_change <> 'minor' then
      if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'a public note is required for corrections and updates' using errcode = '22023'; end if;
      insert into public.news_story_corrections (story_id, kind, note, created_by) values (p_id, p_change, btrim(p_note), uid);
      n.content_updated_at := now();
    end if;
  end if;

  perform set_config('lahza.story_action', 'edit' || coalesce(':' || p_change, ''), true);
  update public.news_stories set title = n.title, dek = n.dek, body = n.body, category = n.category, countries = n.countries,
    hero_image_url = n.hero_image_url, hero_image_credit = n.hero_image_credit, hero_source_id = n.hero_source_id,
    byline = n.byline, content_updated_at = n.content_updated_at
  where id = p_id;
  perform set_config('lahza.story_action', '', true);
  return public.news_admin_story(p_id);
end $$;

-- Add a reference by hand (editors may cite an accessible source the generator did not have).
create or replace function public.news_story_add_source(p_id bigint, p_publisher text, p_url text, p_title text default null, p_published_at timestamptz default null)
returns int language plpgsql security definer set search_path = '' as $$
declare next_n int;
begin
  if not public.news_is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.news_stories where id = p_id) then raise exception 'story not found' using errcode = 'P0002'; end if;
  if coalesce(p_url, '') !~ '^https?://[^\s<>"]+$' then raise exception 'invalid URL' using errcode = '22023'; end if;
  if coalesce(p_title, '') ~ '<[a-zA-Z/!]' or coalesce(p_publisher, '') ~ '<[a-zA-Z/!]' then raise exception 'HTML is not allowed' using errcode = '22023'; end if;
  perform 1 from public.news_stories where id = p_id for update;
  next_n := coalesce((select max(n) from public.news_story_sources where story_id = p_id), 0) + 1;
  if next_n > 99 then raise exception 'too many sources' using errcode = '22023'; end if;
  insert into public.news_story_sources (story_id, n, publisher_name, url, title, published_at, added_by)
  values (p_id, next_n, btrim(p_publisher), p_url, nullif(btrim(coalesce(p_title, '')), ''), p_published_at, (select auth.uid()));
  update public.news_stories set source_count = (select count(*) from public.news_story_sources where story_id = p_id and not pending) where id = p_id;
  return next_n;
end $$;

-- Workflow. Actions:
--   approve | publish | schedule (p_publish_at) | reject (p_note) | unpublish (p_note) | to_draft
--   apply_update (p_note = public update note) | discard_update
-- Approving or publishing a story with open validator warnings requires p_ack_warnings = true.
create or replace function public.news_story_transition(p_id bigint, p_action text, p_publish_at timestamptz default null,
                                                        p_note text default null, p_ack_warnings boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.news_stories;
  uid uuid := (select auth.uid());
  warn int;
  approved boolean;
begin
  if not public.news_is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into s from public.news_stories where id = p_id for update;
  if s.id is null then raise exception 'story not found' using errcode = 'P0002'; end if;
  warn := jsonb_array_length(coalesce(s.generation -> 'warnings', '[]'));
  approved := s.status in ('approved', 'scheduled', 'published');
  perform set_config('lahza.story_action', p_action, true);

  if p_action in ('approve', 'publish', 'schedule') then
    if s.status = 'rejected' and p_action <> 'approve' then raise exception 'a rejected story must be approved again first' using errcode = '22023'; end if;
    if not approved and warn > 0 and not coalesce(p_ack_warnings, false) then
      raise exception 'warnings_unacknowledged: % validator warning(s) must be checked first', warn using errcode = '22023';
    end if;
    if s.pending_body is not null then raise exception 'apply or discard the proposed update first' using errcode = '22023'; end if;
  end if;

  if p_action = 'approve' then
    if s.status not in ('draft', 'rejected', 'unpublished') then raise exception 'cannot approve a % story', s.status using errcode = '22023'; end if;
    update public.news_stories set status = 'approved', approved_by = uid, approved_at = now(), status_note = null where id = p_id;
  elsif p_action = 'publish' then
    if s.status = 'published' then raise exception 'already published' using errcode = '22023'; end if;
    update public.news_stories set status = 'published', publish_at = null,
      approved_by = case when approved then s.approved_by else uid end, approved_at = case when approved then s.approved_at else now() end,
      published_at = coalesce(s.published_at, now()),
      content_updated_at = case when s.published_at is not null then now() else s.content_updated_at end, status_note = null
    where id = p_id;
  elsif p_action = 'schedule' then
    if s.status = 'published' then raise exception 'already published' using errcode = '22023'; end if;
    if p_publish_at is null or p_publish_at < now() + interval '1 minute' or p_publish_at > now() + interval '30 days' then
      raise exception 'publication time must be between 1 minute and 30 days from now' using errcode = '22023';
    end if;
    update public.news_stories set status = 'scheduled', publish_at = p_publish_at,
      approved_by = case when approved then s.approved_by else uid end, approved_at = case when approved then s.approved_at else now() end
    where id = p_id;
  elsif p_action = 'reject' then
    if s.status not in ('draft', 'approved', 'scheduled') then raise exception 'cannot reject a % story (unpublish it instead)', s.status using errcode = '22023'; end if;
    if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'give a reason for rejecting' using errcode = '22023'; end if;
    update public.news_stories set status = 'rejected', publish_at = null, approved_by = null, approved_at = null, status_note = btrim(p_note) where id = p_id;
  elsif p_action = 'unpublish' then
    if s.status not in ('published', 'scheduled') then raise exception 'only published or scheduled stories can be unpublished' using errcode = '22023'; end if;
    if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'give a reason for unpublishing' using errcode = '22023'; end if;
    update public.news_stories set status = 'unpublished', publish_at = null, status_note = btrim(p_note) where id = p_id;
    insert into public.news_story_corrections (story_id, kind, note, created_by) values (p_id, 'editor_note', 'Unpublished: ' || btrim(p_note), uid);
  elsif p_action = 'to_draft' then
    if s.status not in ('approved', 'rejected', 'unpublished') then raise exception 'cannot move a % story back to draft', s.status using errcode = '22023'; end if;
    update public.news_stories set status = 'draft', approved_by = null, approved_at = null where id = p_id;
  elsif p_action = 'apply_update' then
    if s.pending_body is null then raise exception 'there is no proposed update' using errcode = '22023'; end if;
    if jsonb_array_length(coalesce(s.generation -> 'pending_warnings', '[]')) > 0 and not coalesce(p_ack_warnings, false) then
      raise exception 'warnings_unacknowledged: the proposed update has validator warnings' using errcode = '22023';
    end if;
    update public.news_story_sources set pending = false where story_id = p_id and pending;
    update public.news_stories set
      title = coalesce(s.pending_title, s.title), dek = coalesce(s.pending_dek, s.dek), body = s.pending_body,
      pending_title = null, pending_dek = null, pending_body = null, has_new_reports = false,
      generation = (s.generation - 'pending_warnings' - 'pending_rejected') || jsonb_build_object('warnings', coalesce(s.generation -> 'pending_warnings', '[]')),
      approved_by = case when approved then uid else s.approved_by end, approved_at = case when approved then now() else s.approved_at end,
      content_updated_at = case when public.news_story_is_public(s.status, s.publish_at) then now() else s.content_updated_at end,
      source_count = (select count(*) from public.news_story_sources where story_id = p_id),
      publisher_count = (select count(distinct coalesce(src.publisher, src.slug, x.publisher_name)) from public.news_story_sources x
                         left join public.news_sources src on src.id = x.source_id where x.story_id = p_id)
    where id = p_id;
    if public.news_story_is_public(s.status, s.publish_at) then
      insert into public.news_story_corrections (story_id, kind, note, created_by)
      values (p_id, 'update', coalesce(nullif(btrim(coalesce(p_note, '')), ''), case when s.language = 'ar' then 'حُدّث التقرير بمعلومات من مصادر جديدة.' else 'Updated with information from new reports.' end), uid);
    end if;
  elsif p_action = 'discard_update' then
    delete from public.news_story_sources where story_id = p_id and pending;
    update public.news_stories set pending_title = null, pending_dek = null, pending_body = null, has_new_reports = false,
      generation = s.generation - 'pending_warnings' - 'pending_rejected' where id = p_id;
  else
    raise exception 'unknown action %', p_action using errcode = '22023';
  end if;
  perform set_config('lahza.story_action', '', true);
  return public.news_admin_story(p_id);
end $$;

-- Mark warnings as checked after editing (keeps them in history).
create or replace function public.news_story_clear_warnings(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.news_is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.news_stories set generation = generation - 'warnings'
    || jsonb_build_object('checked_warnings', coalesce(generation -> 'warnings', '[]'), 'checked_by', (select auth.uid()), 'checked_at', now())
  where id = p_id;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 7) Generator functions (service_role only)
-- ---------------------------------------------------------------------------------------------------------
-- Events worth a full article, with what already exists for them.
create or replace function public.news_story_candidates(p_limit int default 10)
returns table (event_key text, cluster_id bigint, lead_article_id bigint, score smallint, report_count int, publisher_count int,
               independent_count int, countries text[], region text, event_type text, allegation boolean,
               stories jsonb, last_attempts jsonb)
language sql stable security definer set search_path = '' as $$
  select g.key, g.cluster_id, g.lead_article_id, g.score, g.report_count, g.publisher_count, g.independent_count, g.countries, g.region,
         g.event_type, g.allegation,
         (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'language', s.language, 'status', s.status, 'event_id', s.event_id,
                  'source_count', s.source_count, 'has_pending', s.pending_body is not null, 'article_ids',
                  (select coalesce(jsonb_agg(x.article_id), '[]') from public.news_story_sources x where x.story_id = s.id and x.article_id is not null))), '[]')
            from public.news_stories s where s.cluster_id = g.cluster_id),
         (select coalesce(jsonb_object_agg(a.language, to_jsonb(a)), '{}') from (
            select distinct on (x.language) x.* from public.news_story_attempts x
            where x.cluster_id = g.cluster_id and x.language is not null order by x.language, x.created_at desc) a)
  from public.news_global_events g
  where g.cluster_id is not null
    and g.score >= coalesce(public.news_setting_int('story_min_score'), 55)
    and g.report_count >= coalesce(public.news_setting_int('story_min_reports'), 3)
    and g.independent_count >= coalesce(public.news_setting_int('story_min_publishers'), 2)
  order by g.rank
  limit greatest(1, least(coalesce(p_limit, 10), 30));
$$;

-- What the generator needs to rewrite one existing story on an editor's request.
create or replace function public.news_story_target(p_id bigint)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'cluster_id', s.cluster_id, 'event_key', s.event_key, 'language', s.language, 'status', s.status,
           'has_pending', s.pending_body is not null, 'countries', s.countries, 'region', s.region, 'event_id', s.event_id,
           'source_count', s.source_count,
           'article_ids', (select coalesce(jsonb_agg(x.article_id), '[]') from public.news_story_sources x where x.story_id = s.id and x.article_id is not null))
  from public.news_stories s where s.id = p_id;
$$;

-- The stored reports of one event: the only material the generator may use.
create or replace function public.news_story_material(p_cluster bigint, p_limit int default 24)
returns table (article_id bigint, source_id int, publisher text, source_name_ar text, source_name_en text, source_kind text,
               reliability smallint, license text, url text, title text, title_original text, title_en text, summary text,
               summary_kind text, language text, translated boolean, verification text, published_at timestamptz,
               image_url text, allow_images boolean, wire text, category text, countries text[], region text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.source_id, coalesce(s.publisher, s.slug), s.name_ar, s.name_en, s.kind, s.reliability, s.license, a.url, a.title,
         a.title_original, a.title_en, case when s.allow_excerpt then a.summary end, a.summary_kind, a.language, a.translated,
         a.verification, a.published_at, a.image_url, s.allow_images, a.wire, a.category, a.countries, a.region
  from public.news_articles a join public.news_sources s on s.id = a.source_id
  where a.cluster_id = p_cluster and a.status = 'published' and a.duplicate_of is null
  order by s.reliability desc, a.published_at asc
  limit greatest(1, least(coalesce(p_limit, 24), 40));
$$;

-- Store a generated draft. p.mode:
--   'new'      → insert a new draft (linked to the other-language version of the same event when one exists)
--   'redraft'  → replace an existing DRAFT (status must still be draft) and its sources
--   'propose'  → keep an approved/published story as is and attach a proposed update for editors to apply
create or replace function public.news_story_save_draft(p jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  sid bigint;
  ev uuid;
  cur public.news_stories;
  mode text := p ->> 'mode';
  srcs jsonb := coalesce(p -> 'sources', '[]');
  base_n int := 0;
  refs int[];
  missing int;
begin
  if mode not in ('new', 'redraft', 'propose') then raise exception 'bad mode' using errcode = '22023'; end if;
  if jsonb_typeof(srcs) <> 'array' or jsonb_array_length(srcs) = 0 then raise exception 'a story needs sources' using errcode = '22023'; end if;
  refs := public.news_story_refs(p -> 'body');
  select r into missing from unnest(refs) r where r < 1 or r > jsonb_array_length(srcs) limit 1;
  if missing is not null then raise exception 'body cites [%] which is not in the source list', missing using errcode = '22023'; end if;
  perform set_config('lahza.story_action', 'generate:' || mode, true);

  if mode = 'new' then
    if exists (select 1 from public.news_stories where cluster_id = (p ->> 'cluster_id')::bigint and language = p ->> 'language') then
      raise exception 'a story for this event and language already exists' using errcode = '23505';
    end if;
    ev := coalesce((select event_id from public.news_stories where cluster_id = (p ->> 'cluster_id')::bigint limit 1), gen_random_uuid());
    insert into public.news_stories (event_id, language, cluster_id, event_key, category, countries, region, title, dek, body,
                                     hero_image_url, hero_image_credit, hero_source_id, origin, ai_model, generation, status)
    values (ev, p ->> 'language', (p ->> 'cluster_id')::bigint, p ->> 'event_key', p ->> 'category',
            array(select jsonb_array_elements_text(coalesce(p -> 'countries', '[]'))), p ->> 'region', p ->> 'title', p ->> 'dek', p -> 'body',
            p ->> 'hero_image_url', p ->> 'hero_image_credit', (p ->> 'hero_source_id')::int, 'ai', p ->> 'ai_model',
            coalesce(p -> 'generation', '{}'), 'draft')
    returning id into sid;
  else
    select * into cur from public.news_stories where id = (p ->> 'story_id')::bigint for update;
    if cur.id is null then raise exception 'story not found' using errcode = 'P0002'; end if;
    sid := cur.id;
    if mode = 'redraft' then
      if cur.status <> 'draft' then raise exception 'only drafts are rewritten; use propose' using errcode = '22023'; end if;
      delete from public.news_story_sources where story_id = sid;
      update public.news_stories set title = p ->> 'title', dek = p ->> 'dek', body = p -> 'body', ai_model = p ->> 'ai_model',
        generation = coalesce(p -> 'generation', '{}'), hero_image_url = p ->> 'hero_image_url', hero_image_credit = p ->> 'hero_image_credit',
        hero_source_id = (p ->> 'hero_source_id')::int, event_key = p ->> 'event_key', countries = array(select jsonb_array_elements_text(coalesce(p -> 'countries', '[]'))),
        pending_title = null, pending_dek = null, pending_body = null, has_new_reports = false
      where id = sid;
    else
      if cur.status not in ('approved', 'scheduled', 'published', 'unpublished') then raise exception 'propose is for approved stories' using errcode = '22023'; end if;
      delete from public.news_story_sources where story_id = sid and pending;
      base_n := coalesce((select max(n) from public.news_story_sources where story_id = sid), 0);
    end if;
  end if;

  -- In propose mode the payload's source numbers 1..k are re-based after the story's existing ones,
  -- except entries that point at a report the story already cites (they keep that number).
  if mode = 'propose' then
    declare
      remap jsonb := '{}';
      e jsonb; i int := 0; existing int; next_n int := base_n;
      body_new jsonb;
    begin
      for e in select * from jsonb_array_elements(srcs) loop
        i := i + 1;
        existing := (select x.n from public.news_story_sources x where x.story_id = sid and not x.pending
                     and x.article_id is not distinct from (e ->> 'article_id')::bigint and (e ->> 'article_id') is not null limit 1);
        if existing is null then
          next_n := next_n + 1;
          insert into public.news_story_sources (story_id, n, article_id, source_id, publisher_name, url, title, language, published_at, verification, license, pending)
          values (sid, next_n, (e ->> 'article_id')::bigint, (e ->> 'source_id')::int, e ->> 'publisher_name', e ->> 'url', e ->> 'title',
                  e ->> 'language', (e ->> 'published_at')::timestamptz, e ->> 'verification', e ->> 'license', true);
          remap := remap || jsonb_build_object(i::text, next_n);
        else
          remap := remap || jsonb_build_object(i::text, existing);
        end if;
      end loop;
      body_new := jsonb_build_object(
        'sections', (select jsonb_agg(sec || jsonb_build_object('paras', (select jsonb_agg(pp || jsonb_build_object('r',
            (select coalesce(jsonb_agg(remap -> (r)::text), '[]') from jsonb_array_elements(coalesce(pp -> 'r', '[]')) r)))
            from jsonb_array_elements(sec -> 'paras') pp))) from jsonb_array_elements(p -> 'body' -> 'sections') sec),
        'timeline', (select coalesce(jsonb_agg(tt || jsonb_build_object('r',
            (select coalesce(jsonb_agg(remap -> (r)::text), '[]') from jsonb_array_elements(coalesce(tt -> 'r', '[]')) r))), '[]')
            from jsonb_array_elements(coalesce(p -> 'body' -> 'timeline', '[]')) tt));
      update public.news_stories set pending_title = p ->> 'title', pending_dek = p ->> 'dek', pending_body = body_new, has_new_reports = true,
        generation = (generation - 'pending_warnings' - 'pending_rejected') || jsonb_build_object(
          'pending_warnings', coalesce(p -> 'generation' -> 'warnings', '[]'),
          'pending_rejected', coalesce(p -> 'generation' -> 'rejected', '[]'),
          'pending_model', p ->> 'ai_model', 'pending_at', now())
      where id = sid;
    end;
  else
    insert into public.news_story_sources (story_id, n, article_id, source_id, publisher_name, url, title, language, published_at, verification, license)
    select sid, ord::int, (e ->> 'article_id')::bigint, (e ->> 'source_id')::int, e ->> 'publisher_name', e ->> 'url', e ->> 'title',
           e ->> 'language', (e ->> 'published_at')::timestamptz, e ->> 'verification', e ->> 'license'
    from jsonb_array_elements(srcs) with ordinality as t(e, ord);
    update public.news_stories set
      source_count = (select count(*) from public.news_story_sources where story_id = sid),
      publisher_count = (select count(distinct coalesce(src.publisher, src.slug, x.publisher_name)) from public.news_story_sources x
                         left join public.news_sources src on src.id = x.source_id where x.story_id = sid)
    where id = sid;
  end if;
  perform set_config('lahza.story_action', '', true);
  return sid;
end $$;

create or replace function public.news_story_log_attempt(p jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.news_story_attempts (cluster_id, event_key, language, story_id, outcome, reason, report_count)
  values ((p ->> 'cluster_id')::bigint, p ->> 'event_key', p ->> 'language', (p ->> 'story_id')::bigint, p ->> 'outcome',
          left(p ->> 'reason', 1000), (p ->> 'report_count')::int);
$$;

-- Scheduled publication + housekeeping (pg_cron).
create or replace function public.news_publish_due_stories()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform set_config('lahza.story_action', 'publish', true);
  update public.news_stories set status = 'published', published_at = coalesce(published_at, publish_at), publish_at = null
  where status = 'scheduled' and publish_at <= now();
  get diagnostics n = row_count;
  perform set_config('lahza.story_action', '', true);
  delete from public.news_story_attempts where created_at < now() - interval '30 days';
  return n;
end $$;

-- Lock everything down, then grant precisely.
revoke execute on function
  public.news_ai_month_used(), public.news_setting_int(text), public.news_ai_take(int), public.news_story_ai_take(int), public.news_story_ai_refund(int),
  public.news_story_body_problem(jsonb), public.news_story_refs(jsonb), public.news_story_word_count(text, text, jsonb),
  public.news_stories_guard(), public.news_stories_revision(), public.news_admin_story(bigint), public.news_admin_stories(text, text, int),
  public.news_story_save(bigint, jsonb, text, text), public.news_story_add_source(bigint, text, text, text, timestamptz),
  public.news_story_transition(bigint, text, timestamptz, text, boolean), public.news_story_clear_warnings(bigint),
  public.news_story_candidates(int), public.news_story_material(bigint, int), public.news_story_save_draft(jsonb),
  public.news_story_log_attempt(jsonb), public.news_publish_due_stories(), public.news_story_target(bigint)
from public, anon, authenticated;
grant execute on function public.news_story_is_public(text, timestamptz) to anon, authenticated, service_role;
grant execute on function public.news_story_body_problem(jsonb), public.news_story_refs(jsonb) to authenticated, service_role;
grant execute on function
  public.news_admin_story(bigint), public.news_admin_stories(text, text, int), public.news_story_save(bigint, jsonb, text, text),
  public.news_story_add_source(bigint, text, text, text, timestamptz), public.news_story_transition(bigint, text, timestamptz, text, boolean),
  public.news_story_clear_warnings(bigint)
to authenticated;
grant execute on function
  public.news_ai_take(int), public.news_story_ai_take(int), public.news_story_ai_refund(int), public.news_story_candidates(int),
  public.news_story_material(bigint, int), public.news_story_save_draft(jsonb), public.news_story_log_attempt(jsonb),
  public.news_publish_due_stories(), public.news_ai_month_used(), public.news_setting_int(text), public.news_story_target(bigint)
to service_role;

-- ---------------------------------------------------------------------------------------------------------
-- 8) Scheduler: publish due stories every minute; run the generator every 10 minutes ONLY while
--    story_enabled = true (off by default, so applying this migration changes nothing until an editor turns it on).
-- ---------------------------------------------------------------------------------------------------------
do $$
declare j text;
begin
  foreach j in array array['news-stories-publish', 'news-stories-generate'] loop
    if exists (select 1 from cron.job where jobname = j) then perform cron.unschedule(j); end if;
  end loop;
end $$;
select cron.schedule('news-stories-publish', '* * * * *', $$ select public.news_publish_due_stories(); $$);
select cron.schedule('news-stories-generate', '4-59/10 * * * *', $$
  select public.news_call_edge_function('news-stories')
  where (select value from public.news_settings where key = 'story_enabled') = 'true'::jsonb; $$);
