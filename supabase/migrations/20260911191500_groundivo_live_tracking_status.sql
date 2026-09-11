-- Promote only the GroundIVO tracking states proven live on 2026-09-11.
-- Live verification:
--   /analytics.js contains GA4 Measurement ID G-BBHLF92295
--   /analytics.js contains Clarity project ID ygv0xf8tea
--   /favicon.svg returns HTTP 200 and the homepage references /favicon.svg.

update public.product_traffic_channels
set status='configured',
    destination_url='https://groundivo.com',
    notes='GA4 web stream Measurement ID G-BBHLF92295 is verified loading on the live GroundIVO marketing site. The central reporting sync still needs the separate numeric GA4 Property ID before this channel can be marked Live.',
    updated_at=now()
where product_id='groundivo'
  and channel_key='ga4';

update public.product_traffic_channels
set status='live',
    tracking_id='ygv0xf8tea',
    destination_url='https://groundivo.com',
    notes='Verified live on 2026-09-11: GroundIVO public analytics.js loads Microsoft Clarity project ID ygv0xf8tea.',
    last_verified_at=now(),
    updated_at=now()
where product_id='groundivo'
  and channel_key='clarity';

do $$
begin
  if not exists (
    select 1 from public.product_traffic_channels
    where product_id='groundivo' and channel_key='ga4' and status='configured'
  ) then raise exception 'GroundIVO GA4 status normalization failed'; end if;

  if not exists (
    select 1 from public.product_traffic_channels
    where product_id='groundivo' and channel_key='clarity'
      and status='live' and tracking_id='ygv0xf8tea'
  ) then raise exception 'GroundIVO Clarity live promotion failed'; end if;
end
$$;
