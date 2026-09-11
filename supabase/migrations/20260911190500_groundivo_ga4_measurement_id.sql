-- Record the GroundIVO GA4 web-stream Measurement ID without misusing tracking_id.
-- The central ga4-sync function requires the numeric GA4 Property ID in tracking_id,
-- so this leaves the channel Blocked until that separate property ID is supplied.

update public.product_traffic_channels
set status='blocked',
    destination_url='https://groundivo.com',
    notes='GA4 web stream Measurement ID G-BBHLF92295 supplied and wired into the GroundIVO marketing site on 2026-09-11. The central GA4 reporting sync still requires the separate numeric GA4 Property ID before this channel can be promoted to Live.',
    updated_at=now()
where product_id='groundivo'
  and channel_key='ga4';

do $$
begin
  if not exists (
    select 1
    from public.product_traffic_channels
    where product_id='groundivo'
      and channel_key='ga4'
      and status='blocked'
      and notes like '%G-BBHLF92295%'
  ) then
    raise exception 'GroundIVO GA4 Measurement ID tracking note was not persisted';
  end if;
end
$$;
