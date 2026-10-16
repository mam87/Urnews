-- Row Level Security, grants and admin authorisation.
-- Principle: anon/authenticated can only READ published content. Every write is
-- either done by the ingest job (service_role) or by a user listed in public.admins,
-- enforced here in the database — not in the frontend.

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()) and a.role = 'owner');
$$;

alter table public.categories      enable row level security;
alter table public.admins          enable row level security;
alter table public.settings        enable row level security;
alter table public.sources         enable row level security;
alter table public.clusters        enable row level security;
alter table public.articles        enable row level security;
alter table public.article_history enable row level security;
alter table public.ingest_runs     enable row level security;
alter table public.fetch_logs      enable row level security;
alter table public.alerts          enable row level security;
alter table public.ai_usage        enable row level security;

-- Start from zero: revoke Supabase's default broad grants, then grant precisely.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- Public read surface ------------------------------------------------------
grant select on public.categories to anon, authenticated;
create policy categories_read on public.categories for select using (true);

grant select (key, value, is_public, updated_at) on public.settings to anon, authenticated;
create policy settings_public_read on public.settings for select using (is_public or public.is_admin());

grant select (id, slug, name_ar, name_en, homepage, language, country, kind, reliability, default_category,
              enabled, allow_images, poll_interval_minutes, min_interval_minutes, last_success_at) on public.sources to anon, authenticated;
create policy sources_public_read on public.sources for select using (true);

grant select on public.articles to anon, authenticated;
create policy articles_public_read on public.articles for select
  using (status = 'published' or public.is_admin());

grant select on public.clusters to anon, authenticated;
create policy clusters_read on public.clusters for select using (true);

-- Admin surface (authenticated + listed in admins) ---------------------------
grant select on public.admins to authenticated;
create policy admins_self_read on public.admins for select to authenticated
  using (user_id = (select auth.uid()) or public.is_owner());
grant insert, delete on public.admins to authenticated;
create policy admins_owner_insert on public.admins for insert to authenticated with check (public.is_owner());
create policy admins_owner_delete on public.admins for delete to authenticated using (public.is_owner() and user_id <> (select auth.uid()));

-- Admins read full source rows (errors, etags, notes) through admin_sources(); see functions migration.
grant update (enabled, poll_interval_minutes, reliability, name_ar, name_en, default_category, topical, kind,
              allow_images, allow_excerpt, max_items, tz_offset_minutes, terms_note, notes, next_fetch_at)
  on public.sources to authenticated;
create policy sources_admin_update on public.sources for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant insert (slug, name_ar, name_en, homepage, feed_url, language, country, kind, reliability, default_category,
              topical, tz_offset_minutes, enabled, poll_interval_minutes, min_interval_minutes, max_items,
              allow_images, allow_excerpt, terms_note, notes)
  on public.sources to authenticated;
grant usage on sequence public.sources_id_seq to authenticated;
create policy sources_admin_insert on public.sources for insert to authenticated with check (public.is_admin());

grant update (title, summary, summary_kind, status, pinned, is_breaking, breaking_until, verification,
              category, categories, editor_note, edited)
  on public.articles to authenticated;
create policy articles_admin_update on public.articles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant update (value) on public.settings to authenticated;
create policy settings_admin_update on public.settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select on public.article_history, public.ingest_runs, public.fetch_logs, public.alerts, public.ai_usage to authenticated;
create policy history_admin_read on public.article_history for select to authenticated using (public.is_admin());
create policy runs_admin_read    on public.ingest_runs     for select to authenticated using (public.is_admin());
create policy logs_admin_read    on public.fetch_logs      for select to authenticated using (public.is_admin());
create policy alerts_admin_read  on public.alerts          for select to authenticated using (public.is_admin());
create policy ai_admin_read      on public.ai_usage        for select to authenticated using (public.is_admin());
grant update (resolved_at) on public.alerts to authenticated;
create policy alerts_admin_update on public.alerts for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Validate admin edits (server-side input validation) ------------------------
create or replace function public.articles_validate_edit()
returns trigger language plpgsql set search_path = '' as $$
declare
  bad text;
begin
  if new.categories is distinct from old.categories then
    select c into bad from unnest(new.categories) c
      where c not in (select slug from public.categories) limit 1;
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
create trigger articles_validate before update on public.articles
  for each row execute function public.articles_validate_edit();

-- Audit every change to an article made by a signed-in user.
create or replace function public.articles_audit()
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
    insert into public.article_history (article_id, changed_by, action, old_values, new_values)
    values (new.id, (select auth.uid()), 'edit', ov, nv);
  end if;
  return null;
end $$;
create trigger articles_audit after update on public.articles
  for each row execute function public.articles_audit();

-- Owner bootstrap: the first signed-in user who calls this becomes owner,
-- but ONLY while no owner exists yet. Afterwards it is a no-op.
create or replace function public.claim_first_owner()
returns boolean language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then return false; end if;
  lock table public.admins in exclusive mode;
  if exists (select 1 from public.admins where role = 'owner') then return false; end if;
  if (select value from public.settings where key = 'allow_owner_claim') is distinct from 'true'::jsonb then return false; end if;
  insert into public.admins (user_id, role) values (uid, 'owner');
  update public.settings set value = 'false'::jsonb where key = 'allow_owner_claim';
  return true;
end $$;
grant execute on function public.claim_first_owner() to authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.is_owner() to authenticated;

-- Owners add editors by e-mail (the user must have signed up first).
create or replace function public.add_admin_by_email(p_email text, p_role text default 'editor')
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_role not in ('owner', 'editor') then raise exception 'bad role' using errcode = '22023'; end if;
  select id into uid from auth.users where lower(email) = lower(btrim(p_email));
  if uid is null then return 'not_found'; end if;
  insert into public.admins (user_id, role) values (uid, p_role)
    on conflict (user_id) do update set role = excluded.role;
  return 'ok';
end $$;
grant execute on function public.add_admin_by_email(text, text) to authenticated;
