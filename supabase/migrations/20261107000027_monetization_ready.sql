-- Monetization readiness (no paid service, everything OFF by default):
--  * ads_config        — public setting read by the site; only "house" ads (your own promotions: text, link, optional image)
--                         render today. Third-party ad networks need a script + CSP change — see guide/MONETIZATION.md.
--  * newsletter_enabled — shows a newsletter sign-up box when true. Sign-ups are stored here; sending needs an e-mail
--                         provider (none is connected), so the box says subscribers will receive a confirmation e-mail.
-- Additive only.

insert into public.news_settings (key, value, description, is_public) values
  ('ads_config', '{"enabled": false, "slots": ["home_side", "article", "sports"], "house": []}'::jsonb,
   'إعلانات: enabled=true لتفعيلها. house = قائمة إعلاناتك الخاصة [{"title_ar":"…","title_en":"…","text_ar":"…","text_en":"…","url":"https://…","image":"https://…(اختياري)","sponsor":"اسم الجهة"}]. slots: home_side, article, sports.', true),
  ('newsletter_enabled', 'false'::jsonb, 'إظهار مربع الاشتراك في النشرة البريدية (true/false). الإرسال يحتاج مزوّد بريد — راجع guide/MONETIZATION.md.', true)
on conflict (key) do nothing;

create table public.news_newsletter_subscribers (
  id          bigint generated always as identity primary key,
  email       text not null check (email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}$' and char_length(email) <= 254),
  language    text not null default 'ar' check (language in ('ar', 'en')),
  status      text not null default 'pending' check (status in ('pending', 'confirmed', 'unsubscribed')),
  consent_at  timestamptz not null default now(),
  unsubscribe_token uuid not null default gen_random_uuid(),
  created_at  timestamptz not null default now()
);
create unique index news_newsletter_email on public.news_newsletter_subscribers (lower(email));
alter table public.news_newsletter_subscribers enable row level security;
revoke all on public.news_newsletter_subscribers from anon, authenticated;
grant select, update (status) on public.news_newsletter_subscribers to authenticated;
create policy newsletter_admin_read on public.news_newsletter_subscribers for select to authenticated using (public.news_is_admin());
create policy newsletter_admin_update on public.news_newsletter_subscribers for update to authenticated using (public.news_is_admin()) with check (public.news_is_admin());

-- Public sign-up: validates, requires consent, ignores duplicates (never reveals whether an address exists),
-- refuses when sign-ups are switched off, and caps the global rate to blunt abuse.
create or replace function public.news_newsletter_subscribe(p_email text, p_language text default 'ar', p_consent boolean default false)
returns text language plpgsql security definer set search_path = '' as $$
declare e text := lower(btrim(coalesce(p_email, '')));
begin
  if coalesce((select value from public.news_settings where key = 'newsletter_enabled'), 'false'::jsonb) <> 'true'::jsonb then return 'closed'; end if;
  if not p_consent then return 'consent_required'; end if;
  if e !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}$' or char_length(e) > 254 then return 'invalid'; end if;
  if (select count(*) from public.news_newsletter_subscribers where created_at > now() - interval '1 minute') >= 20 then return 'busy'; end if;
  insert into public.news_newsletter_subscribers (email, language)
  values (e, case when p_language = 'en' then 'en' else 'ar' end)
  on conflict (lower(email)) do nothing;
  return 'ok';
end $$;
revoke all on function public.news_newsletter_subscribe(text, text, boolean) from public;
grant execute on function public.news_newsletter_subscribe(text, text, boolean) to anon, authenticated;
