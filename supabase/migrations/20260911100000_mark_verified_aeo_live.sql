-- Promote AEO visibility only after live public verification.
-- Verified 2026-09-11: https://bocasync.com/llms.txt and https://groundivo.com/llms.txt both return HTTP 200 with the expected product manifest.

update public.product_traffic_channels
set status='live',
    last_verified_at=now(),
    updated_at=now(),
    notes='Verified live on 2026-09-11: public llms.txt returns HTTP 200 with the expected BocaSync AI/AEO discovery manifest.'
where product_id='bocasync'
  and channel_key='ai_aeo'
  and status='configured'
  and destination_url='https://bocasync.com/llms.txt';

update public.product_traffic_channels
set status='live',
    last_verified_at=now(),
    updated_at=now(),
    notes='Verified live on 2026-09-11: public llms.txt returns HTTP 200 with the expected GroundIVO AI/AEO discovery manifest.'
where product_id='groundivo'
  and channel_key='ai_aeo'
  and status='configured'
  and destination_url='https://groundivo.com/llms.txt';

do $$
begin
  if exists (
    select 1
    from public.product_traffic_channels
    where (product_id,channel_key) in (('bocasync','ai_aeo'),('groundivo','ai_aeo'))
      and status <> 'live'
  ) then
    raise exception 'AEO live promotion failed for BocaSync or GroundIVO';
  end if;
end
$$;
