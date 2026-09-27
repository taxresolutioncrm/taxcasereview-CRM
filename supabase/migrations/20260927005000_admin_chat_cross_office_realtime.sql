-- Platform Admin cross-office chat must receive realtime INSERT events for every
-- tenant. The normal tenant permission policy remains unchanged for CRM users.
alter table public.chat_messages enable row level security;

drop policy if exists chat_platform_admin_select on public.chat_messages;
create policy chat_platform_admin_select
on public.chat_messages
for select
to authenticated
using (public._is_platform_admin());

-- Admin replies are always stamped with an explicit tenant_id by AdminChat.
-- Allow the owner to post cross-office without depending on a stale tenant
-- override; ordinary users still use the tenant-scoped policy.
drop policy if exists chat_platform_admin_insert on public.chat_messages;
create policy chat_platform_admin_insert
on public.chat_messages
for insert
to authenticated
with check (public._is_platform_admin());
