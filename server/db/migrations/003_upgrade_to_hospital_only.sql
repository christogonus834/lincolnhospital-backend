-- =========================================================
-- MIGRATION: convert an EXISTING Sterling Group database to hospital-only
-- and add what the doctor email alerts + security hardening need.
--
-- Run once in the Supabase SQL editor. It is idempotent.
-- >>> BACK UP FIRST (Supabase > Database > Backups). The DROP statements
-- >>> permanently delete all Lakeview data (rooms, bookings, journal posts).
-- =========================================================

-- 1) Remove Lakeview ------------------------------------------------------
drop trigger if exists trg_notify_new_booking on bookings;
drop function if exists notify_new_booking();
drop table if exists room_blocks cascade;
drop table if exists bookings cascade;
drop table if exists rooms cascade;
drop table if exists lakeview_posts cascade;

delete from notifications where division = 'lakeview';
delete from partners where division = 'lakeview';
delete from site_content where division in ('lakeview', 'group');
delete from site_settings where key in ('group_logo', 'lakeview_logo', 'lakeview_payments_enabled');

alter table notifications drop constraint if exists notifications_division_check;
alter table notifications add constraint notifications_division_check check (division = 'hospital');
alter table partners drop constraint if exists partners_division_check;
alter table partners add constraint partners_division_check check (division = 'hospital');
alter table site_content drop constraint if exists site_content_division_check;
alter table site_content add constraint site_content_division_check check (division = 'hospital');
alter table site_content drop column if exists video_url;

-- 2) Doctor email + notification tracking ----------------------------------
alter table doctors add column if not exists email text;
alter table appointments add column if not exists doctor_notified_at timestamptz;

-- 3) No double-booking (resolve any existing duplicates first, or this fails) ---
create unique index if not exists uq_appointments_active_slot
  on appointments(doctor_id, appointment_date, appointment_time)
  where status in ('pending', 'confirmed');

-- 4) Persistent admin sessions ---------------------------------------------
create table if not exists admin_sessions (
  sid text primary key,
  sess jsonb not null,
  expire timestamptz not null
);
create index if not exists idx_admin_sessions_expire on admin_sessions(expire);
alter table admin_sessions enable row level security;

-- 5) Lock down public access -------------------------------------------------
drop policy if exists "public can create appointment" on appointments;
drop policy if exists "public read site settings" on site_settings;
create policy "public read site settings" on site_settings for select using (key = 'hospital_logo');

revoke all on doctors from anon, authenticated;
grant select (id, full_name, title, department_id, bio, photo_url, is_active,
              days_available, start_hour, end_hour, slot_minutes, created_at)
  on doctors to anon, authenticated;
revoke all on admins, admin_sessions, appointments, notifications from anon, authenticated;
