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

  -- 1. Validate classes payload
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

  -- 2. Validate students payload
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

  -- 3. Upsert classes
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

  -- 4. Check for invalid students (supporting both camelCase and snake_case)
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

  -- 5. Upsert students
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
end
$$;

revoke execute on function public.import_roster_batch(jsonb, jsonb) from public, anon;
grant execute on function public.import_roster_batch(jsonb, jsonb) to authenticated;
