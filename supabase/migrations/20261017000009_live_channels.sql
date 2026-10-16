-- Live TV channels: official YouTube live streams of news channels.
-- If youtube_channel_id is known the page embeds the channel's current live stream
-- (youtube.com/embed/live_stream?channel=ID); otherwise it links to youtube.com/@handle/live.
create table public.news_live_channels (
  id                 serial primary key,
  name_ar            text not null check (char_length(name_ar) between 2 and 60),
  youtube_channel_id text check (youtube_channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  youtube_handle     text check (youtube_handle ~ '^@[A-Za-z0-9._-]{3,40}$'),
  official_live_url  text check (official_live_url ~ '^https://'),
  country            text,
  enabled            boolean not null default true,
  sort_order         smallint not null default 100,
  created_at         timestamptz not null default now(),
  check (youtube_channel_id is not null or youtube_handle is not null or official_live_url is not null)
);
alter table public.news_live_channels enable row level security;
revoke all on public.news_live_channels from anon, authenticated;
revoke all on sequence public.news_live_channels_id_seq from anon, authenticated;
grant select on public.news_live_channels to anon, authenticated;
create policy live_public_read on public.news_live_channels for select using (enabled or public.news_is_admin());
grant insert (name_ar, youtube_channel_id, youtube_handle, official_live_url, country, enabled, sort_order),
      update (name_ar, youtube_channel_id, youtube_handle, official_live_url, country, enabled, sort_order)
  on public.news_live_channels to authenticated;
grant usage on sequence public.news_live_channels_id_seq to authenticated;
create policy live_admin_insert on public.news_live_channels for insert to authenticated with check (public.news_is_admin());
create policy live_admin_update on public.news_live_channels for update to authenticated using (public.news_is_admin()) with check (public.news_is_admin());

-- Channel IDs below were verified against public channel listings on 2026-10-17.
-- Channels without a verified ID use their official YouTube handle (opens the live page on YouTube).
insert into public.news_live_channels (name_ar, youtube_channel_id, youtube_handle, country, sort_order) values
  ('المملكة',            'UC0jiFAzTgl17k7awGbuoYew', null,           'JO', 1),
  ('رؤيا',               null,                       '@royatv',      'JO', 2),
  ('الجزيرة',            null,                       '@ajarabic',    'QA', 3),
  ('الجزيرة مباشر',      'UCCv1Pd24oPErw5S7zJWltnQ', null,           'QA', 4),
  ('سكاي نيوز عربية',    'UCIJXOvggjKtCagMfxvcCzAA', null,           'AE', 5),
  ('العربية',            null,                       '@alarabiya',   'AE', 6),
  ('العربي',             'UC65i3Fyq91uiUkIS0i5GLNQ', null,           'QA', 7),
  ('فرانس 24 عربي',      null,                       '@france24_ar', 'FR', 8),
  ('DW عربية',           'UC30ditU5JI16o5NbFsHde_Q', null,           'DE', 9);
