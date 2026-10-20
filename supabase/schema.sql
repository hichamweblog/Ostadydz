-- =============================================================================
-- معين الأستاذ (Mueen Al-Ostad) — المخطط السحابي الشامل والموحّد (Supabase Bootstrap)
-- يدعم جميع المواد الـ 18 وفق القرار 186/2006، الإسناد المتعدد، المزامنة التفاضلية،
-- البث اللحظي (Realtime + REPLICA IDENTITY FULL)، وحاويات التخزين (avatars & memoranda).
-- =============================================================================

create extension if not exists pgcrypto;

-- 1. دوال التوقيت ومراجعة المزامنة (Triggers)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end
$$;

create or replace function public.set_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = timezone('utc', now());
  new.sync_updated_at = timezone('utc', now());
  return new;
end
$$;

create or replace function public.bump_revision()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  new.revision = old.revision + 1;
  new.sync_updated_at = timezone('utc', now());
  new.updated_by = coalesce(auth.uid(), new.updated_by);
  return new;
end
$$;

-- 2. ملفات الأساتذة ومساحات العمل (Profiles & Workspaces)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  title text,
  school_name text,
  state_name text,
  academic_year text,
  hijri_year text,
  first_name_ar text,
  last_name_ar text,
  first_name_en text,
  last_name_en text,
  email text,
  phone text,
  avatar_url text,
  avatar_storage_key text,
  first_appointment_date date,
  experience_years integer,
  birth_date date,
  birth_place text,
  family_status text,
  gender text check (gender is null or gender in ('M', 'F')),
  sync_revision bigint not null default 0,
  sync_updated_at timestamptz not null default timezone('utc', now()),
  sync_device_id text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null default 'مساحة العمل' check (length(btrim(name)) > 0),
  unique (id, owner_id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    nullif(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'avatar_url', '')
  )
  on conflict (id) do nothing;

  insert into public.workspaces (owner_id)
  values (new.id)
  on conflict (owner_id) do nothing;

  return new;
end
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();
revoke execute on function public.handle_new_user_profile() from public, anon, authenticated;

-- تهيئة مساحات العمل لأي مستخدمين مسجلين مسبقاً
insert into public.profiles (id, full_name, avatar_url)
select u.id, nullif(u.raw_user_meta_data->>'full_name', ''), nullif(u.raw_user_meta_data->>'avatar_url', '')
from auth.users u
on conflict (id) do nothing;

insert into public.workspaces (owner_id)
select u.id from auth.users u
on conflict (owner_id) do nothing;

create or replace function public.default_workspace_id()
returns uuid
language sql
stable
security invoker
set search_path = public
as $$
  select id from public.workspaces where owner_id = auth.uid() limit 1
$$;
revoke all on function public.default_workspace_id() from public, anon;
grant execute on function public.default_workspace_id() to authenticated;

-- 3. الأقسام والتلاميذ (Classes & Students)
create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.default_workspace_id(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  level text,
  section text,
  room_number text,
  color text,
  weekly_hours smallint not null default 2 check (weekly_hours between 1 and 20),
  academic_year text,
  notes text,
  revision bigint not null default 0 check (revision >= 0),
  sync_revision bigint not null default 0,
  sync_updated_at timestamptz not null default timezone('utc', now()),
  sync_device_id text,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, name, academic_year),
  unique (workspace_id, id),
  foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id) deferrable initially immediate
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.default_workspace_id(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  class_id uuid not null,
  external_id text,
  full_name text not null check (length(btrim(full_name)) > 0),
  normalized_name text generated always as (lower(regexp_replace(btrim(full_name), '\s+', ' ', 'g'))) stored,
  number_in_list integer not null check (number_in_list > 0),
  reg_number text,
  registration_number text,
  is_repeater boolean not null default false,
  guardian_phone text,
  gender text check (gender in ('male', 'female', 'other', 'unspecified')),
  birth_date date,
  notes text,
  revision bigint not null default 0 check (revision >= 0),
  sync_revision bigint not null default 0,
  sync_updated_at timestamptz not null default timezone('utc', now()),
  sync_device_id text,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, class_id, number_in_list),
  unique (workspace_id, id),
  foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id),
  foreign key (workspace_id, class_id) references public.classes(workspace_id, id) on delete cascade
);

-- 4. النقاط والعلامات الفصلية متعددة المواد (Grades)
create table if not exists public.grades (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.default_workspace_id(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  student_id uuid not null,
  class_id uuid not null,
  subject_id text,
  trimester smallint not null check (trimester between 1 and 3),
  continuous_eval numeric(5,2) check (continuous_eval between 0 and 20),
  behavior_score numeric(5,2) check (behavior_score between 0 and 5),
  attendance_score numeric(5,2) check (attendance_score between 0 and 5),
  notebook_score numeric(5,2) check (notebook_score between 0 and 5),
  participation_score numeric(5,2) check (participation_score between 0 and 5),
  quiz numeric(5,2) check (quiz between 0 and 20),
  devoir2 numeric(5,2) check (devoir2 between 0 and 20),
  practical_work numeric(5,2) check (practical_work between 0 and 20),
  oral_expression numeric(5,2) check (oral_expression between 0 and 20),
  exam numeric(5,2) check (exam between 0 and 20),
  calculated_average numeric(5,2) check (calculated_average between 0 and 20),
  estimation text,
  guidance text,
  remarks text,
  follow_up_notes text,
  revision bigint not null default 0 check (revision >= 0),
  sync_revision bigint not null default 0,
  sync_updated_at timestamptz not null default timezone('utc', now()),
  sync_device_id text,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id),
  foreign key (workspace_id, student_id) references public.students(workspace_id, id) on delete cascade,
  foreign key (workspace_id, class_id) references public.classes(workspace_id, id) on delete cascade
);

-- إزالة القيد الأحادي القديم إن وجد لتمكين حفظ أكثر من مادة لنفس التلميذ في نفس الفصل
alter table public.grades drop constraint if exists grades_workspace_id_student_id_trimester_key;

-- 5. الدفتر اليومي، الحضور، السلوك، وجدول التوقيت
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.default_workspace_id(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  class_id uuid not null,
  session_date date not null,
  start_time time,
  end_time time,
  trimester smallint check (trimester between 1 and 3),
  topic text,
  summary text,
  assignments text,
  teacher_notes text,
  revision bigint not null default 0 check (revision >= 0),
  sync_revision bigint not null default 0,
  sync_updated_at timestamptz not null default timezone('utc', now()),
  sync_device_id text,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, class_id, session_date, start_time),
  unique (workspace_id, id),
  foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id),
  foreign key (workspace_id, class_id) references public.classes(workspace_id, id) on delete cascade,
  check (end_time is null or start_time is null or end_time > start_time)
);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.default_workspace_id(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  session_id uuid not null,
  student_id uuid not null,
  status text not null default 'present' check (status in ('present', 'absent', 'late', 'excused')),
  note text,
  revision bigint not null default 0 check (revision >= 0),
  sync_revision bigint not null default 0,
  sync_updated_at timestamptz not null default timezone('utc', now()),
  sync_device_id text,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, session_id, student_id),
  unique (workspace_id, id),
  foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id),
  foreign key (workspace_id, session_id) references public.sessions(workspace_id, id) on delete cascade,
  foreign key (workspace_id, student_id) references public.students(workspace_id, id) on delete cascade
);

create table if not exists public.session_behaviors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.default_workspace_id(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  session_id uuid not null,
  student_id uuid not null,
  behavior text not null check (length(btrim(behavior)) > 0),
  rating smallint check (rating between 1 and 5),
  note text,
  revision bigint not null default 0 check (revision >= 0),
  sync_revision bigint not null default 0,
  sync_updated_at timestamptz not null default timezone('utc', now()),
  sync_device_id text,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id),
  foreign key (workspace_id, session_id) references public.sessions(workspace_id, id) on delete cascade,
  foreign key (workspace_id, student_id) references public.students(workspace_id, id) on delete cascade
);

create table if not exists public.timetable_slots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.default_workspace_id(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  class_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  room text,
  notes text,
  revision bigint not null default 0 check (revision >= 0),
  sync_revision bigint not null default 0,
  sync_updated_at timestamptz not null default timezone('utc', now()),
  sync_device_id text,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (end_time > start_time),
  unique (workspace_id, class_id, weekday, start_time),
  unique (workspace_id, id),
  foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id),
  foreign key (workspace_id, class_id) references public.classes(workspace_id, id) on delete cascade
);

-- 6. المنهاج، التقدم، المذكرات، والمهام
create table if not exists public.curriculum_units (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.default_workspace_id(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (length(btrim(title)) > 0),
  code text,
  level text,
  position integer not null default 0 check (position >= 0),
  description text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  revision bigint not null default 0 check (revision >= 0),
  sync_revision bigint not null default 0,
  sync_updated_at timestamptz not null default timezone('utc', now()),
  sync_device_id text,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, code),
  unique (workspace_id, id),
  foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id)
);

create table if not exists public.custom_units (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.default_workspace_id(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (length(btrim(title)) > 0),
  level text,
  position integer not null default 0 check (position >= 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  revision bigint not null default 0 check (revision >= 0),
  sync_revision bigint not null default 0,
  sync_updated_at timestamptz not null default timezone('utc', now()),
  sync_device_id text,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id)
);

create table if not exists public.lesson_progress (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.default_workspace_id(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  class_id uuid not null,
  unit_id uuid,
  unit_key text,
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'completed')),
  completed_at timestamptz,
  notes text,
  revision bigint not null default 0 check (revision >= 0),
  sync_revision bigint not null default 0,
  sync_updated_at timestamptz not null default timezone('utc', now()),
  sync_device_id text,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, class_id, unit_id),
  unique (workspace_id, class_id, unit_key),
  unique (workspace_id, id),
  foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id),
  foreign key (workspace_id, class_id) references public.classes(workspace_id, id) on delete cascade,
  foreign key (workspace_id, unit_id) references public.curriculum_units(workspace_id, id) on delete cascade,
  check (unit_id is not null or unit_key is not null)
);

create table if not exists public.lesson_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.default_workspace_id(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  class_id uuid,
  unit_id uuid,
  title text not null check (length(btrim(title)) > 0),
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  lesson_date date,
  revision bigint not null default 0 check (revision >= 0),
  sync_revision bigint not null default 0,
  sync_updated_at timestamptz not null default timezone('utc', now()),
  sync_device_id text,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id),
  foreign key (workspace_id, class_id) references public.classes(workspace_id, id) on delete set null,
  foreign key (workspace_id, unit_id) references public.curriculum_units(workspace_id, id) on delete set null
);

create table if not exists public.dashboard_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.default_workspace_id(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  task_id text not null,
  text text not null check (length(btrim(text)) > 0),
  done boolean not null default false,
  revision bigint not null default 0 check (revision >= 0),
  sync_revision bigint not null default 0,
  sync_updated_at timestamptz not null default timezone('utc', now()),
  sync_device_id text,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, task_id),
  foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id) on delete cascade
);

-- 7. الإعدادات، ملفات المذكرات، وسجلات التزامن (Settings, Memoranda & Sync Ledgers)
create table if not exists public.app_settings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.default_workspace_id(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  revision bigint not null default 0 check (revision >= 0),
  sync_revision bigint not null default 0,
  sync_updated_at timestamptz not null default timezone('utc', now()),
  sync_device_id text,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by_device text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id),
  unique (workspace_id, id),
  foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id)
);

create table if not exists public.memoranda_files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.default_workspace_id(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  unit_id uuid,
  unit_key text,
  file_name text not null,
  storage_path text not null,
  file_size bigint not null default 0 check (file_size >= 0),
  checksum text not null,
  mime_type text not null,
  is_bundled boolean not null default false,
  revision bigint not null default 0,
  sync_revision bigint not null default 0,
  sync_updated_at timestamptz not null default timezone('utc', now()),
  sync_device_id text,
  deleted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id),
  foreign key (workspace_id, unit_id) references public.curriculum_units(workspace_id, id) on delete set null
);

create unique index if not exists memoranda_files_workspace_unit_key_idx
  on public.memoranda_files(workspace_id, unit_key)
  where is_bundled = false and deleted_at is null and unit_key is not null;

create table if not exists public.sync_operations (
  workspace_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  operation_id text not null,
  applied_at timestamptz not null default timezone('utc', now()),
  primary key (workspace_id, operation_id),
  foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id) on delete cascade
);

create table if not exists public.sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null,
  entity_id uuid,
  local_revision bigint not null,
  remote_revision bigint not null,
  local_device_id text,
  remote_device_id text,
  resolution text not null default 'pending',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id)
);

create table if not exists public.sync_tombstones (
  workspace_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  deleted_at timestamptz not null default timezone('utc', now()),
  revision bigint not null default 0,
  device_id text,
  primary key (workspace_id, entity_type, entity_id),
  foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id)
);

-- 8. ربط Triggers التحديث والمراجعة بجميع الجداول
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'classes', 'students', 'grades', 'sessions', 'attendance',
    'session_behaviors', 'timetable_slots', 'curriculum_units',
    'custom_units', 'lesson_progress', 'lesson_plans', 'dashboard_tasks',
    'app_settings', 'memoranda_files'
  ] loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_updated_at', table_name);
    execute format('drop trigger if exists %I on public.%I', table_name || '_sync_revision', table_name);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.bump_revision()',
      table_name || '_sync_revision',
      table_name
    );
  end loop;

  execute 'drop trigger if exists profiles_updated_at on public.profiles';
  execute 'drop trigger if exists profiles_sync_updated_at on public.profiles';
  execute 'create trigger profiles_sync_updated_at before update on public.profiles for each row execute function public.set_profile_updated_at()';

  foreach table_name in array array['workspaces', 'sync_conflicts'] loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_updated_at', table_name);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      table_name || '_updated_at',
      table_name
    );
  end loop;
end
$$;

-- 9. تفعيل أمان الصفوف (Row Level Security) وسياسات المالك
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;

drop policy if exists profiles_owner_access on public.profiles;
create policy profiles_owner_access on public.profiles
  for all to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists workspaces_owner_access on public.workspaces;
create policy workspaces_owner_access on public.workspaces
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

do $$
declare
  t text;
begin
  foreach t in array array[
    'classes', 'students', 'grades', 'sessions', 'attendance',
    'session_behaviors', 'timetable_slots', 'curriculum_units',
    'custom_units', 'lesson_progress', 'lesson_plans', 'dashboard_tasks',
    'app_settings', 'memoranda_files', 'sync_operations', 'sync_conflicts',
    'sync_tombstones'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_access', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id)',
      t || '_owner_access',
      t
    );
  end loop;
end
$$;

-- 10. حاويات التخزين السحابي (Storage Buckets: memoranda & avatars)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('memoranda', 'memoranda', false, 10485760, array['application/pdf']::text[])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp']::text[])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "authenticated users read bundled or owned memoranda" on storage.objects;
create policy "authenticated users read bundled or owned memoranda" on storage.objects
for select to authenticated using (
  bucket_id = 'memoranda' and (
    name like 'bundled/%' or split_part(name, '/', 2) = (select auth.uid())::text
  )
);

drop policy if exists "users upload their memoranda" on storage.objects;
create policy "users upload their memoranda" on storage.objects
for insert to authenticated with check (
  bucket_id = 'memoranda' and split_part(name, '/', 1) = 'users' and split_part(name, '/', 2) = (select auth.uid())::text
);

drop policy if exists "users update their memoranda" on storage.objects;
create policy "users update their memoranda" on storage.objects
for update to authenticated using (
  bucket_id = 'memoranda' and split_part(name, '/', 1) = 'users' and split_part(name, '/', 2) = (select auth.uid())::text
) with check (
  bucket_id = 'memoranda' and split_part(name, '/', 1) = 'users' and split_part(name, '/', 2) = (select auth.uid())::text
);

drop policy if exists "users delete their memoranda" on storage.objects;
create policy "users delete their memoranda" on storage.objects
for delete to authenticated using (
  bucket_id = 'memoranda' and split_part(name, '/', 1) = 'users' and split_part(name, '/', 2) = (select auth.uid())::text
);

drop policy if exists "users read their avatar" on storage.objects;
create policy "users read their avatar" on storage.objects
for select to authenticated using (
  bucket_id = 'avatars' and split_part(name, '/', 1) = 'users' and split_part(name, '/', 2) = (select auth.uid())::text
);

drop policy if exists "users manage their avatar" on storage.objects;
create policy "users manage their avatar" on storage.objects
for all to authenticated using (
  bucket_id = 'avatars' and split_part(name, '/', 1) = 'users' and split_part(name, '/', 2) = (select auth.uid())::text
) with check (
  bucket_id = 'avatars' and split_part(name, '/', 1) = 'users' and split_part(name, '/', 2) = (select auth.uid())::text
);

-- 11. الدوال التناقلية الذرية (RPC Functions)
create or replace function public.claim_sync_operation(
  p_workspace_id uuid,
  p_owner_id uuid,
  p_operation_id text
) returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_owner_id <> auth.uid() then
    raise exception 'Operation owner mismatch';
  end if;
  if not exists (
    select 1 from public.workspaces
    where id = p_workspace_id and owner_id = auth.uid()
  ) then
    raise exception 'Workspace ownership mismatch';
  end if;

  insert into public.sync_operations(workspace_id, owner_id, operation_id)
  values (p_workspace_id, p_owner_id, p_operation_id)
  on conflict (workspace_id, operation_id) do nothing;
  return found;
end;
$$;

create or replace function public.import_roster_batch(
  p_classes jsonb,
  p_students jsonb
)
returns void
language plpgsql
set search_path = public
as $$
declare
  wid uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select id into wid from public.workspaces where owner_id = auth.uid();
  if wid is null then
    raise exception 'Workspace unavailable';
  end if;

  if (
    select count(*) from (
      select (c->>'id')::uuid as id
      from jsonb_array_elements(coalesce(p_classes, '[]'::jsonb)) as c
      group by (c->>'id')::uuid
      having count(*) > 1
    ) duplicate_classes
  ) > 0 then
    raise exception 'Duplicate class identifiers in roster import payload';
  end if;

  if (
    select count(*) from (
      select (s->>'id')::uuid as id
      from jsonb_array_elements(coalesce(p_students, '[]'::jsonb)) as s
      group by (s->>'id')::uuid
      having count(*) > 1
    ) duplicate_students
  ) > 0 then
    raise exception 'Duplicate student identifiers in roster import payload';
  end if;

  insert into public.classes (
    id, workspace_id, owner_id, name, level, section, weekly_hours, updated_by
  )
  select
    (c->>'id')::uuid,
    wid,
    auth.uid(),
    btrim(c->>'name'),
    c->>'level',
    coalesce(nullif(c->>'section', ''), nullif(c->>'stream', '')),
    coalesce((c->>'weeklyHours')::smallint, (c->>'weekly_hours')::smallint, case when c->>'level' = '1AS_SCIENCE' then 1 else 2 end),
    auth.uid()
  from jsonb_array_elements(coalesce(p_classes, '[]'::jsonb)) as c
  where c->>'name' is not null and btrim(c->>'name') <> ''
  on conflict (id) do update set
    name = excluded.name,
    level = excluded.level,
    section = excluded.section,
    weekly_hours = excluded.weekly_hours,
    updated_by = auth.uid();

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_students, '[]'::jsonb)) as elem
    left join public.classes c
      on c.workspace_id = wid
     and c.id = coalesce(nullif(elem->>'class_id', ''), nullif(elem->>'classId', ''))::uuid
     and c.owner_id = auth.uid()
    where (elem->>'id') is null
       or coalesce(nullif(elem->>'class_id', ''), nullif(elem->>'classId', '')) is null
       or c.id is null
       or coalesce(nullif(elem->>'full_name', ''), nullif(elem->>'fullName', '')) is null
       or btrim(coalesce(elem->>'full_name', elem->>'fullName', '')) = ''
       or coalesce(nullif(elem->>'number_in_list', ''), nullif(elem->>'numberInList', '')) is null
       or (coalesce(nullif(elem->>'number_in_list', ''), nullif(elem->>'numberInList', '')))::integer < 1
  ) then
    raise exception 'Invalid roster import payload';
  end if;

  insert into public.students (
    id, workspace_id, owner_id, class_id, full_name, number_in_list,
    reg_number, registration_number, gender, birth_date, is_repeater,
    guardian_phone, notes, updated_by
  )
  select
    (s->>'id')::uuid,
    wid,
    auth.uid(),
    coalesce(nullif(s->>'class_id', ''), nullif(s->>'classId', ''))::uuid,
    btrim(coalesce(s->>'full_name', s->>'fullName', '')),
    (coalesce(nullif(s->>'number_in_list', ''), nullif(elem_num.val, '1')))::integer,
    coalesce(nullif(s->>'reg_number', ''), nullif(s->>'regNumber', '')),
    coalesce(nullif(s->>'registration_number', ''), nullif(s->>'registrationNumber', ''), nullif(s->>'reg_number', ''), nullif(s->>'regNumber', '')),
    case
      when s->>'gender' in ('M', 'male') then 'male'
      when s->>'gender' in ('F', 'female') then 'female'
      else null
    end,
    case
      when coalesce(nullif(s->>'birth_date', ''), nullif(s->>'birthDate', '')) ~ '^\d{4}-\d{2}-\d{2}$'
      then (coalesce(nullif(s->>'birth_date', ''), nullif(s->>'birthDate', '')))::date
      else null
    end,
    coalesce((s->>'is_repeater')::boolean, (s->>'isRepeater')::boolean, false),
    coalesce(nullif(s->>'guardian_phone', ''), nullif(s->>'guardianPhone', '')),
    nullif(s->>'notes', ''),
    auth.uid()
  from jsonb_array_elements(coalesce(p_students, '[]'::jsonb)) as s
  cross join lateral (select coalesce(nullif(s->>'number_in_list', ''), nullif(s->>'numberInList', '')) as val) as elem_num
  on conflict (id) do update set
    class_id = excluded.class_id,
    full_name = excluded.full_name,
    number_in_list = excluded.number_in_list,
    reg_number = excluded.reg_number,
    registration_number = excluded.registration_number,
    gender = excluded.gender,
    birth_date = excluded.birth_date,
    is_repeater = excluded.is_repeater,
    guardian_phone = excluded.guardian_phone,
    notes = excluded.notes,
    updated_by = auth.uid();
end;
$$;

create or replace function public.clear_roster_data()
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  wid uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select id into wid from public.workspaces where owner_id = auth.uid();
  if wid is null then
    return;
  end if;

  delete from public.attendance where workspace_id = wid;
  delete from public.session_behaviors where workspace_id = wid;
  delete from public.sessions where workspace_id = wid;
  delete from public.grades where workspace_id = wid;
  delete from public.students where workspace_id = wid;
  delete from public.timetable_slots where workspace_id = wid;
  delete from public.lesson_progress where workspace_id = wid;
  delete from public.classes where workspace_id = wid;
  delete from public.sync_operations
    where workspace_id = wid
      and (
        operation_id like '%:class:%'
        or operation_id like '%:student:%'
        or operation_id like '%:grade:%'
        or operation_id like '%:session:%'
        or operation_id like '%:attendance:%'
        or operation_id like '%:behavior:%'
        or operation_id like '%:timetable:%'
        or operation_id like '%:lessonProgress:%'
      );
  delete from public.sync_tombstones
    where workspace_id = wid
      and entity_type in ('class', 'student', 'grade', 'session', 'attendance', 'behavior', 'timetable', 'lessonProgress');
end;
$$;

create or replace function public.reset_workspace()
returns void
language plpgsql
set search_path = public
as $$
declare
  wid uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  select id into wid from public.workspaces where owner_id = auth.uid();
  delete from storage.objects
    where bucket_id = 'memoranda'
      and name like 'users/' || (select auth.uid())::text || '/%';
  delete from public.attendance where workspace_id = wid;
  delete from public.session_behaviors where workspace_id = wid;
  delete from public.sessions where workspace_id = wid;
  delete from public.grades where workspace_id = wid;
  delete from public.students where workspace_id = wid;
  delete from public.timetable_slots where workspace_id = wid;
  delete from public.lesson_progress where workspace_id = wid;
  delete from public.lesson_plans where workspace_id = wid;
  delete from public.curriculum_units where workspace_id = wid;
  delete from public.custom_units where workspace_id = wid;
  delete from public.memoranda_files where workspace_id = wid;
  delete from public.dashboard_tasks where workspace_id = wid;
  delete from public.app_settings where workspace_id = wid;
  delete from public.sync_operations where workspace_id = wid;
  delete from public.sync_conflicts where workspace_id = wid;
  delete from public.sync_tombstones where workspace_id = wid;
  delete from public.classes where workspace_id = wid;
end
$$;

-- 12. الفهارس ومنح الصلاحيات وRealtime Publication
create index if not exists classes_owner_idx on public.classes(owner_id);
create index if not exists classes_workspace_owner_idx on public.classes(workspace_id, owner_id);
create index if not exists students_workspace_class_idx on public.students(workspace_id, class_id);
create index if not exists students_owner_idx on public.students(owner_id);
create index if not exists grades_workspace_class_idx on public.grades(workspace_id, class_id);
create index if not exists grades_owner_idx on public.grades(owner_id);
create index if not exists sessions_workspace_date_idx on public.sessions(workspace_id, session_date);
create index if not exists sessions_owner_idx on public.sessions(owner_id);
create index if not exists attendance_workspace_session_idx on public.attendance(workspace_id, session_id);
create index if not exists attendance_owner_idx on public.attendance(owner_id);
create index if not exists behaviors_workspace_session_idx on public.session_behaviors(workspace_id, session_id);
create index if not exists session_behaviors_owner_idx on public.session_behaviors(owner_id);
create index if not exists timetable_workspace_class_idx on public.timetable_slots(workspace_id, class_id);
create index if not exists timetable_slots_owner_idx on public.timetable_slots(owner_id);
create index if not exists progress_workspace_class_idx on public.lesson_progress(workspace_id, class_id);
create index if not exists lesson_progress_owner_idx on public.lesson_progress(owner_id);
create index if not exists plans_workspace_date_idx on public.lesson_plans(workspace_id, lesson_date);
create index if not exists lesson_plans_owner_idx on public.lesson_plans(owner_id);
create index if not exists custom_units_workspace_idx on public.custom_units(workspace_id, position);
create index if not exists custom_units_owner_idx on public.custom_units(owner_id);
create index if not exists dashboard_tasks_workspace_idx on public.dashboard_tasks(workspace_id, task_id);
create index if not exists dashboard_tasks_owner_idx on public.dashboard_tasks(owner_id);
create index if not exists memoranda_files_owner_idx on public.memoranda_files(owner_id);
create index if not exists app_settings_owner_idx on public.app_settings(owner_id);
create index if not exists sync_operations_owner_idx on public.sync_operations(owner_id);
create index if not exists sync_tombstones_owner_idx on public.sync_tombstones(owner_id);
create index if not exists sync_conflicts_owner_idx on public.sync_conflicts(owner_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on table
  public.profiles,
  public.workspaces,
  public.classes,
  public.students,
  public.grades,
  public.sessions,
  public.attendance,
  public.session_behaviors,
  public.timetable_slots,
  public.curriculum_units,
  public.custom_units,
  public.lesson_progress,
  public.lesson_plans,
  public.app_settings,
  public.memoranda_files,
  public.sync_conflicts,
  public.sync_tombstones,
  public.dashboard_tasks,
  public.sync_operations
to authenticated;

revoke execute on function public.claim_sync_operation(uuid, uuid, text) from public, anon;
grant execute on function public.claim_sync_operation(uuid, uuid, text) to authenticated;
revoke execute on function public.import_roster_batch(jsonb, jsonb) from public, anon;
grant execute on function public.import_roster_batch(jsonb, jsonb) to authenticated;
revoke execute on function public.clear_roster_data() from public, anon;
grant execute on function public.clear_roster_data() to authenticated;
revoke execute on function public.reset_workspace() from public, anon;
grant execute on function public.reset_workspace() to authenticated;

-- تفعيل REPLICA IDENTITY FULL وإدراج الجداول في supabase_realtime
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'app_settings', 'classes', 'students', 'grades', 'sessions',
    'attendance', 'session_behaviors', 'timetable_slots', 'custom_units',
    'lesson_progress', 'lesson_plans', 'dashboard_tasks', 'memoranda_files',
    'sync_tombstones'
  ] loop
    begin
      execute format('alter table public.%I replica identity full', table_name);
    exception when others then null;
    end;

    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = table_name
      ) then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end if;
  end loop;
end
$$;
