-- Row Level Security, grants and admin authorisation.
-- Principle: anon/authenticated can only READ published content. Every write is
-- either done by the ingest job (service_role) or by a user listed in public.news_admins,
-- enforced here in the database — not in the frontend.

create or replace function public.news_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.news_admins a where a.user_id = (select auth.uid()));
$$;

create or replace function public.news_is_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.news_admins a where a.user_id = (select auth.uid()) and a.role = 'owner');
$$;

alter table public.news_categories      enable row level security;
alter table public.news_admins          enable row level security;
alter table public.news_settings        enable row level security;
alter table public.news_sources         enable row level security;
alter table public.news_clusters        enable row level security;
alter table public.news_articles        enable row level security;
alter table public.news_article_history enable row level security;
alter table public.news_ingest_runs     enable row level security;
alter table public.news_fetch_logs      enable row level security;
alter table public.news_alerts          enable row level security;
alter table public.news_ai_usage        enable row level security;

-- Start from zero: revoke Supabase's default broad grants, then grant precisely.
-- Scoped to news_* objects only: this schema may share a project with other apps.
revoke all on public.news_categories, public.news_admins, public.news_settings, public.news_sources, public.news_clusters,
  public.news_articles, public.news_article_history, public.news_ingest_runs, public.news_fetch_logs, public.news_alerts,
  public.news_ai_usage from anon, authenticated;
revoke all on sequence public.news_sources_id_seq, public.news_clusters_id_seq, public.news_articles_id_seq,
  public.news_article_history_id_seq, public.news_ingest_runs_id_seq, public.news_fetch_logs_id_seq, public.news_alerts_id_seq
  from anon, authenticated;
revoke execute on function public.news_normalize(text), public.news_touch_updated_at(), public.news_refresh_cluster(bigint),
  public.news_articles_cluster_trg() from public, anon, authenticated;

-- Public read surface ------------------------------------------------------
grant select on public.news_categories to anon, authenticated;
create policy categories_read on public.news_categories for select using (true);

grant select (key, value, is_public, updated_at) on public.news_settings to anon, authenticated;
grant select (description) on public.news_settings to authenticated;
create policy settings_public_read on public.news_settings for select using (is_public or public.news_is_admin());

grant select (id, slug, name_ar, name_en, homepage, language, country, kind, reliability, default_category,
              enabled, allow_images, poll_interval_minutes, min_interval_minutes, last_success_at) on public.news_sources to anon, authenticated;
create policy sources_public_read on public.news_sources for select using (true);

grant select on public.news_articles to anon, authenticated;
create policy articles_public_read on public.news_articles for select
  using (status = 'published' or public.news_is_admin());

grant select on public.news_clusters to anon, authenticated;
create policy clusters_read on public.news_clusters for select using (true);

-- Admin surface (authenticated + listed in admins) ---------------------------
grant select on public.news_admins to authenticated;
create policy admins_self_read on public.news_admins for select to authenticated
  using (user_id = (select auth.uid()) or public.news_is_owner());
grant insert, delete on public.news_admins to authenticated;
create policy admins_owner_insert on public.news_admins for insert to authenticated with check (public.news_is_owner());
create policy admins_owner_delete on public.news_admins for delete to authenticated using (public.news_is_owner() and user_id <> (select auth.uid()));

-- Admins read full source rows (errors, etags, notes) through admin_sources(); see functions migration.
grant update (enabled, poll_interval_minutes, reliability, name_ar, name_en, default_category, topical, kind,
              allow_images, allow_excerpt, max_items, tz_offset_minutes, terms_note, notes, next_fetch_at)
  on public.news_sources to authenticated;
create policy sources_admin_update on public.news_sources for update to authenticated
  using (public.news_is_admin()) with check (public.news_is_admin());
grant insert (slug, name_ar, name_en, homepage, feed_url, language, country, kind, reliability, default_category,
              topical, tz_offset_minutes, enabled, poll_interval_minutes, min_interval_minutes, max_items,
              allow_images, allow_excerpt, terms_note, notes)
  on public.news_sources to authenticated;
grant usage on sequence public.news_sources_id_seq to authenticated;
create policy sources_admin_insert on public.news_sources for insert to authenticated with check (public.news_is_admin());

grant update (title, summary, summary_kind, status, pinned, is_breaking, breaking_until, verification,
              category, categories, editor_note, edited)
  on public.news_articles to authenticated;
create policy articles_admin_update on public.news_articles for update to authenticated
  using (public.news_is_admin()) with check (public.news_is_admin());

grant update (value) on public.news_settings to authenticated;
create policy settings_admin_update on public.news_settings for update to authenticated
  using (public.news_is_admin()) with check (public.news_is_admin());

grant select on public.news_article_history, public.news_ingest_runs, public.news_fetch_logs, public.news_alerts, public.news_ai_usage to authenticated;
create policy history_admin_read on public.news_article_history for select to authenticated using (public.news_is_admin());
create policy runs_admin_read    on public.news_ingest_runs     for select to authenticated using (public.news_is_admin());
create policy logs_admin_read    on public.news_fetch_logs      for select to authenticated using (public.news_is_admin());
create policy alerts_admin_read  on public.news_alerts          for select to authenticated using (public.news_is_admin());
create policy ai_admin_read      on public.news_ai_usage        for select to authenticated using (public.news_is_admin());
grant update (resolved_at) on public.news_alerts to authenticated;
create policy alerts_admin_update on public.news_alerts for update to authenticated using (public.news_is_admin()) with check (public.news_is_admin());

-- Validate admin edits (server-side input validation) ------------------------
create or replace function public.news_articles_validate_edit()
returns trigger language plpgsql set search_path = '' as $$
declare
  bad text;
begin
  if new.categories is distinct from old.categories then
    select c into bad from unnest(new.categories) c
      where c not in (select slug from public.news_categories) limit 1;
    if bad is not null then raise exception 'unknown category %', bad using errcode = '22023'; end if;
  end if;
  new.title := btrim(regexp_replace(new.title, '[[:cntrl:]]', ' ', 'g'));
  if new.summary is not null then new.summary := btrim(regexp_replace(new.summary, '[[:cntrl:]]', ' ', 'g')); end if;
  if new.title ~ '<[a-zA-Z/!]' or coalesce(new.summary, '') ~ '<[a-zA-Z/!]' then
    raise exception 'HTML is not allowed in headlines or summaries' using errcode = '22023';
  end if;
  if (select auth.uid()) is not null and (new.title is distinct from old.title or new.summary is distinct from old.summary) then
    new.edited := true;
    if new.summary is distinct from old.summary then new.summary_kind := 'editor'; end if;
  end if;
  if new.is_breaking and new.breaking_until is null then
    new.breaking_until := now() + interval '6 hours';
  end if;
  return new;
end $$;
create trigger articles_validate before update on public.news_articles
  for each row execute function public.news_articles_validate_edit();

-- Audit every change to an article made by a signed-in user.
create or replace function public.news_articles_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
  k text;
  ov jsonb := '{}';
  nv jsonb := '{}';
begin
  if (select auth.uid()) is null then return null; end if; -- ingest updates are not audited row-by-row
  foreach k in array array['title','summary','status','pinned','is_breaking','breaking_until','verification','category','categories','editor_note'] loop
    if o -> k is distinct from n -> k then
      ov := ov || jsonb_build_object(k, o -> k);
      nv := nv || jsonb_build_object(k, n -> k);
    end if;
  end loop;
  if nv <> '{}' then
    insert into public.news_article_history (article_id, changed_by, action, old_values, new_values)
    values (new.id, (select auth.uid()), 'edit', ov, nv);
  end if;
  return null;
end $$;
create trigger articles_audit after update on public.news_articles
  for each row execute function public.news_articles_audit();

-- Owner bootstrap: the signed-in user whose e-mail equals settings.owner_email becomes owner,
-- only while no owner exists. Prevents a stranger who signs up first from taking over.
create or replace function public.news_claim_first_owner()
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  want text := (select value #>> '{}' from public.news_settings where key = 'owner_email');
  mine text;
begin
  if uid is null or coalesce(want, '') = '' then return false; end if;
  select email into mine from auth.users where id = uid;
  if lower(coalesce(mine, '')) <> lower(want) then return false; end if;
  lock table public.news_admins in exclusive mode;
  if exists (select 1 from public.news_admins where role = 'owner') then return false; end if;
  insert into public.news_admins (user_id, role) values (uid, 'owner');
  return true;
end $$;
grant execute on function public.news_claim_first_owner() to authenticated;
grant execute on function public.news_is_admin() to anon, authenticated;
grant execute on function public.news_is_owner() to authenticated;

-- Owners add editors by e-mail (the user must have signed up first).
create or replace function public.news_add_admin_by_email(p_email text, p_role text default 'editor')
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  if not public.news_is_owner() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_role not in ('owner', 'editor') then raise exception 'bad role' using errcode = '22023'; end if;
  select id into uid from auth.users where lower(email) = lower(btrim(p_email));
  if uid is null then return 'not_found'; end if;
  insert into public.news_admins (user_id, role) values (uid, p_role)
    on conflict (user_id) do update set role = excluded.role;
  return 'ok';
end $$;
grant execute on function public.news_add_admin_by_email(text, text) to authenticated;
