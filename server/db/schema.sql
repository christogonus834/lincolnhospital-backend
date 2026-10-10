-- =========================================================
-- STERLING SPECIALIST HOSPITAL — SUPABASE SCHEMA
-- Run once in the Supabase SQL editor on a NEW project.
-- (Existing database that still has the Lakeview tables? Run
--  migrations/003_upgrade_to_hospital_only.sql instead.)
-- =========================================================

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------
-- ADMIN
-- ---------------------------------------------------------
create table if not exists admins (
  id uuid primary key default uuid_generate_v4(),
  email text unique not null,
  password_hash text not null,
  full_name text not null default 'Admin',
  created_at timestamptz not null default now()
);

-- Server-side login sessions (replaces express-session's in-memory store)
create table if not exists admin_sessions (
  sid text primary key,
  sess jsonb not null,
  expire timestamptz not null
);
create index if not exists idx_admin_sessions_expire on admin_sessions(expire);

-- ---------------------------------------------------------
-- SITE CONTENT (editable page sections)
-- ---------------------------------------------------------
create table if not exists site_content (
  id text primary key,
  division text not null default 'hospital' check (division = 'hospital'),
  title text,
  body text,
  image_url text,
  sort_order int not null default 0,
  placement text not null default 'extra' check (placement in ('fixed', 'extra')),
  updated_at timestamptz not null default now()
);
create index if not exists idx_site_content_sort on site_content(sort_order);

-- ---------------------------------------------------------
-- DEPARTMENTS
-- ---------------------------------------------------------
create table if not exists departments (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique not null,
  description text,
  icon_key text default 'pulse',
  sort_order int not null default 0,
  is_active boolean not null default true
);

-- ---------------------------------------------------------
-- DOCTORS
-- `email` is PRIVATE: it receives the booking alerts and is never exposed
-- publicly (see the column grants in the ROW LEVEL SECURITY section).
-- ---------------------------------------------------------
create table if not exists doctors (
  id uuid primary key default uuid_generate_v4(),
  full_name text not null,
  title text not null,
  email text,
  department_id uuid references departments(id) on delete set null,
  bio text,
  photo_url text,
  is_active boolean not null default true,
  days_available text[] default array['Mon','Tue','Wed','Thu','Fri'],
  start_hour int default 9,
  end_hour int default 16,
  slot_minutes int default 30,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- APPOINTMENTS
-- ---------------------------------------------------------
create table if not exists appointments (
  id uuid primary key default uuid_generate_v4(),
  doctor_id uuid references doctors(id) on delete set null,
  department_id uuid references departments(id) on delete set null,
  patient_name text not null,
  patient_email text not null,
  patient_phone text,
  appointment_date date not null,
  appointment_time time not null,
  reason text,
  status text not null default 'pending' check (status in ('pending','confirmed','cancelled','completed')),
  doctor_notified_at timestamptz,  -- set when the Brevo email to the doctor was accepted
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live booking per doctor per slot. Makes double-booking impossible even
-- when two patients submit at the same instant.
create unique index if not exists uq_appointments_active_slot
  on appointments(doctor_id, appointment_date, appointment_time)
  where status in ('pending', 'confirmed');

-- ---------------------------------------------------------
-- HEALTH ARTICLES
-- ---------------------------------------------------------
create table if not exists hospital_posts (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  slug text unique not null,
  excerpt text,
  body text,
  cover_image_url text,
  is_published boolean not null default true,
  published_at timestamptz default now(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- ADMIN NOTIFICATIONS
-- ---------------------------------------------------------
create table if not exists notifications (
  id uuid primary key default uuid_generate_v4(),
  division text not null default 'hospital' check (division = 'hospital'),
  type text not null,
  reference_id uuid,
  title text not null,
  body text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- PARTNERS, SETTINGS, BOARD
-- ---------------------------------------------------------
create table if not exists partners (
  id uuid primary key default uuid_generate_v4(),
  division text not null default 'hospital' check (division = 'hospital'),
  name text not null,
  logo_url text not null,
  website_url text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists site_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

create table if not exists board_members (
  id uuid primary key default uuid_generate_v4(),
  full_name text not null,
  role text,
  bio text,
  photo_url text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

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

-- ---------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------
create index if not exists idx_appointments_doctor_date on appointments(doctor_id, appointment_date);
create index if not exists idx_notifications_read on notifications(is_read);
create index if not exists idx_doctors_department on doctors(department_id);
create index if not exists idx_partners_active on partners(is_active, sort_order);

-- ---------------------------------------------------------
-- TRIGGER: new appointment -> admin notification
-- ---------------------------------------------------------
create or replace function notify_new_appointment() returns trigger as $$
begin
  insert into notifications (division, type, reference_id, title, body)
  values (
    'hospital',
    'appointment_new',
    new.id,
    'New appointment: ' || new.patient_name,
    new.patient_name || ' requested ' || new.appointment_date || ' at ' || new.appointment_time
  );
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_notify_new_appointment on appointments;
create trigger trg_notify_new_appointment
  after insert on appointments
  for each row execute function notify_new_appointment();

-- ---------------------------------------------------------
-- ROW LEVEL SECURITY
-- The Node server uses the service_role key (bypasses RLS) for everything.
-- The public anon key is never needed by the app, so it gets read-only access
-- to published content and NOTHING else — in particular it cannot insert
-- appointments directly (that would skip all server validation) or read
-- doctors' email addresses.
-- ---------------------------------------------------------
alter table admins enable row level security;
alter table admin_sessions enable row level security;
alter table site_content enable row level security;
alter table departments enable row level security;
alter table doctors enable row level security;
alter table appointments enable row level security;
alter table hospital_posts enable row level security;
alter table notifications enable row level security;
alter table partners enable row level security;
alter table site_settings enable row level security;
alter table board_members enable row level security;

drop policy if exists "public read active departments" on departments;
create policy "public read active departments" on departments for select using (is_active = true);
drop policy if exists "public read active doctors" on doctors;
create policy "public read active doctors" on doctors for select using (is_active = true);
drop policy if exists "public read published hospital posts" on hospital_posts;
create policy "public read published hospital posts" on hospital_posts for select using (is_published = true);
drop policy if exists "public read site content" on site_content;
create policy "public read site content" on site_content for select using (true);
drop policy if exists "public read active partners" on partners;
create policy "public read active partners" on partners for select using (is_active = true);
drop policy if exists "public read site settings" on site_settings;
create policy "public read site settings" on site_settings for select using (key = 'hospital_logo');
drop policy if exists "public read active board members" on board_members;
create policy "public read active board members" on board_members for select using (is_active = true);
-- admins, admin_sessions, appointments, notifications: no public policy -> service_role only.

-- Column-level lock: anon/authenticated may read every doctor column EXCEPT email.
revoke all on doctors from anon, authenticated;
grant select (id, full_name, title, department_id, bio, photo_url, is_active,
              days_available, start_hour, end_hour, slot_minutes, created_at)
  on doctors to anon, authenticated;

-- Nothing public should ever write, or touch private tables.
revoke all on admins, admin_sessions, appointments, notifications from anon, authenticated;
