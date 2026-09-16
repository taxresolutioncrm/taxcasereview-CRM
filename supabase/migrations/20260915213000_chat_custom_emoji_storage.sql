insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('chat-emojis','chat-emojis',false,1048576,array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update
set public=false,
    file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "chat_emojis_select" on storage.objects;
drop policy if exists "chat_emojis_insert" on storage.objects;
drop policy if exists "chat_emojis_update" on storage.objects;
drop policy if exists "chat_emojis_delete" on storage.objects;

create policy "chat_emojis_select"
on storage.objects for select to authenticated
using (
  bucket_id='chat-emojis'
  and (storage.foldername(name))[1]=public.current_tenant_id()::text
);

create policy "chat_emojis_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id='chat-emojis'
  and (storage.foldername(name))[1]=public.current_tenant_id()::text
);

create policy "chat_emojis_update"
on storage.objects for update to authenticated
using (
  bucket_id='chat-emojis'
  and (storage.foldername(name))[1]=public.current_tenant_id()::text
)
with check (
  bucket_id='chat-emojis'
  and (storage.foldername(name))[1]=public.current_tenant_id()::text
);

create policy "chat_emojis_delete"
on storage.objects for delete to authenticated
using (
  bucket_id='chat-emojis'
  and (storage.foldername(name))[1]=public.current_tenant_id()::text
);
