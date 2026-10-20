-- Performance Optimization: Covering Indexes for Unindexed Foreign Keys
--
-- Why this migration exists
-- -------------------------
-- Supabase Performance Advisor flags unindexed foreign keys (rule: unindexed_foreign_keys).
-- In high-density tables (specifically `grades` and `attendance` which scale into tens of thousands of rows,
-- along with `session_behaviors`, `students`, and `sessions`), foreign keys referencing `auth.users(id)`
-- or `workspaces(id, owner_id)` without a leading indexed column trigger:
--   1. Full table sequential scans whenever an auth user or workspace is updated or deleted (ON DELETE CASCADE).
--   2. Slower RLS evaluations when filtering strictly by `owner_id = auth.uid()` without `workspace_id`.
--   3. Suboptimal joins and locks during concurrent writes and cascade propagation.
--
-- While composite indexes on `(workspace_id, owner_id)` were previously added for some tables,
-- B-tree indexes with `workspace_id` as the leading column cannot be used by Postgres for foreign key
-- constraints that reference `owner_id` alone. Furthermore, high-volume tables like `attendance` and
-- `session_behaviors` lacked owner indexes entirely.
--
-- This migration adds covering indexes on `owner_id` and missing composite/foreign key references
-- across all user-scoped tables, ensuring ultra-fast queries and O(log N) cascade performance at scale.

-- 1. High-Density Tables: Grades, Attendance, and Session Behaviors
create index if not exists grades_owner_idx on public.grades(owner_id);
create index if not exists grades_updated_by_idx on public.grades(updated_by);

create index if not exists attendance_owner_idx on public.attendance(owner_id);
create index if not exists attendance_workspace_owner_idx on public.attendance(workspace_id, owner_id);
create index if not exists attendance_updated_by_idx on public.attendance(updated_by);

create index if not exists session_behaviors_owner_idx on public.session_behaviors(owner_id);
create index if not exists session_behaviors_workspace_owner_idx on public.session_behaviors(workspace_id, owner_id);
create index if not exists session_behaviors_updated_by_idx on public.session_behaviors(updated_by);

-- 2. Roster and Session Core Tables
create index if not exists students_owner_idx on public.students(owner_id);
create index if not exists students_updated_by_idx on public.students(updated_by);

create index if not exists sessions_owner_idx on public.sessions(owner_id);
create index if not exists sessions_updated_by_idx on public.sessions(updated_by);

create index if not exists classes_owner_idx on public.classes(owner_id);
create index if not exists classes_updated_by_idx on public.classes(updated_by);

create index if not exists timetable_slots_owner_idx on public.timetable_slots(owner_id);
create index if not exists timetable_slots_updated_by_idx on public.timetable_slots(updated_by);

-- 3. Curriculum, Plans & Progress Tables
create index if not exists lesson_progress_owner_idx on public.lesson_progress(owner_id);
create index if not exists lesson_progress_workspace_owner_idx on public.lesson_progress(workspace_id, owner_id);
create index if not exists lesson_progress_updated_by_idx on public.lesson_progress(updated_by);

create index if not exists lesson_plans_owner_idx on public.lesson_plans(owner_id);
create index if not exists lesson_plans_workspace_owner_idx on public.lesson_plans(workspace_id, owner_id);
create index if not exists lesson_plans_workspace_class_idx on public.lesson_plans(workspace_id, class_id);
create index if not exists lesson_plans_updated_by_idx on public.lesson_plans(updated_by);

create index if not exists custom_units_owner_idx on public.custom_units(owner_id);
create index if not exists custom_units_workspace_owner_idx on public.custom_units(workspace_id, owner_id);
create index if not exists custom_units_updated_by_idx on public.custom_units(updated_by);

create index if not exists curriculum_units_owner_idx on public.curriculum_units(owner_id);
create index if not exists curriculum_units_workspace_owner_idx on public.curriculum_units(workspace_id, owner_id);
create index if not exists curriculum_units_updated_by_idx on public.curriculum_units(updated_by);

-- 4. Assets, Settings, and Sync Internal Tables
create index if not exists memoranda_files_owner_idx on public.memoranda_files(owner_id);
create index if not exists memoranda_files_workspace_owner_idx on public.memoranda_files(workspace_id, owner_id);

create index if not exists app_settings_owner_idx on public.app_settings(owner_id);
create index if not exists app_settings_workspace_owner_idx on public.app_settings(workspace_id, owner_id);
create index if not exists app_settings_updated_by_idx on public.app_settings(updated_by);

create index if not exists sync_tombstones_owner_idx on public.sync_tombstones(owner_id);
create index if not exists sync_tombstones_workspace_owner_idx on public.sync_tombstones(workspace_id, owner_id);

create index if not exists sync_conflicts_owner_idx on public.sync_conflicts(owner_id);
create index if not exists sync_conflicts_workspace_owner_idx on public.sync_conflicts(workspace_id, owner_id);
