-- Keep the class editor's room assignment in the same authoritative row as
-- the rest of the class contract.
alter table public.classes
  add column if not exists room_number text;