-- Migration: 20260923203000_audit_fixes_and_ledger.sql
-- Production review audit fixes: composite FKs, claim_sync_operation hardening,
-- upsert_grade fix, resilient roster import, scoped roster reset, realtime tombstones, and FK indexes.

-- 1. Fix upsert_grade workspace column lookup bug (was 'workspace_id', correct is 'id')
create or replace function public.upsert_grade(
  p_student_id uuid,
  p_class_id uuid,
  p_trimester smallint,
  p_values jsonb,
  p_revision bigint default null
)
returns public.grades language plpgsql set search_path = public as $$
declare
  result public.grades;
  wid uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select id into wid from public.workspaces where owner_id = auth.uid();
  if wid is null then
    raise exception 'Workspace unavailable';
  end if;

  insert into public.grades(
    workspace_id, owner_id, student_id, class_id, trimester,
    continuous_eval, behavior_score, attendance_score, notebook_score,
    participation_score, quiz, exam, calculated_average,
    estimation, guidance, remarks, follow_up_notes, revision
  )
  values (
    wid, auth.uid(), p_student_id, p_class_id, p_trimester,
    (p_values->>'continuous_eval')::numeric,
    (p_values->>'behavior_score')::numeric,
    (p_values->>'attendance_score')::numeric,
    (p_values->>'notebook_score')::numeric,
    (p_values->>'participation_score')::numeric,
    (p_values->>'quiz')::numeric,
    (p_values->>'exam')::numeric,
    (p_values->>'calculated_average')::numeric,
    p_values->>'estimation',
    p_values->>'guidance',
    p_values->>'remarks',
    p_values->>'follow_up_notes',
    coalesce(p_revision, 0)
  )
  on conflict (workspace_id, student_id, trimester) do update set
    class_id = excluded.class_id,
    continuous_eval = excluded.continuous_eval,
    behavior_score = excluded.behavior_score,
    attendance_score = excluded.attendance_score,
    notebook_score = excluded.notebook_score,
    participation_score = excluded.participation_score,
    quiz = excluded.quiz,
    exam = excluded.exam,
    calculated_average = excluded.calculated_average,
    estimation = excluded.estimation,
    guidance = excluded.guidance,
    remarks = excluded.remarks,
    follow_up_notes = excluded.follow_up_notes
  where p_revision is null or public.grades.revision <= p_revision
  returning * into result;

  if result.id is null then
    raise exception 'Stale grade revision';
  end if;
  return result;
end;
$$;

-- 2. Enforce composite foreign keys on dashboard_tasks and sync_operations
do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'dashboard_tasks_workspace_id_fkey'
      and table_name = 'dashboard_tasks'
  ) then
    alter table public.dashboard_tasks drop constraint dashboard_tasks_workspace_id_fkey;
  end if;

  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'dashboard_tasks_workspace_owner_fkey'
      and table_name = 'dashboard_tasks'
  ) then
    alter table public.dashboard_tasks
      add constraint dashboard_tasks_workspace_owner_fkey
      foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id) on delete cascade;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'sync_operations_workspace_id_fkey'
      and table_name = 'sync_operations'
  ) then
    alter table public.sync_operations drop constraint sync_operations_workspace_id_fkey;
  end if;

  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'sync_operations_workspace_owner_fkey'
      and table_name = 'sync_operations'
  ) then
    alter table public.sync_operations
      add constraint sync_operations_workspace_owner_fkey
      foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id) on delete cascade;
  end if;
end $$;

-- 3. Harden claim_sync_operation with workspace ownership verification
create or replace function public.claim_sync_operation(
  p_workspace_id uuid,
  p_owner_id uuid,
  p_operation_id text
) returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_owner_id <> auth.uid() then
    raise exception 'Operation owner mismatch';
  end if;
  if not exists (
    select 1 from public.workspaces
    where id = p_workspace_id and owner_id = auth.uid()
  ) then
    raise exception 'Workspace ownership mismatch';
  end if;

  insert into public.sync_operations(workspace_id, owner_id, operation_id)
  values (p_workspace_id, p_owner_id, p_operation_id)
  on conflict (workspace_id, operation_id) do nothing;
  return found;
end;
$$;

revoke execute on function public.claim_sync_operation(uuid, uuid, text) from public, anon;
grant execute on function public.claim_sync_operation(uuid, uuid, text) to authenticated;

-- 4. Re-declare authoritative import_roster_batch
create or replace function public.import_roster_batch(
  p_classes jsonb,
  p_students jsonb
)
returns void
language plpgsql
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
    raise exception 'Workspace unavailable';
  end if;

  -- Validate classes payload
  if (
    select count(*) from (
      select (c->>'id')::uuid as id
      from jsonb_array_elements(coalesce(p_classes, '[]'::jsonb)) as c
      group by (c->>'id')::uuid
      having count(*) > 1
    ) duplicate_classes
  ) > 0 then
    raise exception 'Duplicate class identifiers in roster import payload';
  end if;

  -- Validate students payload
  if (
    select count(*) from (
      select (s->>'id')::uuid as id
      from jsonb_array_elements(coalesce(p_students, '[]'::jsonb)) as s
      group by (s->>'id')::uuid
      having count(*) > 1
    ) duplicate_students
  ) > 0 then
    raise exception 'Duplicate student identifiers in roster import payload';
  end if;

  -- Upsert classes
  insert into public.classes (
    id, workspace_id, owner_id, name, level, section, weekly_hours, updated_by
  )
  select
    (c->>'id')::uuid,
    wid,
    auth.uid(),
    btrim(c->>'name'),
    c->>'level',
    coalesce(nullif(c->>'section', ''), nullif(c->>'stream', '')),
    case when c->>'level' = '1AS_SCIENCE' then 1 else 2 end,
    auth.uid()
  from jsonb_array_elements(coalesce(p_classes, '[]'::jsonb)) as c
  where c->>'name' is not null and btrim(c->>'name') <> ''
  on conflict (id) do update set
    name = excluded.name,
    level = excluded.level,
    section = excluded.section,
    weekly_hours = excluded.weekly_hours,
    updated_by = auth.uid();

  -- Check for invalid students (supporting both camelCase and snake_case)
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_students, '[]'::jsonb)) as elem
    left join public.classes c
      on c.workspace_id = wid
     and c.id = coalesce(nullif(elem->>'class_id', ''), nullif(elem->>'classId', ''))::uuid
     and c.owner_id = auth.uid()
    where (elem->>'id') is null
       or coalesce(nullif(elem->>'class_id', ''), nullif(elem->>'classId', '')) is null
       or c.id is null
       or coalesce(nullif(elem->>'full_name', ''), nullif(elem->>'fullName', '')) is null
       or btrim(coalesce(elem->>'full_name', elem->>'fullName', '')) = ''
       or coalesce(nullif(elem->>'number_in_list', ''), nullif(elem->>'numberInList', '')) is null
       or (coalesce(nullif(elem->>'number_in_list', ''), nullif(elem->>'numberInList', '')))::integer < 1
  ) then
    raise exception 'Invalid roster import payload';
  end if;

  -- Upsert students
  insert into public.students (
    id, workspace_id, owner_id, class_id, full_name, number_in_list,
    reg_number, registration_number, gender, birth_date, is_repeater,
    guardian_phone, notes, updated_by
  )
  select
    (s->>'id')::uuid,
    wid,
    auth.uid(),
    coalesce(nullif(s->>'class_id', ''), nullif(s->>'classId', ''))::uuid,
    btrim(coalesce(s->>'full_name', s->>'fullName', '')),
    (coalesce(nullif(s->>'number_in_list', ''), nullif(s->>'numberInList', '')))::integer,
    coalesce(nullif(s->>'reg_number', ''), nullif(s->>'regNumber', '')),
    coalesce(nullif(s->>'registration_number', ''), nullif(s->>'registrationNumber', ''), nullif(s->>'reg_number', ''), nullif(s->>'regNumber', '')),
    case
      when s->>'gender' in ('M', 'male') then 'male'
      when s->>'gender' in ('F', 'female') then 'female'
      else null
    end,
    case
      when coalesce(nullif(s->>'birth_date', ''), nullif(s->>'birthDate', '')) ~ '^\d{4}-\d{2}-\d{2}$'
      then (coalesce(nullif(s->>'birth_date', ''), nullif(s->>'birthDate', '')))::date
      else null
    end,
    coalesce((s->>'is_repeater')::boolean, (s->>'isRepeater')::boolean, false),
    coalesce(nullif(s->>'guardian_phone', ''), nullif(s->>'guardianPhone', '')),
    nullif(s->>'notes', ''),
    auth.uid()
  from jsonb_array_elements(coalesce(p_students, '[]'::jsonb)) as s
  on conflict (id) do update set
    class_id = excluded.class_id,
    full_name = excluded.full_name,
    number_in_list = excluded.number_in_list,
    reg_number = excluded.reg_number,
    registration_number = excluded.registration_number,
    gender = excluded.gender,
    birth_date = excluded.birth_date,
    is_repeater = excluded.is_repeater,
    guardian_phone = excluded.guardian_phone,
    notes = excluded.notes,
    updated_by = auth.uid();
end;
$$;

revoke execute on function public.import_roster_batch(jsonb, jsonb) from public, anon;
grant execute on function public.import_roster_batch(jsonb, jsonb) to authenticated;

-- 5. Refined clear_roster_data deleting only roster sync operations
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
  delete from public.sync_operations
    where workspace_id = wid
      and (
        operation_id like '%:class:%'
        or operation_id like '%:student:%'
        or operation_id like '%:grade:%'
        or operation_id like '%:session:%'
        or operation_id like '%:attendance:%'
        or operation_id like '%:behavior:%'
        or operation_id like '%:timetable:%'
        or operation_id like '%:lessonProgress:%'
      );
  delete from public.sync_tombstones
    where workspace_id = wid
      and entity_type in ('class', 'student', 'grade', 'session', 'attendance', 'behavior', 'timetable', 'lessonProgress');
end;
$$;

revoke execute on function public.clear_roster_data() from public, anon;
grant execute on function public.clear_roster_data() to authenticated;

-- 6. Add sync_tombstones to realtime publication
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sync_tombstones'
  ) then
    alter publication supabase_realtime add table public.sync_tombstones;
  end if;
end $$;

-- 7. Add foreign key performance indexes
create index if not exists attendance_workspace_student_idx on public.attendance(workspace_id, student_id);
create index if not exists session_behaviors_workspace_student_idx on public.session_behaviors(workspace_id, student_id);
create index if not exists lesson_plans_unit_idx on public.lesson_plans(workspace_id, unit_id);
create index if not exists lesson_progress_unit_idx on public.lesson_progress(workspace_id, unit_id);
create index if not exists memoranda_files_unit_idx on public.memoranda_files(workspace_id, unit_id);
create index if not exists classes_workspace_owner_idx on public.classes(workspace_id, owner_id);
create index if not exists students_workspace_owner_idx on public.students(workspace_id, owner_id);
create index if not exists grades_workspace_owner_idx on public.grades(workspace_id, owner_id);
create index if not exists sessions_workspace_owner_idx on public.sessions(workspace_id, owner_id);
create index if not exists timetable_slots_workspace_owner_idx on public.timetable_slots(workspace_id, owner_id);
create index if not exists dashboard_tasks_workspace_owner_idx on public.dashboard_tasks(workspace_id, owner_id);
create index if not exists sync_operations_workspace_owner_idx on public.sync_operations(workspace_id, owner_id);
