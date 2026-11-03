-- Dedicated private system sender for RomyLabs office subscription reminders.
-- Fail closed when a CRM has no registered nonpersonal mailbox and vault credential.
-- Does not modify the existing general-purpose Stalwart transport RPC.
-- The TaxRes vault already contains info@taxrescrm.net, but the existing
-- active mail routes used a personal outbound address. Register the verified
-- generic mailbox without modifying any other TaxRes mail route.
insert into public.romylabs_mailboxes
  (email_address,product_id,tenant_id,display_name,outbound_from,inbox_owner,active)
select 'info@taxrescrm.net','taxres_crm',m.tenant_id,'TaxRes System Reminder',
       'info@taxrescrm.net','info@taxrescrm.net',true
from public.romylabs_mailboxes m
where m.product_id='taxres_crm' and m.tenant_id is not null
  and exists (
    select 1 from public.credential_vault_entries c
    where c.product_id='taxres_crm' and lower(trim(c.username))='info@taxrescrm.net'
      and lower(coalesce(c.service,'')) like 'stalwart%'
  )
  and not exists (
    select 1 from public.romylabs_mailboxes x
    where lower(x.email_address)='info@taxrescrm.net'
  )
order by m.created_at
limit 1;

-- PoolVerge already has a nonpersonal Stalwart credential. Make the matching
-- product-scoped route available without inventing any mailbox or credentials.
insert into public.romylabs_mailboxes
  (email_address,product_id,tenant_id,display_name,outbound_from,inbox_owner,active)
select 'info@poolverge.com','pool_crm',null,'PoolVerge System Reminder',
       'info@poolverge.com','info@poolverge.com',true
where exists (
  select 1 from public.credential_vault_entries c
  where c.product_id='pool_crm'
    and lower(trim(c.username))='info@poolverge.com'
    and lower(coalesce(c.service,'')) like 'stalwart%'
)
and not exists (
  select 1 from public.romylabs_mailboxes m
  where m.product_id='pool_crm' and lower(m.outbound_from)='info@poolverge.com'
);

create or replace function public.romylabs_system_reminder_transport(p_product_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','vault','pg_temp'
as $function$
declare
  v_entry public.credential_vault_entries;
  v_password text;
  v_sender text;
  v_product text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'not authorized';
  end if;
  v_product := lower(trim(coalesce(p_product_key,'')));
  if v_product = '' then
    return jsonb_build_object('ok',false,'error','product_required');
  end if;

  select c.* into v_entry
  from public.credential_vault_entries c
  where c.product_id = v_product
    and lower(coalesce(c.service,'')) like 'stalwart%'
    and lower(trim(coalesce(c.username,''))) ~ '^(info|support|billing|notifications|no-reply|noreply|system|reminders)@'
    and exists (
      select 1 from public.romylabs_mailboxes m
      where m.product_id=c.product_id and m.active=true
        and lower(trim(m.outbound_from))=lower(trim(c.username))
    )
  order by
    case when lower(c.username) like 'billing@%' then 0
         when lower(c.username) like 'notifications@%' then 1
         when lower(c.username) like 'info@%' then 2
         else 3 end,
    c.updated_at desc nulls last
  limit 1;

  if not found then
    return jsonb_build_object('ok',false,'error','private_sender_unavailable','product',v_product);
  end if;

  v_sender := lower(trim(v_entry.username));
  select decrypted_secret into v_password
  from vault.decrypted_secrets where id = v_entry.secret_id;
  if coalesce(v_password,'') = '' then
    return jsonb_build_object('ok',false,'error','credential_unavailable','product',v_product);
  end if;
  return jsonb_build_object(
    'ok',true,'host','mail.taxrescrm.net','username',v_entry.username,
    'from_address',v_sender,'password',v_password,'product',v_product
  );
end
$function$;

revoke all on function public.romylabs_system_reminder_transport(text) from public,anon,authenticated;
grant execute on function public.romylabs_system_reminder_transport(text) to service_role;
comment on function public.romylabs_system_reminder_transport(text)
  is 'Service-only: nonpersonal verified Stalwart identity for a specified CRM; no cross-product or personal sender fallback.';
