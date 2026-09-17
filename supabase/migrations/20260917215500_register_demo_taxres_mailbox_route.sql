-- Canonical TaxRes Demo mailbox routing.
-- Keeps the sales Demo on the same inbound Stalwart webhook path as other managed mailboxes.

insert into public.romylabs_mailboxes (
  email_address,
  product_id,
  tenant_id,
  display_name,
  outbound_from,
  inbox_owner,
  active
)
select
  'demo@taxrescrm.net',
  'taxres_crm',
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'TaxRes CRM',
  'romy@taxrescrm.net',
  'demo@taxrescrm.net',
  true
where not exists (
  select 1
  from public.romylabs_mailboxes
  where lower(email_address) = 'demo@taxrescrm.net'
);

update public.romylabs_mailboxes
set
  product_id = 'taxres_crm',
  tenant_id = 'a0000000-0000-0000-0000-000000000001'::uuid,
  display_name = 'TaxRes CRM',
  outbound_from = 'romy@taxrescrm.net',
  inbox_owner = 'demo@taxrescrm.net',
  active = true,
  updated_at = now()
where lower(email_address) = 'demo@taxrescrm.net';
