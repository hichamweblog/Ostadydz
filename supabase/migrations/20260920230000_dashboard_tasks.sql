create table if not exists public.dashboard_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.default_workspace_id(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  task_id text not null,
  text text not null check (length(btrim(text)) > 0),
  done boolean not null default false,
  revision bigint not null default 0 check (revision >= 0),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, task_id),
  foreign key (workspace_id) references public.workspaces(id) on delete cascade
);

create or replace function public.bump_dashboard_task_revision()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.updated_at = timezone('utc', now());
  new.revision = old.revision + 1;
  new.updated_by = coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

create trigger dashboard_tasks_updated_at
before update on public.dashboard_tasks
for each row execute function public.bump_dashboard_task_revision();

alter table public.dashboard_tasks enable row level security;
create policy dashboard_tasks_owner_access on public.dashboard_tasks
for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create index if not exists dashboard_tasks_workspace_idx
on public.dashboard_tasks(workspace_id, task_id);
create index if not exists dashboard_tasks_owner_idx on public.dashboard_tasks(owner_id);
create index if not exists dashboard_tasks_updated_by_idx on public.dashboard_tasks(updated_by);
