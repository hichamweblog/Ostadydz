create or replace function public.reset_workspace()
returns void
language plpgsql
set search_path = public, storage
as $$
declare
  wid uuid;
  uid text := (select auth.uid())::text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select id into wid from public.workspaces where owner_id = auth.uid();
  delete from storage.objects
    where bucket_id in ('memoranda', 'avatars')
      and name like 'users/' || uid || '/%';
  delete from public.sync_operations where workspace_id = wid;
  delete from public.dashboard_tasks where workspace_id = wid;
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
  delete from public.app_settings where workspace_id = wid;
  delete from public.sync_conflicts where workspace_id = wid;
  delete from public.sync_tombstones where workspace_id = wid;
  delete from public.classes where workspace_id = wid;
end
$$;

revoke execute on function public.reset_workspace() from public, anon;
grant execute on function public.reset_workspace() to authenticated;
