-- Fixes office E-Signature 409 after successful Stripe checkout and envelope creation.
CREATE OR REPLACE FUNCTION public.romylabs_stalwart_transport_for_product(p_product_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault', 'pg_temp'
AS $function$
declare
  v_entry public.credential_vault_entries;
  v_password text;
  v_route_email text;
  v_product text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'not authorized';
  end if;

  v_product := lower(trim(coalesce(p_product_key,'')));

  -- Resolve encrypted credentials only for the active, registered sender.
  -- Restore Relay must use info@restorerelay.com, never its unused personal
  -- romy@ mailbox; the same rule safely applies to all other CRM products.
  select c.*
    into v_entry
  from public.credential_vault_entries c
  join public.romylabs_mailboxes m
    on m.product_id = c.product_id
   and m.active = true
   and lower(trim(coalesce(m.outbound_from,''))) = lower(trim(coalesce(c.username,'')))
  where c.product_id = v_product
    and lower(coalesce(c.service,'')) like 'stalwart%'
  order by c.updated_at desc nulls last, m.updated_at desc nulls last
  limit 1;

  if not found then
    return jsonb_build_object('ok',false,'error','routed_mailbox_credential_missing');
  end if;

  v_route_email := lower(trim(coalesce(v_entry.username,'')));

  if v_route_email = '' then
    return jsonb_build_object('ok',false,'error','routed_mailbox_credential_missing');
  end if;

  select decrypted_secret
    into v_password
  from vault.decrypted_secrets
  where id = v_entry.secret_id;

  if coalesce(v_password,'') = '' then
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
$function$

