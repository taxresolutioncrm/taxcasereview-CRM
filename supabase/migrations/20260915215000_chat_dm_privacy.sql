create or replace function app_private.chat_current_employee_id()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.id
  from public.employees e
  where lower(e.email)=lower(coalesce(auth.jwt()->>'email',auth.email(),''))
    and e.tenant_id=public.current_tenant_id()
    and lower(coalesce(e.status,''))='active'
  limit 1
$$;

revoke all on function app_private.chat_current_employee_id() from public;
grant execute on function app_private.chat_current_employee_id() to authenticated;

drop policy if exists chat_dm_participant_guard on public.chat_messages;
create policy chat_dm_participant_guard
on public.chat_messages
as restrictive
for all
to authenticated
using (
  channel not like 'dm\_%' escape '\'
  or public._is_platform_admin()
  or (
    app_private.chat_current_employee_id() is not null
    and (
      (
        position('__' in substring(channel from 4)) > 0
        and app_private.chat_current_employee_id() = any(string_to_array(substring(channel from 4),'__'))
      )
      or (
        position('__' in substring(channel from 4)) = 0
        and (
          channel = 'dm_' || app_private.chat_current_employee_id()
          or lower(sender)=lower(public.chat_current_actor())
          or lower(sender)=lower(coalesce(auth.jwt()->>'email',''))
          or lower(sender)=lower(split_part(coalesce(auth.jwt()->>'email',''),'@',1))
        )
      )
    )
  )
)
with check (
  channel not like 'dm\_%' escape '\'
  or public._is_platform_admin()
  or (
    app_private.chat_current_employee_id() is not null
    and (
      (
        position('__' in substring(channel from 4)) > 0
        and app_private.chat_current_employee_id() = any(string_to_array(substring(channel from 4),'__'))
      )
      or (
        position('__' in substring(channel from 4)) = 0
        and channel = 'dm_' || app_private.chat_current_employee_id()
      )
    )
    and (
      lower(sender)=lower(public.chat_current_actor())
      or sender='🔔 System'
    )
  )
);
