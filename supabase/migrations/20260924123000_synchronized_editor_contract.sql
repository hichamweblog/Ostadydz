-- Persist the accepted workspace contract additions without changing the
-- revision, outbox, tombstone, or conflict protocol.

alter table public.classes
  add column if not exists color text;

alter table public.profiles
  add column if not exists first_name_ar text,
  add column if not exists last_name_ar text,
  add column if not exists first_name_en text,
  add column if not exists last_name_en text,
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists first_appointment_date date,
  add column if not exists birth_date date,
  add column if not exists birth_place text,
  add column if not exists family_status text,
  add column if not exists gender text;

alter table public.sessions
  add column if not exists summary text,
  add column if not exists assignments text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_gender_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_gender_check
      check (gender is null or gender in ('M', 'F'));
  end if;
end $$;
