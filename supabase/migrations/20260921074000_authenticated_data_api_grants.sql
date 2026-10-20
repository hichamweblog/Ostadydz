-- RLS remains the authorization boundary; these grants expose the tables to
-- PostgREST so authenticated clients can reach the owner policies.
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

grant execute on function public.default_workspace_id() to authenticated;
grant execute on function public.import_roster_batch(jsonb, jsonb) to authenticated;
grant execute on function public.claim_sync_operation(uuid, uuid, text) to authenticated;
grant execute on function public.reset_workspace() to authenticated;
