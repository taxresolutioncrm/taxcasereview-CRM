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


create or replace function public.admin_send_chat_message(
  p_tenant_id uuid,
  p_channel text,
  p_text text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_row public.chat_messages;
begin
  if not public._is_platform_admin() then raise exception 'Not authorized'; end if;
  if p_tenant_id is null or not exists(select 1 from public.tenants where id=p_tenant_id) then
    return jsonb_build_object('ok',false,'error','tenant_not_found');
  end if;
  if trim(coalesce(p_channel,''))='' then return jsonb_build_object('ok',false,'error','channel_required'); end if;
  if trim(coalesce(p_text,''))='' then return jsonb_build_object('ok',false,'error','message_required'); end if;

  insert into public.chat_messages(tenant_id,channel,sender,text,created_at,source)
  values(p_tenant_id,trim(p_channel),'Romy Cruz (Admin)',trim(p_text),now(),'romylabs_admin')
  returning * into v_row;

  return jsonb_build_object('ok',true,'message',to_jsonb(v_row));
end;
$$;

revoke all on function public.admin_send_chat_message(uuid,text,text) from public,anon;
grant execute on function public.admin_send_chat_message(uuid,text,text) to authenticated,service_role;
