-- Clean Mueen Al-Ostad relational foundation. Experimental data may be discarded.
-- This is intentionally destructive: the experimental schema has no migration
-- compatibility contract and is replaced atomically by the new foundation.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user_profile();
drop view if exists public.teacher_settings cascade;
drop table if exists public.teacher_settings cascade;
drop table if exists public.file_assets cascade;
drop table if exists public.custom_units cascade;
drop table if exists public.memoranda_files cascade;
drop table if exists public.sync_tombstones cascade;
drop table if exists public.sync_conflicts cascade;
drop table if exists public.lesson_plans cascade;
drop table if exists public.lesson_progress cascade;
drop table if exists public.curriculum_units cascade;
drop table if exists public.timetable_slots cascade;
drop table if exists public.session_behaviors cascade;
drop table if exists public.attendance cascade;
drop table if exists public.sessions cascade;
drop table if exists public.grades cascade;
drop table if exists public.students cascade;
drop table if exists public.classes cascade;
drop table if exists public.app_settings cascade;
drop table if exists public.workspaces cascade;
drop table if exists public.profiles cascade;
drop function if exists public.reset_workspace();
drop function if exists public.upsert_grade(uuid, uuid, smallint, jsonb, bigint);
drop function if exists public.default_workspace_id();
drop function if exists public.bump_revision();
drop function if exists public.set_updated_at();
create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = timezone('utc', now()); return new; end $$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text, avatar_url text, school_name text, phone text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null default 'مساحة العمل' check (length(btrim(name)) > 0),
  unique (id, owner_id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.handle_new_user_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, avatar_url) values (new.id, nullif(new.raw_user_meta_data->>'full_name',''), nullif(new.raw_user_meta_data->>'avatar_url','')) on conflict (id) do nothing;
  insert into public.workspaces (owner_id) values (new.id) on conflict (owner_id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user_profile();
revoke execute on function public.handle_new_user_profile() from public, anon, authenticated;

create or replace function public.default_workspace_id()
returns uuid language sql stable security invoker set search_path = public as $$
  select id from public.workspaces where owner_id = auth.uid() limit 1
$$;
revoke all on function public.default_workspace_id() from public, anon;
grant execute on function public.default_workspace_id() to authenticated;

create table public.classes (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null default public.default_workspace_id(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0), level text, section text,
  weekly_hours smallint not null default 2 check (weekly_hours between 1 and 10), academic_year text, notes text,
  revision bigint not null default 0 check (revision >= 0), sync_revision bigint not null default 0, sync_updated_at timestamptz not null default timezone('utc', now()), sync_device_id text, updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()), updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, name, academic_year), unique (workspace_id, id), foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id) deferrable initially immediate
);

create table public.students (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null default public.default_workspace_id(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  class_id uuid not null, external_id text, full_name text not null check (length(btrim(full_name)) > 0),
  normalized_name text generated always as (lower(regexp_replace(btrim(full_name), '\\s+', ' ', 'g'))) stored,
  number_in_list integer not null check (number_in_list > 0), reg_number text, registration_number text,
  is_repeater boolean not null default false, guardian_phone text, gender text check (gender in ('male','female','other','unspecified')), birth_date date, notes text,
  revision bigint not null default 0 check (revision >= 0), sync_revision bigint not null default 0, sync_updated_at timestamptz not null default timezone('utc', now()), sync_device_id text, updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()), updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, class_id, number_in_list), unique (workspace_id, id), foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id), foreign key (workspace_id, class_id) references public.classes(workspace_id, id) on delete cascade
);

create table public.grades (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null default public.default_workspace_id(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  student_id uuid not null, class_id uuid not null, trimester smallint not null check (trimester between 1 and 3),
  continuous_eval numeric(5,2) check (continuous_eval between 0 and 20), behavior_score numeric(5,2) check (behavior_score between 0 and 5), attendance_score numeric(5,2) check (attendance_score between 0 and 5), notebook_score numeric(5,2) check (notebook_score between 0 and 5), participation_score numeric(5,2) check (participation_score between 0 and 5), quiz numeric(5,2) check (quiz between 0 and 20), exam numeric(5,2) check (exam between 0 and 20), calculated_average numeric(5,2) check (calculated_average between 0 and 20), estimation text, guidance text, remarks text, follow_up_notes text,
  revision bigint not null default 0 check (revision >= 0), sync_revision bigint not null default 0, sync_updated_at timestamptz not null default timezone('utc', now()), sync_device_id text, updated_by uuid default auth.uid() references auth.users(id) on delete set null, created_at timestamptz not null default timezone('utc', now()), updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, student_id, trimester), unique (workspace_id, id), foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id), foreign key (workspace_id, student_id) references public.students(workspace_id, id) on delete cascade, foreign key (workspace_id, class_id) references public.classes(workspace_id, id) on delete cascade
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null default public.default_workspace_id(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade, class_id uuid not null,
  session_date date not null, start_time time, end_time time, trimester smallint check (trimester between 1 and 3), topic text, teacher_notes text,
  revision bigint not null default 0 check (revision >= 0), updated_by uuid default auth.uid() references auth.users(id) on delete set null, created_at timestamptz not null default timezone('utc', now()), updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, class_id, session_date, start_time), unique (workspace_id, id), foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id), foreign key (workspace_id, class_id) references public.classes(workspace_id, id) on delete cascade, check (end_time is null or start_time is null or end_time > start_time)
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null default public.default_workspace_id(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade, session_id uuid not null, student_id uuid not null,
  status text not null default 'present' check (status in ('present','absent','late','excused')), note text, revision bigint not null default 0 check (revision >= 0), updated_by uuid default auth.uid() references auth.users(id) on delete set null, created_at timestamptz not null default timezone('utc', now()), updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, session_id, student_id), unique (workspace_id, id), foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id), foreign key (workspace_id, session_id) references public.sessions(workspace_id, id) on delete cascade, foreign key (workspace_id, student_id) references public.students(workspace_id, id) on delete cascade
);

create table public.session_behaviors (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null default public.default_workspace_id(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade, session_id uuid not null, student_id uuid not null, behavior text not null check (length(btrim(behavior)) > 0), rating smallint check (rating between 1 and 5), note text,
  revision bigint not null default 0 check (revision >= 0), updated_by uuid default auth.uid() references auth.users(id) on delete set null, created_at timestamptz not null default timezone('utc', now()), updated_at timestamptz not null default timezone('utc', now()), unique (workspace_id, id), foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id), foreign key (workspace_id, session_id) references public.sessions(workspace_id, id) on delete cascade, foreign key (workspace_id, student_id) references public.students(workspace_id, id) on delete cascade
);

create table public.timetable_slots (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null default public.default_workspace_id(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade, class_id uuid not null, weekday smallint not null check (weekday between 0 and 6), start_time time not null, end_time time not null, room text, notes text,
  revision bigint not null default 0 check (revision >= 0), updated_by uuid default auth.uid() references auth.users(id) on delete set null, created_at timestamptz not null default timezone('utc', now()), updated_at timestamptz not null default timezone('utc', now()), check (end_time > start_time), unique (workspace_id, class_id, weekday, start_time), unique (workspace_id, id), foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id), foreign key (workspace_id, class_id) references public.classes(workspace_id, id) on delete cascade
);

create table public.curriculum_units (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null default public.default_workspace_id(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade, title text not null check (length(btrim(title)) > 0), code text, level text, position integer not null default 0 check (position >= 0), description text, metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'), revision bigint not null default 0 check (revision >= 0), updated_by uuid default auth.uid() references auth.users(id) on delete set null, created_at timestamptz not null default timezone('utc', now()), updated_at timestamptz not null default timezone('utc', now()), unique (workspace_id, code), unique (workspace_id, id), foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id)
);

create table public.custom_units (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.default_workspace_id(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (length(btrim(title)) > 0),
  level text,
  position integer not null default 0 check (position >= 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  revision bigint not null default 0 check (revision >= 0),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, id),
  foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id)
);

create table public.lesson_progress (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null default public.default_workspace_id(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade, class_id uuid not null, unit_id uuid, unit_key text, status text not null default 'not_started' check (status in ('not_started','in_progress','completed')), completed_at timestamptz, notes text, revision bigint not null default 0 check (revision >= 0), updated_by uuid default auth.uid() references auth.users(id) on delete set null, created_at timestamptz not null default timezone('utc', now()), updated_at timestamptz not null default timezone('utc', now()), unique (workspace_id, class_id, unit_id), unique (workspace_id, class_id, unit_key), unique (workspace_id, id), foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id), foreign key (workspace_id, class_id) references public.classes(workspace_id, id) on delete cascade, foreign key (workspace_id, unit_id) references public.curriculum_units(workspace_id, id) on delete cascade, check (unit_id is not null or unit_key is not null)
);

create table public.lesson_plans (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null default public.default_workspace_id(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade, class_id uuid, unit_id uuid, title text not null check (length(btrim(title)) > 0), content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'), lesson_date date, revision bigint not null default 0 check (revision >= 0), updated_by uuid default auth.uid() references auth.users(id) on delete set null, created_at timestamptz not null default timezone('utc', now()), updated_at timestamptz not null default timezone('utc', now()), unique (workspace_id, id), foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id), foreign key (workspace_id, class_id) references public.classes(workspace_id, id) on delete set null, foreign key (workspace_id, unit_id) references public.curriculum_units(workspace_id, id) on delete set null
);

create table public.app_settings (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null default public.default_workspace_id(), owner_id uuid not null references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'), revision bigint not null default 0 check (revision >= 0), updated_by uuid default auth.uid() references auth.users(id) on delete set null, updated_by_device text,
  created_at timestamptz not null default timezone('utc', now()), updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id), unique (workspace_id, id), foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id)
);

-- Canonical domain name for settings; the compatibility table remains writable by the current client.

create table public.memoranda_files (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null default public.default_workspace_id(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade, unit_id uuid, unit_key text, file_name text not null, storage_path text not null, file_size bigint not null default 0 check (file_size >= 0), checksum text not null, mime_type text not null, is_bundled boolean not null default false, revision bigint not null default 0, deleted_at timestamptz, created_at timestamptz not null default timezone('utc', now()), updated_at timestamptz not null default timezone('utc', now()), unique (workspace_id, id), foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id), foreign key (workspace_id, unit_id) references public.curriculum_units(workspace_id, id) on delete set null
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('memoranda', 'memoranda', false, 10485760, array['application/pdf']::text[])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table public.sync_conflicts (id uuid primary key default gen_random_uuid(), workspace_id uuid not null, owner_id uuid not null references auth.users(id) on delete cascade, entity_type text not null, entity_id uuid, local_revision bigint not null, remote_revision bigint not null, local_device_id text, remote_device_id text, resolution text not null default 'last-write-wins', created_at timestamptz not null default timezone('utc', now()), foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id));
create table public.sync_tombstones (workspace_id uuid not null, owner_id uuid not null references auth.users(id) on delete cascade, entity_type text not null, entity_id uuid not null, deleted_at timestamptz not null default timezone('utc', now()), revision bigint not null default 0, device_id text, primary key (workspace_id, entity_type, entity_id), foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id));

create or replace function public.bump_revision()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = timezone('utc', now()); new.revision = old.revision + 1; new.updated_by = coalesce(auth.uid(), new.updated_by); return new; end $$;

do $$ declare t text; begin foreach t in array array['classes','students','grades','sessions','attendance','session_behaviors','timetable_slots','curriculum_units','lesson_progress','lesson_plans','app_settings'] loop execute format('create trigger %I before update on public.%I for each row execute function public.bump_revision()', t||'_updated_at', t); end loop; foreach t in array array['profiles','workspaces','memoranda_files','sync_conflicts'] loop execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t||'_updated_at', t); end loop; end $$;

create index students_workspace_class_idx on public.students(workspace_id, class_id);
create index grades_workspace_class_idx on public.grades(workspace_id, class_id);
create index sessions_workspace_date_idx on public.sessions(workspace_id, session_date);
create index attendance_workspace_session_idx on public.attendance(workspace_id, session_id);
create index behaviors_workspace_session_idx on public.session_behaviors(workspace_id, session_id);
create index timetable_workspace_class_idx on public.timetable_slots(workspace_id, class_id);
create index progress_workspace_class_idx on public.lesson_progress(workspace_id, class_id);
create index plans_workspace_date_idx on public.lesson_plans(workspace_id, lesson_date);
create index custom_units_workspace_idx on public.custom_units(workspace_id, position);

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
do $$ declare t text; begin foreach t in array array['classes','students','grades','sessions','attendance','session_behaviors','timetable_slots','curriculum_units','custom_units','lesson_progress','lesson_plans','app_settings','memoranda_files','sync_conflicts','sync_tombstones'] loop execute format('alter table public.%I enable row level security', t); execute format('create policy %I on public.%I for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id)', t||'_owner_access', t); end loop; end $$;
create policy profiles_owner_access on public.profiles for all to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy workspaces_owner_access on public.workspaces for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

create index classes_owner_idx on public.classes(owner_id);
create index students_class_idx on public.students(class_id);
create index lesson_progress_class_idx on public.lesson_progress(class_id);

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

create or replace function public.upsert_grade(p_student_id uuid, p_class_id uuid, p_trimester smallint, p_values jsonb, p_revision bigint default null)
returns public.grades language plpgsql set search_path = public as $$
declare result public.grades; wid uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select workspace_id into wid from public.workspaces where owner_id = auth.uid();
  insert into public.grades(workspace_id, owner_id, student_id, class_id, trimester, continuous_eval, behavior_score, attendance_score, notebook_score, participation_score, quiz, exam, calculated_average, estimation, guidance, remarks, follow_up_notes, revision)
  values (wid, auth.uid(), p_student_id, p_class_id, p_trimester, (p_values->>'continuous_eval')::numeric, (p_values->>'behavior_score')::numeric, (p_values->>'attendance_score')::numeric, (p_values->>'notebook_score')::numeric, (p_values->>'participation_score')::numeric, (p_values->>'quiz')::numeric, (p_values->>'exam')::numeric, (p_values->>'calculated_average')::numeric, p_values->>'estimation', p_values->>'guidance', p_values->>'remarks', p_values->>'follow_up_notes', coalesce(p_revision,0))
  on conflict (workspace_id, student_id, trimester) do update set class_id=excluded.class_id, continuous_eval=excluded.continuous_eval, behavior_score=excluded.behavior_score, attendance_score=excluded.attendance_score, notebook_score=excluded.notebook_score, participation_score=excluded.participation_score, quiz=excluded.quiz, exam=excluded.exam, calculated_average=excluded.calculated_average, estimation=excluded.estimation, guidance=excluded.guidance, remarks=excluded.remarks, follow_up_notes=excluded.follow_up_notes where p_revision is null or public.grades.revision <= p_revision returning * into result;
  if result.id is null then raise exception 'Stale grade revision'; end if; return result;
end $$;

create or replace function public.reset_workspace()
returns void language plpgsql set search_path = public as $$
declare wid uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select id into wid from public.workspaces where owner_id = auth.uid();
  delete from storage.objects
    where bucket_id = 'memoranda'
      and name like 'users/' || (select auth.uid())::text || '/%';
  delete from public.attendance where workspace_id=wid; delete from public.session_behaviors where workspace_id=wid; delete from public.sessions where workspace_id=wid; delete from public.grades where workspace_id=wid; delete from public.students where workspace_id=wid; delete from public.timetable_slots where workspace_id=wid;   delete from public.lesson_progress where workspace_id=wid; delete from public.lesson_plans where workspace_id=wid; delete from public.curriculum_units where workspace_id=wid; delete from public.custom_units where workspace_id=wid; delete from public.memoranda_files where workspace_id=wid; delete from public.app_settings where workspace_id=wid; delete from public.sync_conflicts where workspace_id=wid; delete from public.sync_tombstones where workspace_id=wid; delete from public.classes where workspace_id=wid;
end $$;
revoke execute on function public.reset_workspace() from public, anon; grant execute on function public.reset_workspace() to authenticated;
revoke execute on function public.upsert_grade(uuid,uuid,smallint,jsonb,bigint) from public, anon; grant execute on function public.upsert_grade(uuid,uuid,smallint,jsonb,bigint) to authenticated;
