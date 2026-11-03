-- AI translation reliability (2026-11-03).
-- Diagnosis: on 2026-11-03 translation stopped at 10:00 (Amman) for the rest of the day.
--  * news_ai_take() reserved a whole run's quota up front; when the provider answered 429 the run
--    stopped but the reservation was never returned (631 real requests were counted as 1200).
--  * After a 429 every run tried again (one wasted request per minute).
-- Fix: return unused reservations (news_ai_refund) and pause AI calls after a provider 429
-- (news_ai_backoff). The daily limit now counts provider requests; one request translates a batch.

insert into public.news_settings (key, value, description, is_public) values
  ('ai_cooldown_until', 'null', 'إيقاف مؤقت لاستدعاءات الذكاء الاصطناعي بعد رفض المزوّد (429) — يُدار آلياً', false)
on conflict (key) do nothing;

create or replace function public.news_ai_take(p_n int)
returns int language plpgsql security definer set search_path = '' as $$
declare
  lim int := coalesce((select (value)::text::int from public.news_settings where key = 'ai_daily_limit'), 0);
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
  update public.news_ai_usage set calls = calls + granted where day = current_date;
  return granted;
end $$;

-- Give back reservations a run did not use (provider refused, nothing left to translate, errors before the call).
create or replace function public.news_ai_refund(p_n int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(p_n, 0) <= 0 then return; end if;
  update public.news_ai_usage set calls = greatest(0, calls - p_n) where day = current_date;
end $$;

-- Pause AI calls for p_minutes after the provider rate-limits us.
create or replace function public.news_ai_backoff(p_minutes int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.news_settings
     set value = to_jsonb(now() + make_interval(mins => greatest(1, least(coalesce(p_minutes, 15), 240))))
   where key = 'ai_cooldown_until';
end $$;

revoke execute on function public.news_ai_take(int), public.news_ai_refund(int), public.news_ai_backoff(int) from public, anon, authenticated;
grant execute on function public.news_ai_take(int), public.news_ai_refund(int), public.news_ai_backoff(int) to service_role;

-- AITNews returns HTTP 403 (anti-bot) on every request since 2026-11-03 — disabled, not bypassed.
update public.news_sources set enabled = false, terms_note = 'Disabled 2026-11-03: HTTP 403 anti-bot (not bypassed)'
where slug = 'aitnews';
