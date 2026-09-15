create table if not exists public.chat_custom_emojis (
  id bigserial primary key,
  tenant_id uuid not null default current_tenant_id(),
  name text not null check (name ~ '^[a-z0-9_+-]{2,40}$'),
  image_path text not null,
  created_by text,
  created_at timestamptz not null default now(),
  unique (tenant_id,name)
);

alter table public.chat_custom_emojis enable row level security;

drop policy if exists chat_custom_emojis_tenant on public.chat_custom_emojis;
create policy chat_custom_emojis_tenant on public.chat_custom_emojis
for all to authenticated
using (tenant_id = current_tenant_id())
with check (tenant_id = current_tenant_id());

grant select,insert,update,delete on public.chat_custom_emojis to authenticated;
grant usage,select on sequence public.chat_custom_emojis_id_seq to authenticated;
