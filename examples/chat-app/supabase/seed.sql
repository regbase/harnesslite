-- Demo: anon can read/write objects in `chats` (tighten for production).
insert into storage.buckets (id, name, public)
values ('chats', 'chats', false)
on conflict (id) do nothing;

drop policy if exists "anon_select_chats" on storage.objects;
drop policy if exists "anon_insert_chats" on storage.objects;
drop policy if exists "anon_update_chats" on storage.objects;
drop policy if exists "anon_delete_chats" on storage.objects;

create policy "anon_select_chats"
  on storage.objects for select
  to anon
  using (bucket_id = 'chats');

create policy "anon_insert_chats"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'chats');

create policy "anon_update_chats"
  on storage.objects for update
  to anon
  using (bucket_id = 'chats')
  with check (bucket_id = 'chats');