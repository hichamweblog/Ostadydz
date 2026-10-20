-- Security and Performance Hardening Migration
-- 1. Security: Revoke execute privilege on rls_auto_enable() from public, anon, authenticated
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
-- Security: Switch clear_roster_data() to SECURITY INVOKER to run under caller permissions and satisfy security lint
ALTER FUNCTION public.clear_roster_data() SECURITY INVOKER;

-- 2. Performance: Add covering indexes for all foreign key references across user-scoped tables
CREATE INDEX IF NOT EXISTS grades_owner_idx ON public.grades(owner_id);
CREATE INDEX IF NOT EXISTS grades_updated_by_idx ON public.grades(updated_by);
CREATE INDEX IF NOT EXISTS grades_workspace_class_idx ON public.grades(workspace_id, class_id);

CREATE INDEX IF NOT EXISTS attendance_owner_idx ON public.attendance(owner_id);
CREATE INDEX IF NOT EXISTS attendance_workspace_owner_idx ON public.attendance(workspace_id, owner_id);
CREATE INDEX IF NOT EXISTS attendance_updated_by_idx ON public.attendance(updated_by);

CREATE INDEX IF NOT EXISTS session_behaviors_owner_idx ON public.session_behaviors(owner_id);
CREATE INDEX IF NOT EXISTS session_behaviors_workspace_owner_idx ON public.session_behaviors(workspace_id, owner_id);
CREATE INDEX IF NOT EXISTS session_behaviors_updated_by_idx ON public.session_behaviors(updated_by);

CREATE INDEX IF NOT EXISTS students_owner_idx ON public.students(owner_id);
CREATE INDEX IF NOT EXISTS students_updated_by_idx ON public.students(updated_by);

CREATE INDEX IF NOT EXISTS sessions_owner_idx ON public.sessions(owner_id);
CREATE INDEX IF NOT EXISTS sessions_updated_by_idx ON public.sessions(updated_by);

CREATE INDEX IF NOT EXISTS classes_owner_idx ON public.classes(owner_id);
CREATE INDEX IF NOT EXISTS classes_updated_by_idx ON public.classes(updated_by);

CREATE INDEX IF NOT EXISTS timetable_slots_owner_idx ON public.timetable_slots(owner_id);
CREATE INDEX IF NOT EXISTS timetable_slots_updated_by_idx ON public.timetable_slots(updated_by);

CREATE INDEX IF NOT EXISTS lesson_progress_owner_idx ON public.lesson_progress(owner_id);
CREATE INDEX IF NOT EXISTS lesson_progress_workspace_owner_idx ON public.lesson_progress(workspace_id, owner_id);
CREATE INDEX IF NOT EXISTS lesson_progress_updated_by_idx ON public.lesson_progress(updated_by);

CREATE INDEX IF NOT EXISTS lesson_plans_owner_idx ON public.lesson_plans(owner_id);
CREATE INDEX IF NOT EXISTS lesson_plans_workspace_owner_idx ON public.lesson_plans(workspace_id, owner_id);
CREATE INDEX IF NOT EXISTS lesson_plans_workspace_class_idx ON public.lesson_plans(workspace_id, class_id);
CREATE INDEX IF NOT EXISTS lesson_plans_updated_by_idx ON public.lesson_plans(updated_by);

CREATE INDEX IF NOT EXISTS custom_units_owner_idx ON public.custom_units(owner_id);
CREATE INDEX IF NOT EXISTS custom_units_workspace_owner_idx ON public.custom_units(workspace_id, owner_id);
CREATE INDEX IF NOT EXISTS custom_units_updated_by_idx ON public.custom_units(updated_by);

CREATE INDEX IF NOT EXISTS curriculum_units_owner_idx ON public.curriculum_units(owner_id);
CREATE INDEX IF NOT EXISTS curriculum_units_workspace_owner_idx ON public.curriculum_units(workspace_id, owner_id);
CREATE INDEX IF NOT EXISTS curriculum_units_updated_by_idx ON public.curriculum_units(updated_by);

CREATE INDEX IF NOT EXISTS memoranda_files_owner_idx ON public.memoranda_files(owner_id);
CREATE INDEX IF NOT EXISTS memoranda_files_workspace_owner_idx ON public.memoranda_files(workspace_id, owner_id);

CREATE INDEX IF NOT EXISTS app_settings_owner_idx ON public.app_settings(owner_id);
CREATE INDEX IF NOT EXISTS app_settings_workspace_owner_idx ON public.app_settings(workspace_id, owner_id);
CREATE INDEX IF NOT EXISTS app_settings_updated_by_idx ON public.app_settings(updated_by);

CREATE INDEX IF NOT EXISTS sync_tombstones_owner_idx ON public.sync_tombstones(owner_id);
CREATE INDEX IF NOT EXISTS sync_tombstones_workspace_owner_idx ON public.sync_tombstones(workspace_id, owner_id);

CREATE INDEX IF NOT EXISTS sync_conflicts_owner_idx ON public.sync_conflicts(owner_id);
CREATE INDEX IF NOT EXISTS sync_conflicts_workspace_owner_idx ON public.sync_conflicts(workspace_id, owner_id);
