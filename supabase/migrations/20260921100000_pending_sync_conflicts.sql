alter table public.sync_conflicts
  alter column resolution set default 'pending';

update public.sync_conflicts
set resolution = 'pending'
where resolution = 'last-write-wins';
