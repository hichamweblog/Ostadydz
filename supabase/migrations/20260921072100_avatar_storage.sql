alter table public.profiles add column if not exists avatar_storage_key text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp']::text[])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "users read their avatar" on storage.objects;
create policy "users read their avatar" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and split_part(name, '/', 1) = 'users'
    and split_part(name, '/', 2) = (select auth.uid())::text);
drop policy if exists "users manage their avatar" on storage.objects;
create policy "users manage their avatar" on storage.objects for all to authenticated
  using (bucket_id = 'avatars' and split_part(name, '/', 1) = 'users'
    and split_part(name, '/', 2) = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and split_part(name, '/', 1) = 'users'
    and split_part(name, '/', 2) = (select auth.uid())::text);
