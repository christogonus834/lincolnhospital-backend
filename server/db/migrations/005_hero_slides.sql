-- =========================================================
-- MIGRATION: hero slider. Admin > Hero slides manages the photos.
-- Safe to re-run. With no slides, the site shows its built-in photo.
-- =========================================================

-- ---------------------------------------------------------
-- HERO SLIDES (photos rotating behind the home page headline)
-- ---------------------------------------------------------
create table if not exists hero_slides (
  id uuid primary key default uuid_generate_v4(),
  image_url text not null,
  focus_y int not null default 50 check (focus_y between 0 and 100),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_hero_slides_sort on hero_slides(sort_order);
alter table hero_slides enable row level security;
drop policy if exists "public read hero slides" on hero_slides;
create policy "public read hero slides" on hero_slides for select using (true);
revoke insert, update, delete on hero_slides from anon, authenticated;
