-- Universal e-sign Stalwart route matching.
-- Match each product's active mailbox route to the Stalwart credential actually
-- registered in the central vault instead of assuming every product uses romy@.

insert into public.romylabs_mailboxes(
  id,email_address,product_id,tenant_id,display_name,outbound_from,inbox_owner,active,created_at,updated_at
)
select
  gen_random_uuid(),
  'info@arcvena.com',
  'arcvena',
  coalesce(
    (select tenant_id from public.romylabs_mailboxes where product_id='arcvena' order by created_at limit 1),
    'a0000000-0000-0000-0000-000000000001'::uuid
  ),
  'Arcvena',
  'info@arcvena.com',
  'info@romylabs.com',
  true,
  now(),
  now()
where not exists (
  select 1 from public.romylabs_mailboxes where lower(email_address)=lower('info@arcvena.com')
);

create or replace function public.romylabs_stalwart_transport_for_product(p_product_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','vault','pg_temp'
as $$
declare
  v_entry public.credential_vault_entries;
  v_password text;
  v_route_email text;
  v_product text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'not authorized';
  end if;

  v_product:=lower(trim(coalesce(p_product_key,'')));

  select *
    into v_entry
  from public.credential_vault_entries
  where product_id=v_product
    and lower(coalesce(service,'')) like 'stalwart%'
  order by updated_at desc nulls last
  limit 1;

  if not found then
    return jsonb_build_object('ok',false,'error','credential_not_registered');
  end if;

  select lower(trim(m.outbound_from))
    into v_route_email
  from public.romylabs_mailboxes m
  where m.product_id=v_product
    and m.active=true
    and lower(trim(coalesce(m.outbound_from,'')))=lower(trim(coalesce(v_entry.username,'')))
  order by m.updated_at desc nulls last
  limit 1;

  if coalesce(v_route_email,'')='' then
    return jsonb_build_object(
      'ok',false,
      'error','routed_mailbox_credential_missing',
      'credential_username',v_entry.username
    );
  end if;

  select decrypted_secret
    into v_password
  from vault.decrypted_secrets
  where id=v_entry.secret_id;

  if coalesce(v_password,'')='' then
    return jsonb_build_object('ok',false,'error','credential_unavailable');
  end if;

  return jsonb_build_object(
    'ok',true,
    'host','mail.taxrescrm.net',
    'port',465,
    'username',v_entry.username,
    'from_address',v_route_email,
    'password',v_password
  );
end
$$;
