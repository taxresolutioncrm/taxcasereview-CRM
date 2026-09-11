-- Promote Restore Relay AEO after live canonical-domain verification and correct the registry URL.
-- Verified 2026-09-11: https://restorerelay.com/ and https://restorerelay.com/llms.txt both return HTTP 200.

update public.romylabs_products
set marketing_url='https://restorerelay.com',
    updated_at=now()
where product_id='restore_relay'
  and marketing_url is distinct from 'https://restorerelay.com';

update public.product_traffic_channels
set status='live',
    destination_url='https://restorerelay.com/llms.txt',
    last_verified_at=now(),
    updated_at=now(),
    notes='Verified live on 2026-09-11: canonical Restore Relay llms.txt returns HTTP 200 with the expected AI/AEO discovery manifest.'
where product_id='restore_relay'
  and channel_key='ai_aeo'
  and status='configured';

do $$
begin
  if not exists (
    select 1 from public.romylabs_products
    where product_id='restore_relay'
      and marketing_url='https://restorerelay.com'
  ) then
    raise exception 'Restore Relay canonical marketing URL was not updated';
  end if;

  if not exists (
    select 1 from public.product_traffic_channels
    where product_id='restore_relay'
      and channel_key='ai_aeo'
      and status='live'
      and destination_url='https://restorerelay.com/llms.txt'
  ) then
    raise exception 'Restore Relay AEO live promotion failed';
  end if;
end
$$;
