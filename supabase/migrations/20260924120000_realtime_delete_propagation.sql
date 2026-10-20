-- Phase 2: make Realtime DELETE propagation trustworthy.
--
-- Why this migration exists
-- -------------------------
-- Realtime evaluates a `filter` (e.g. `owner_id=eq.<uid>`) against the record it is about
-- to broadcast. By default a table's replica identity only carries the primary key, so for
-- DELETE and UPDATE the old record contains just the key columns: an `owner_id` filter can
-- never match and the client is never told that a row disappeared. That is exactly how a
-- record deleted on one device kept living on another until the next full page load
-- (see SYNC-REVIEW.md, finding 3.4).
--
-- `replica identity full` makes the whole old row available, which lets:
--   1. the `owner_id=eq.<uid>` filter match on DELETE, and
--   2. this client recognise its own deletes (`device_id` / `sync_device_id`) and stay quiet.
--
-- Cost: WAL volume grows for these tables (the full old row is logged on every update and
-- delete). They are small, user-scoped rows, so this is acceptable and is the documented
-- prerequisite for filtered DELETE events.
--
-- Note on authorization: Postgres RLS is not evaluated for DELETE events (the row no longer
-- exists to be checked), so the subscription filter is what scopes the stream. Filters are
-- applied server-side before broadcasting, and every row on these tables carries owner_id.

do $$ declare table_name text;
begin
  foreach table_name in array array[
    'profiles', 'app_settings', 'classes', 'students', 'grades', 'sessions',
    'attendance', 'session_behaviors', 'timetable_slots', 'custom_units',
    'lesson_progress', 'lesson_plans', 'dashboard_tasks', 'memoranda_files',
    'sync_tombstones'
  ] loop
    begin
      execute format('alter table public.%I replica identity full', table_name);
    exception
      when undefined_table then null;      -- table not deployed in this environment
      when insufficient_privilege then null; -- managed role without ownership
    end;
  end loop;
end $$;

-- Keep sync_tombstones on the Realtime publication (idempotent; also added by
-- 20260923203000_audit_fixes_and_ledger.sql). Tombstone INSERTs are what let every other
-- open tab drop a deleted record immediately instead of waiting for its next cold load.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'sync_tombstones'
    ) then
      alter publication supabase_realtime add table public.sync_tombstones;
    end if;
  end if;
end $$;
