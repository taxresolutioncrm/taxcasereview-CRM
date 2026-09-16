insert into storage.buckets (id,name,public)
values ('chat-attachments','chat-attachments',false)
on conflict (id) do update set public=false;

drop policy if exists "chat_attachments_select" on storage.objects;
drop policy if exists "chat_attachments_insert" on storage.objects;
drop policy if exists "chat_attachments_update" on storage.objects;
drop policy if exists "chat_attachments_delete" on storage.objects;

create policy "chat_attachments_select"
on storage.objects for select to authenticated
using (
  bucket_id='chat-attachments'
  and (storage.foldername(name))[1]=public.current_tenant_id()::text
);

create policy "chat_attachments_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id='chat-attachments'
  and (storage.foldername(name))[1]=public.current_tenant_id()::text
);

create policy "chat_attachments_update"
on storage.objects for update to authenticated
using (
  bucket_id='chat-attachments'
  and (storage.foldername(name))[1]=public.current_tenant_id()::text
)
with check (
  bucket_id='chat-attachments'
  and (storage.foldername(name))[1]=public.current_tenant_id()::text
);

create policy "chat_attachments_delete"
on storage.objects for delete to authenticated
using (
  bucket_id='chat-attachments'
  and (storage.foldername(name))[1]=public.current_tenant_id()::text
);
