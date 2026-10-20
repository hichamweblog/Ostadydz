-- Phase 3 / §5.13: a diagnostics view to answer "did the two devices diverge?" without
-- touching the client or the dashboard SQL editor every time.
--
-- The teacher's app reports a revision clock; the server has its own counters. When they
-- disagree, something did not propagate, and until now the only tool was a manual query.
--
-- `security_invoker = true` is essential: a Postgres view otherwise runs with the owner's
-- rights and would bypass the RLS policies on every underlying table, exposing one teacher's
-- counts to another. With invoker rights, each caller aggregates only their own rows.
--
-- Two counters are reported where the table has both:
--   revision       — bumped by a database trigger on every write (internal)
--   sync_revision  — the client-coordinated sync clock
-- A client that says "I am at revision 42" can be compared against max_sync_revision here.
--
-- Usage:
--   select * from public.sync_health order by entity;

create or replace view public.sync_health
with (security_invoker = true) as
  select 'classes'::text       as entity, count(*)::bigint as rows, coalesce(max(revision), 0) as max_revision, coalesce(max(sync_revision), 0) as max_sync_revision from public.classes
  union all
  select 'students',        count(*), coalesce(max(revision), 0), coalesce(max(sync_revision), 0) from public.students
  union all
  select 'grades',          count(*), coalesce(max(revision), 0), coalesce(max(sync_revision), 0) from public.grades
  union all
  select 'sessions',        count(*), coalesce(max(revision), 0), null from public.sessions
  union all
  select 'attendance',      count(*), coalesce(max(revision), 0), null from public.attendance
  union all
  select 'session_behaviors', count(*), coalesce(max(revision), 0), null from public.session_behaviors
  union all
  select 'timetable_slots', count(*), coalesce(max(revision), 0), null from public.timetable_slots
  union all
  select 'custom_units',    count(*), coalesce(max(revision), 0), null from public.custom_units
  union all
  select 'lesson_progress', count(*), coalesce(max(revision), 0), null from public.lesson_progress
  union all
  select 'lesson_plans',    count(*), coalesce(max(revision), 0), null from public.lesson_plans
  union all
  select 'app_settings',    count(*), coalesce(max(revision), 0), null from public.app_settings
  union all
  select 'memoranda_files', count(*), coalesce(max(revision), 0), null from public.memoranda_files
  union all
  select 'dashboard_tasks', count(*), coalesce(max(revision), 0), null from public.dashboard_tasks
  union all
  select 'sync_conflicts',  count(*), 0::bigint, null from public.sync_conflicts
  union all
  -- Per-entity deletion counts: a tombstone that never reached a device is exactly the
  -- "record came back" bug, and this is where it becomes visible.
  select 'tombstones:' || entity_type, count(*), coalesce(max(revision), 0), null
  from public.sync_tombstones
  group by entity_type;

comment on view public.sync_health is
  'Per-entity row, revision and tombstone counts for the calling teacher (RLS-scoped). '
  'Compares the client revision clock with the server counters to diagnose sync divergence.';

grant select on public.sync_health to authenticated;
revoke all on public.sync_health from anon;
