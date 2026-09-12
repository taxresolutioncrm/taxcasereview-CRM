-- Universal contract sender routing: selected office -> product -> primary branded mailbox.
-- Stalwart remains the mailbox source of truth; Vault only supplies the existing login secret.

insert into public.romylabs_mailboxes(product_id,email_address,display_name,outbound_from,inbox_owner,tenant_id,active,created_at,updated_at)
values
  ('taxres_crm','romy@taxrescrm.net','TaxRes CRM','romy@taxrescrm.net','info@romylabs.com','a0000000-0000-0000-0000-000000000001',true,now(),now()),
  ('camvella','romy@camvella.com','Camvella','romy@camvella.com','info@romylabs.com','a0000000-0000-0000-0000-000000000001',true,now(),now()),
  ('arcvena','romy@arcvena.com','Arcvena','romy@arcvena.com','info@romylabs.com','a0000000-0000-0000-0000-000000000001',true,now(),now()),
  ('bocasync','romy@bocasync.com','BocaSync','romy@bocasync.com','info@romylabs.com','a0000000-0000-0000-0000-000000000001',true,now(),now()),
  ('groundivo','romy@groundivo.com','GroundIVO','romy@groundivo.com','info@romylabs.com','a0000000-0000-0000-0000-000000000001',true,now(),now()),
  ('oculivo','romy@oculivo.com','Oculivo','romy@oculivo.com','info@romylabs.com','a0000000-0000-0000-0000-000000000001',true,now(),now()),
  ('restore_relay','romy@restorerelay.com','Restore Relay','romy@restorerelay.com','info@romylabs.com','a0000000-0000-0000-0000-000000000001',true,now(),now()),
  ('romylabs','romy@romylabs.com','RomyLabs','romy@romylabs.com','info@romylabs.com','a0000000-0000-0000-0000-000000000001',true,now(),now())
on conflict do nothing;

create or replace function public.romylabs_stalwart_transport_for_product(p_product_key text)
returns jsonb
language plpgsql
security definer
set search_path=public,vault,pg_temp
as $$
declare
  v_entry public.credential_vault_entries;
  v_password text;
begin
  if auth.role() <> 'service_role' then raise exception 'not authorized'; end if;

  select * into v_entry
  from public.credential_vault_entries
  where product_id=lower(trim(coalesce(p_product_key,'')))
    and lower(service)='stalwart'
  order by updated_at desc
  limit 1;

  if not found then return jsonb_build_object('ok',false,'error','credential_not_registered'); end if;

  select decrypted_secret into v_password
  from vault.decrypted_secrets
  where id=v_entry.secret_id;

  if coalesce(v_password,'')='' then return jsonb_build_object('ok',false,'error','credential_unavailable'); end if;

  return jsonb_build_object(
    'ok',true,
    'host','mail.taxrescrm.net',
    'port',465,
    'username',v_entry.username,
    'password',v_password
  );
end $$;

revoke all on function public.romylabs_stalwart_transport_for_product(text) from public,anon,authenticated;
grant execute on function public.romylabs_stalwart_transport_for_product(text) to service_role;
