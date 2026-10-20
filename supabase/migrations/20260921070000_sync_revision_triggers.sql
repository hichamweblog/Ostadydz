-- Keep server-side writes on the same revision clock as client outbox writes.
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

do $$
declare
  table_name text;
begin
  execute 'drop trigger if exists dashboard_tasks_updated_at on public.dashboard_tasks';
  foreach table_name in array array[
    'classes', 'students', 'grades', 'sessions', 'attendance',
    'session_behaviors', 'timetable_slots', 'curriculum_units',
    'custom_units', 'lesson_progress', 'lesson_plans', 'dashboard_tasks', 'app_settings',
    'memoranda_files'
  ] loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_sync_revision', table_name);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.bump_revision()',
      table_name || '_sync_revision',
      table_name
    );
  end loop;

  execute 'drop trigger if exists profiles_sync_updated_at on public.profiles';
  execute 'create trigger profiles_sync_updated_at before update on public.profiles for each row execute function public.set_profile_updated_at()';
end
$$;
