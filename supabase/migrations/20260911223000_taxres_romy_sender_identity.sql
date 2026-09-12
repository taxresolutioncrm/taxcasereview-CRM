-- TaxRes contracts authenticate through the working Stalwart mailbox but send as the branded Romy identity.
update public.romylabs_mailboxes
set email_address='romy@taxrescrm.net',
    outbound_from='romy@taxrescrm.net',
    display_name='TaxRes CRM',
    inbox_owner='info@romylabs.com',
    updated_at=now()
where product_id='taxres_crm';
