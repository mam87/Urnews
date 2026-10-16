-- Minimal stand-ins for Supabase-managed objects so migrations can be tested on plain Postgres.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema extensions;
create extension pg_trgm with schema extensions;
create extension pgcrypto with schema extensions;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, description text);
create view vault.decrypted_secrets as select id, name, secret as decrypted_secret, description from vault.secrets;
create function vault.create_secret(s text, n text, d text default '') returns uuid language sql as $$ insert into vault.secrets(name, secret, description) values (n, s, d) returning id $$;
create schema realtime;
create table realtime.sent (id serial, payload jsonb, event text, topic text, private boolean, at timestamptz default now());
create function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void language sql as $$ insert into realtime.sent(payload, event, topic, private) values ($1, $2, $3, $4) $$;
grant usage on schema public, extensions to anon, authenticated, service_role;
-- Supabase's default privileges are broad; migrations must narrow them.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
grant usage on schema realtime to service_role, authenticated; grant select on realtime.sent to service_role, authenticated;
-- A pre-existing app sharing the project (e.g. LabGram): migrations must not touch it.
create table public.lg_existing (id int primary key, note text);
insert into public.lg_existing values (1, 'existing app data');
create function public.lg_existing_fn() returns int language sql as $$ select 42 $$;
