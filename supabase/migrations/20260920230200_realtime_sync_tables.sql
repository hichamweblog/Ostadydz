-- Keep every user-owned synchronization surface available to the Realtime channel.
do $$ declare table_name text;
begin
  foreach table_name in array array[
    'profiles', 'app_settings', 'classes', 'students', 'grades', 'sessions',
    'attendance', 'session_behaviors', 'timetable_slots', 'custom_units',
    'lesson_progress', 'lesson_plans', 'dashboard_tasks', 'memoranda_files'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    exception when duplicate_object then
      null;
    end;
  end loop;
end $$;
