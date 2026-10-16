-- Arabic Live News — core schema
-- Requires: pg_trgm (search/near-dup), pg_cron + pg_net (scheduler), supabase_vault (secrets).

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Arabic normalisation for matching (mirrors lib/text.ts normalizeArabic()).
create or replace function public.news_normalize(t text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(regexp_replace(
    regexp_replace(
      translate(
        regexp_replace(lower(coalesce(t, '')), '[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]', '', 'g'),
        U&'\0625\0623\0622\0671\0649\0629\0624\0626\0660\0661\0662\0663\0664\0665\0666\0667\0668\0669',
        U&'\0627\0627\0627\0627\064A\0647\0648\064A0123456789'),
      '[^0-9a-z\u00c0-\u024f\u0621-\u064a\u0671-\u06d3 ]', ' ', 'g'),
    ' +', ' ', 'g'));
$$;

create or replace function public.news_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Reference tables
-- ---------------------------------------------------------------------------

create table public.news_categories (
  slug        text primary key check (slug ~ '^[a-z]{2,20}$'),
  name_ar     text not null,
  sort_order  smallint not null default 0
);

create table public.news_admins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  role        text not null default 'editor' check (role in ('owner', 'editor')),
  created_at  timestamptz not null default now()
);

create table public.news_settings (
  key         text primary key check (key ~ '^[a-z_]{2,40}$'),
  value       jsonb not null,
  description text,
  is_public   boolean not null default false,
  updated_at  timestamptz not null default now()
);
create trigger settings_touch before update on public.news_settings for each row execute function public.news_touch_updated_at();

create table public.news_sources (
  id                     serial primary key,
  slug                   text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name_ar                text not null check (char_length(name_ar) between 2 and 80),
  name_en                text,
  homepage               text not null check (homepage ~ '^https://'),
  feed_url               text not null unique check (feed_url ~ '^https?://' and char_length(feed_url) < 1000),
  language               text not null default 'ar' check (language in ('ar', 'en', 'fr')),
  country                text,
  kind                   text not null default 'media' check (kind in ('media', 'agency', 'official')),
  reliability            smallint not null default 3 check (reliability between 1 and 5),
  default_category       text references public.news_categories(slug),
  topical                boolean not null default false,
  tz_offset_minutes      smallint not null default 0 check (tz_offset_minutes between -720 and 840),
  enabled                boolean not null default true,
  poll_interval_minutes  smallint not null default 5,
  min_interval_minutes   smallint not null default 3,
  max_items              smallint not null default 30 check (max_items between 1 and 100),
  allow_images           boolean not null default false,
  allow_excerpt          boolean not null default true,
  terms_note             text,
  notes                  text,
  -- runtime state (written by the ingest job only)
  last_fetch_at          timestamptz,
  last_success_at        timestamptz,
  next_fetch_at          timestamptz,
  last_status            text,
  last_http_status       smallint,
  last_error             text,
  consecutive_failures   integer not null default 0,
  etag                   text,
  last_modified          text,
  robots_checked_at      timestamptz,
  robots_allowed         boolean,
  total_items            integer not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (min_interval_minutes between 2 and 1440),
  check (poll_interval_minutes between 2 and 1440),
  check (poll_interval_minutes >= min_interval_minutes)
);
create trigger sources_touch before update on public.news_sources for each row execute function public.news_touch_updated_at();

-- ---------------------------------------------------------------------------
-- News
-- ---------------------------------------------------------------------------

create table public.news_clusters (
  id             bigserial primary key,
  lead_article_id bigint,
  first_seen     timestamptz not null default now(),
  last_seen      timestamptz not null default now(),
  article_count  integer not null default 0,
  source_count   integer not null default 0
);

create table public.news_articles (
  id               bigserial primary key,
  source_id        integer not null references public.news_sources(id) on delete cascade,
  guid             text not null check (char_length(guid) <= 1000),
  url              text not null check (url ~ '^https?://' and char_length(url) <= 2048),
  url_hash         text not null unique check (url_hash ~ '^[0-9a-f]{64}$'),
  title            text not null check (char_length(title) between 3 and 400),
  title_original   text check (char_length(title_original) <= 400),
  summary          text check (char_length(summary) <= 1000),
  summary_kind     text not null default 'feed' check (summary_kind in ('feed', 'ai', 'editor', 'none')),
  language         text not null default 'ar',
  translated       boolean not null default false,
  category         text not null references public.news_categories(slug),
  categories       text[] not null default '{}',
  image_url        text check (image_url is null or image_url ~ '^https://'),
  published_at     timestamptz not null,
  published_estimated boolean not null default false,
  fetched_at       timestamptz not null default now(),
  norm_title       text generated always as (public.news_normalize(title)) stored,
  title_tokens     text[] not null default '{}',
  cluster_id       bigint references public.news_clusters(id) on delete set null,
  duplicate_of     bigint references public.news_articles(id) on delete set null,
  verification     text not null default 'reported'
                   check (verification in ('official', 'statement', 'allegation', 'developing', 'reported', 'confirmed')),
  is_breaking      boolean not null default false,
  breaking_until   timestamptz,
  importance       smallint not null default 0,
  status           text not null default 'published' check (status in ('published', 'pending', 'rejected', 'hidden')),
  pinned           boolean not null default false,
  edited           boolean not null default false,
  editor_note      text check (char_length(editor_note) <= 500),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (source_id, guid)
);
alter table public.news_clusters
  add constraint clusters_lead_fk foreign key (lead_article_id) references public.news_articles(id) on delete set null;

create index news_articles_feed_idx       on public.news_articles (published_at desc) where status = 'published' and duplicate_of is null;
create index news_articles_cat_idx        on public.news_articles using gin (categories);
create index news_articles_breaking_idx   on public.news_articles (breaking_until desc) where is_breaking;
create index news_articles_cluster_idx    on public.news_articles (cluster_id);
create index news_articles_source_idx     on public.news_articles (source_id, published_at desc);
create index news_articles_status_idx     on public.news_articles (status, created_at desc);
create index news_articles_norm_trgm_idx  on public.news_articles using gin (norm_title extensions.gin_trgm_ops);
create index news_articles_created_idx    on public.news_articles (created_at desc);
create index news_articles_dup_idx        on public.news_articles (duplicate_of) where duplicate_of is not null;

create trigger articles_touch before update on public.news_articles for each row execute function public.news_touch_updated_at();

create table public.news_article_history (
  id          bigserial primary key,
  article_id  bigint not null references public.news_articles(id) on delete cascade,
  changed_by  uuid,
  action      text not null,
  old_values  jsonb,
  new_values  jsonb,
  created_at  timestamptz not null default now()
);
create index news_article_history_article_idx on public.news_article_history (article_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------------

create table public.news_ingest_runs (
  id                bigserial primary key,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  status            text not null default 'running' check (status in ('running', 'ok', 'partial', 'error', 'skipped')),
  sources_attempted integer not null default 0,
  sources_ok        integer not null default 0,
  sources_failed    integer not null default 0,
  items_seen        integer not null default 0,
  items_new         integer not null default 0,
  ai_calls          integer not null default 0,
  duration_ms       integer,
  error             text
);
create index news_ingest_runs_started_idx on public.news_ingest_runs (started_at desc);

create table public.news_fetch_logs (
  id           bigserial primary key,
  run_id       bigint references public.news_ingest_runs(id) on delete cascade,
  source_id    integer not null references public.news_sources(id) on delete cascade,
  started_at   timestamptz not null default now(),
  status       text not null check (status in ('ok', 'not_modified', 'error', 'blocked')),
  http_status  smallint,
  items_found  integer not null default 0,
  items_new    integer not null default 0,
  duration_ms  integer,
  attempts     smallint not null default 1,
  error        text
);
create index news_fetch_logs_source_idx on public.news_fetch_logs (source_id, started_at desc);
create index news_fetch_logs_started_idx on public.news_fetch_logs (started_at desc);
create index news_fetch_logs_errors_idx on public.news_fetch_logs (started_at desc) where status in ('error', 'blocked');

create table public.news_alerts (
  id           bigserial primary key,
  kind         text not null,
  message      text not null,
  created_at   timestamptz not null default now(),
  notified_at  timestamptz,
  resolved_at  timestamptz
);
create unique index news_alerts_open_kind_idx on public.news_alerts (kind) where resolved_at is null;

create table public.news_ai_usage (
  day    date primary key,
  calls  integer not null default 0
);

-- Cluster stats maintenance
create or replace function public.news_refresh_cluster(p_cluster bigint)
returns void language sql security definer set search_path = '' as $$
  update public.news_clusters c set
    article_count = s.n,
    source_count  = s.srcs,
    first_seen    = s.first_seen,
    last_seen     = s.last_seen,
    lead_article_id = s.lead
  from (
    select count(*) n, count(distinct a.source_id) srcs, min(a.published_at) first_seen, max(a.published_at) last_seen,
           (array_agg(a.id order by a.importance desc, a.published_at asc))[1] lead
    from public.news_articles a where a.cluster_id = p_cluster and a.status = 'published' and a.duplicate_of is null
  ) s
  where c.id = p_cluster;
$$;

create or replace function public.news_articles_cluster_trg()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.cluster_id is not null then
    perform public.news_refresh_cluster(new.cluster_id);
  elsif tg_op = 'UPDATE' then
    if new.cluster_id is distinct from old.cluster_id or new.status is distinct from old.status then
      if old.cluster_id is not null then perform public.news_refresh_cluster(old.cluster_id); end if;
      if new.cluster_id is not null then perform public.news_refresh_cluster(new.cluster_id); end if;
    end if;
  end if;
  return null;
end $$;
create trigger articles_cluster after insert or update on public.news_articles
  for each row execute function public.news_articles_cluster_trg();
