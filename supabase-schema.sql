-- =====================================================================
-- VID — Supabase Schema (DDL + Dummy Data)
-- =====================================================================
-- Isse apne Supabase project ke SQL Editor mein paste karke "Run" karo.
-- Ye script safe hai — dubara run karne par error nahi degi (IF NOT EXISTS).
-- =====================================================================

-- ---------- EXTENSIONS ----------
create extension if not exists "pgcrypto";

-- =====================================================================
-- 1) MOVIES / VIDEOS  (uploaded + synced content dono yahin store honge)
-- =====================================================================
create table if not exists public.movies (
  id             bigint generated always as identity primary key,
  title          text not null,
  description    text not null default '',
  image          text not null,                 -- thumbnail / poster
  backdrop       text,                          -- hero banner image
  year           int  not null default extract(year from now())::int,
  rating         text not null default 'TV-14', -- e.g. 'PG', 'TV-MA'
  duration       text not null default '',      -- e.g. '2h 15m' or '24m'
  genre          text[] not null default '{}',  -- e.g. '{Anime,Action}'
  match_score    int  not null default 95,      -- 0-100
  cast_members   text[] default '{}',
  creator        text,

  -- video sources (koi ek bharo)
  video_url      text,   -- direct mp4 / uploaded file url
  thumbnail_url  text,
  youtube_id     text,
  embed_url      text,
  embed_platform text,   -- 'YouTube' | 'Vimeo' | 'Odysee' | ...

  -- playlist / series grouping
  playlist_id      text,
  playlist_title   text,
  episode_number   int,
  season_number    int,
  is_collection    boolean not null default false,

  source_type    text not null default 'uploaded'
                 check (source_type in ('uploaded','synced','demo')),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists movies_playlist_id_idx  on public.movies (playlist_id);
create index if not exists movies_source_type_idx  on public.movies (source_type);
create index if not exists movies_created_at_idx   on public.movies (created_at desc);
create index if not exists movies_genre_gin_idx    on public.movies using gin (genre);

-- Data API grants (Supabase ke naye projects mein ye zaruri hai)
grant select on public.movies to anon, authenticated;
grant insert, update, delete on public.movies to authenticated;
grant all on public.movies to service_role;

alter table public.movies enable row level security;

drop policy if exists "movies public read"       on public.movies;
drop policy if exists "movies auth write"        on public.movies;
create policy "movies public read"
  on public.movies for select
  to anon, authenticated
  using (true);
create policy "movies auth write"
  on public.movies for all
  to authenticated
  using (true) with check (true);

-- =====================================================================
-- 2) PROFILES  (auth.users se link — per-user info)
-- =====================================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text unique,
  avatar_url  text,
  created_at  timestamptz not null default now()
);
grant select on public.profiles to anon, authenticated;
grant insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
drop policy if exists "profiles self read"  on public.profiles;
drop policy if exists "profiles self write" on public.profiles;
create policy "profiles self read"  on public.profiles for select to authenticated using (true);
create policy "profiles self write" on public.profiles for all    to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

-- =====================================================================
-- 3) MY LIST  (user ki saved list)
-- =====================================================================
create table if not exists public.my_list (
  user_id    uuid not null references auth.users(id) on delete cascade,
  movie_id   bigint not null references public.movies(id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (user_id, movie_id)
);
grant select, insert, delete on public.my_list to authenticated;
grant all on public.my_list to service_role;
alter table public.my_list enable row level security;
drop policy if exists "mylist self" on public.my_list;
create policy "mylist self" on public.my_list for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =====================================================================
-- 4) LIKES
-- =====================================================================
create table if not exists public.likes (
  user_id  uuid not null references auth.users(id) on delete cascade,
  movie_id bigint not null references public.movies(id) on delete cascade,
  liked_at timestamptz not null default now(),
  primary key (user_id, movie_id)
);
grant select, insert, delete on public.likes to authenticated;
grant all on public.likes to service_role;
alter table public.likes enable row level security;
drop policy if exists "likes self" on public.likes;
create policy "likes self" on public.likes for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =====================================================================
-- 5) WATCH HISTORY (optional — "Watch Again" row ke liye)
-- =====================================================================
create table if not exists public.watch_history (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  movie_id      bigint not null references public.movies(id) on delete cascade,
  progress_sec  int  not null default 0,
  watched_at    timestamptz not null default now()
);
create index if not exists watch_history_user_idx on public.watch_history (user_id, watched_at desc);
grant select, insert, update, delete on public.watch_history to authenticated;
grant all on public.watch_history to service_role;
alter table public.watch_history enable row level security;
drop policy if exists "watch self" on public.watch_history;
create policy "watch self" on public.watch_history for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =====================================================================
-- 6) HERO BANNERS  (admin custom hero overrides)
-- =====================================================================
create table if not exists public.hero_banners (
  movie_id     bigint primary key references public.movies(id) on delete cascade,
  banner_image text not null,
  title        text,
  description  text,
  badge        text,
  sort_order   int  not null default 0,
  created_at   timestamptz not null default now()
);
grant select on public.hero_banners to anon, authenticated;
grant insert, update, delete on public.hero_banners to authenticated;
grant all on public.hero_banners to service_role;
alter table public.hero_banners enable row level security;
drop policy if exists "hero read"  on public.hero_banners;
drop policy if exists "hero write" on public.hero_banners;
create policy "hero read"  on public.hero_banners for select to anon, authenticated using (true);
create policy "hero write" on public.hero_banners for all    to authenticated using (true) with check (true);

-- =====================================================================
-- 7) SITE CONFIG  (single-row settings + custom rows JSON)
-- =====================================================================
create table if not exists public.site_config (
  id             int primary key default 1 check (id = 1),
  brand_prefix   text not null default 'vid',
  brand_suffix   text not null default '',
  hero_badge     text not null default '⭐ FEATURED',
  hero_title     text not null default '',
  hero_description text not null default '',
  hero_overlay_visible boolean not null default true,
  rows           jsonb not null default '[]'::jsonb,
  custom_rows    jsonb not null default '[]'::jsonb,
  updated_at     timestamptz not null default now()
);
grant select on public.site_config to anon, authenticated;
grant insert, update on public.site_config to authenticated;
grant all on public.site_config to service_role;
alter table public.site_config enable row level security;
drop policy if exists "config read"  on public.site_config;
drop policy if exists "config write" on public.site_config;
create policy "config read"  on public.site_config for select to anon, authenticated using (true);
create policy "config write" on public.site_config for all    to authenticated using (true) with check (true);

insert into public.site_config (id) values (1)
on conflict (id) do nothing;

-- =====================================================================
-- DUMMY DATA — turant website par content dikhne ke liye
-- =====================================================================

insert into public.movies
  (title, description, image, backdrop, year, rating, duration, genre, match_score, creator, youtube_id, source_type)
values
  ('Big Buck Bunny',
   'Ek pyaari si short animated film — Blender ki open movie.',
   'https://peach.blender.org/wp-content/uploads/bbb-splash.png',
   'https://peach.blender.org/wp-content/uploads/title_anouncement.jpg',
   2008, 'PG', '9m', '{Animation,Cartoon,Comedy}', 97, 'Blender Foundation', 'YE7VzlLtp-4', 'demo'),

  ('Sintel',
   'Ek akeli ladki apne kho gaye dragon dost ko dhoondhne nikalti hai.',
   'https://durian.blender.org/wp-content/uploads/2010/06/sintel_poster.jpg',
   'https://durian.blender.org/wp-content/uploads/2010/05/sintel_wide.jpg',
   2010, 'PG-13', '15m', '{Animation,Fantasy,Adventure}', 95, 'Blender Foundation', 'eRsGyueVLvQ', 'demo'),

  ('Tears of Steel',
   'Sci-fi short — future ki Amsterdam mein robots aur insaan.',
   'https://mango.blender.org/wp-content/gallery/4k-renders/01_thom_celia_bridge.jpg',
   'https://mango.blender.org/wp-content/gallery/4k-renders/01_thom_celia_bridge.jpg',
   2012, 'PG-13', '12m', '{Sci-Fi,Action}', 92, 'Blender Foundation', 'R6MlUcmOul8', 'demo'),

  ('Elephant''s Dream',
   'Do characters ek strange machine world explore karte hain.',
   'https://orange.blender.org/wp-content/themes/orange/images/media/gallery/s1_proog.jpg',
   'https://orange.blender.org/wp-content/themes/orange/images/media/gallery/s6_both1.jpg',
   2006, 'PG', '10m', '{Animation,Sci-Fi}', 89, 'Blender Foundation', 'TLkA0RELQ1g', 'demo'),

  ('Agent 327: Operation Barbershop',
   'Dutch secret agent ki comedy animated short.',
   'https://studio.blender.org/static/apps/agent327-poster.jpg',
   'https://studio.blender.org/static/apps/agent327-poster.jpg',
   2017, 'PG', '4m', '{Animation,Action,Comedy}', 90, 'Blender Studio', 'mN0zPOpADL4', 'demo'),

  ('Spring',
   'Ek shepherd ladki aur uska kutta pahadon mein magical spirits se milte hain.',
   'https://studio.blender.org/static/apps/spring-poster.jpg',
   'https://studio.blender.org/static/apps/spring-poster.jpg',
   2019, 'PG', '8m', '{Animation,Fantasy}', 94, 'Blender Studio', 'WhWc3b3KhnY', 'demo'),

  ('Coffee Run',
   '2D animated short — ek din, ek coffee run.',
   'https://studio.blender.org/static/apps/coffee-run-poster.jpg',
   'https://studio.blender.org/static/apps/coffee-run-poster.jpg',
   2020, 'PG', '4m', '{Animation,Comedy}', 88, 'Blender Studio', '2Ge_UtvOTNI', 'demo'),

  ('Sprite Fright',
   'Ek 80s horror-comedy animated short — jungle mein kuch to gadbad hai.',
   'https://studio.blender.org/static/apps/sprite-fright-poster.jpg',
   'https://studio.blender.org/static/apps/sprite-fright-poster.jpg',
   2021, 'TV-14', '10m', '{Animation,Horror,Comedy,Anime}', 93, 'Blender Studio', '_cMxraX_5RE', 'demo'),

  ('Charge',
   'Sci-fi live-action short film ek prisoner aur uske guard ke baare mein.',
   'https://studio.blender.org/static/apps/charge-poster.jpg',
   'https://studio.blender.org/static/apps/charge-poster.jpg',
   2022, 'TV-MA', '19m', '{Sci-Fi,Action,Drama}', 91, 'Blender Studio', 'UXqq0ZvbOnk', 'demo'),

  ('Wing It!',
   'Ek pilot ki funny animated short.',
   'https://studio.blender.org/static/apps/wing-it-poster.jpg',
   'https://studio.blender.org/static/apps/wing-it-poster.jpg',
   2023, 'PG', '5m', '{Animation,Comedy,Cartoon}', 90, 'Blender Studio', 'u9lj-c29dxI', 'demo')
on conflict do nothing;

-- Ek hero banner default set kar dete hain (pehli movie)
insert into public.hero_banners (movie_id, banner_image, title, description, badge, sort_order)
select m.id, coalesce(m.backdrop, m.image), m.title, m.description, '⭐ FEATURED', 0
from public.movies m
where m.title = 'Big Buck Bunny'
on conflict (movie_id) do nothing;

-- =====================================================================
-- DONE ✅  — Supabase Table Editor mein ab tables + rows dikhne chahiye.
-- =====================================================================
