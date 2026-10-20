create table if not exists public.sync_operations (
  workspace_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  operation_id text not null,
  applied_at timestamptz not null default timezone('utc', now()),
  primary key (workspace_id, operation_id),
  foreign key (workspace_id) references public.workspaces(id)
);
create index if not exists sync_operations_owner_idx on public.sync_operations(owner_id);

alter table public.sync_operations enable row level security;
drop policy if exists sync_operations_owner_access on public.sync_operations;
create policy sync_operations_owner_access on public.sync_operations
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

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
  if p_owner_id <> auth.uid() then
    raise exception 'operation owner mismatch';
  end if;
  insert into public.sync_operations(workspace_id, owner_id, operation_id)
  values (p_workspace_id, p_owner_id, p_operation_id)
  on conflict (workspace_id, operation_id) do nothing;
  return found;
end;
$$;
