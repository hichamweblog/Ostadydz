-- Users created before the profile/workspace trigger was installed still need
-- the same ownership rows as newly registered users.
insert into public.profiles (id, full_name, avatar_url)
select
  u.id,
  nullif(u.raw_user_meta_data ->> 'full_name', ''),
  nullif(u.raw_user_meta_data ->> 'avatar_url', '')
from auth.users u
on conflict (id) do nothing;

insert into public.workspaces (owner_id)
select u.id
from auth.users u
on conflict (owner_id) do nothing;
