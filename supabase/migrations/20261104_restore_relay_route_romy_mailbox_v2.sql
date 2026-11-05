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
