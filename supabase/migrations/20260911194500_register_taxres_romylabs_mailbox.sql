-- Register TaxRes CRM in the central RomyLabs mailbox routing table.
-- Contracts must use the same routed-mail architecture as other products.

insert into public.romylabs_mailboxes
  (product_id,email_address,display_name,outbound_from,inbox_owner,tenant_id,active,created_at,updated_at)
values
  (
    'taxres_crm',
    'info@taxrescrm.net',
    'TaxRes CRM',
    'info@taxrescrm.net',
    'info@romylabs.com',
    'a0000000-0000-0000-0000-000000000001',
    true,
    now(),
    now()
  )
on conflict do nothing;
