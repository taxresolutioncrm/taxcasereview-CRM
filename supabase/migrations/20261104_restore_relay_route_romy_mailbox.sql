-- Restore Relay system mail route
-- Route the existing central Stalwart/JMAP transport through the Restore Relay
-- mailbox that has proven external delivery: romy@restorerelay.com.
-- No Gmail and no Brevo API usage is introduced here.

begin;

update public.credential_vault_entries
set service = 'Stalwart Email',
    updated_at = now()
where product_id = 'restore_relay'
  and lower(coalesce(username,'')) = 'romy@restorerelay.com'
  and lower(coalesce(service,'')) = 'personal email';

update public.romylabs_mailboxes
set email_address = 'romy@restorerelay.com',
    outbound_from = 'romy@restorerelay.com',
    display_name = 'Restore Relay',
    updated_at = now()
where product_id = 'restore_relay'
  and active = true;

-- Safety check: the active routed mailbox must now resolve to the intended
-- vaulted Stalwart credential.
do $$
declare
  v_count integer;
begin
  select count(*)
    into v_count
  from public.credential_vault_entries c
  join public.romylabs_mailboxes m
    on m.product_id = c.product_id
   and m.active = true
   and lower(trim(coalesce(m.outbound_from,''))) = lower(trim(coalesce(c.username,'')))
  where c.product_id = 'restore_relay'
    and lower(coalesce(c.service,'')) like 'stalwart%'
    and lower(coalesce(c.username,'')) = 'romy@restorerelay.com';

  if v_count <> 1 then
    raise exception 'Restore Relay routed mailbox did not resolve uniquely to romy@restorerelay.com';
  end if;
end
$$;

commit;
