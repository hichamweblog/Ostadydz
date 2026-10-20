create or replace function public.clear_roster_data()
returns void
language plpgsql
security definer
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
  delete from public.sync_operations where workspace_id = wid;
  delete from public.sync_tombstones where workspace_id = wid and entity_type in ('class', 'student', 'grade', 'session', 'attendance', 'behavior', 'timetable', 'lessonProgress');
end;
$$;

revoke execute on function public.clear_roster_data() from public, anon;
grant execute on function public.clear_roster_data() to authenticated;
