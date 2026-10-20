-- Every row-level synchronized table must carry the same conflict metadata.
do $$ declare table_name text;
begin
  foreach table_name in array array[
    'sessions', 'attendance', 'session_behaviors', 'timetable_slots',
    'curriculum_units', 'custom_units', 'lesson_progress', 'lesson_plans',
    'dashboard_tasks', 'profiles', 'app_settings', 'memoranda_files'
  ] loop
    execute format('alter table public.%I add column if not exists sync_revision bigint not null default 0', table_name);
    execute format('alter table public.%I add column if not exists sync_updated_at timestamptz not null default timezone(''utc'', now())', table_name);
    execute format('alter table public.%I add column if not exists sync_device_id text', table_name);
  end loop;
end $$;

alter table public.memoranda_files add column if not exists unit_key text;
create unique index if not exists memoranda_files_workspace_unit_key_idx
  on public.memoranda_files(workspace_id, unit_key)
  where is_bundled = false and deleted_at is null and unit_key is not null;
