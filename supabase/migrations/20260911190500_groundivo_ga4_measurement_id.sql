-- Record GroundIVO GA4 and Microsoft Clarity IDs without misusing the GA4 reporting property field.
-- The central ga4-sync function requires the numeric GA4 Property ID in tracking_id,
-- so this leaves the channel Blocked until that separate property ID is supplied.

update public.product_traffic_channels
set status='blocked',
    destination_url='https://groundivo.com',
    notes='GA4 web stream Measurement ID G-BBHLF92295 supplied and wired into the GroundIVO marketing site on 2026-09-11. The central GA4 reporting sync still requires the separate numeric GA4 Property ID before this channel can be promoted to Live.',
    updated_at=now()
where product_id='groundivo'
  and channel_key='ga4';

update public.product_traffic_channels
set status='configured',
    tracking_id='ygv0xf8tea',
    destination_url='https://groundivo.com',
    notes='Microsoft Clarity project ID ygv0xf8tea supplied and wired into the GroundIVO marketing site on 2026-09-11. Promote to Live after public-page verification confirms the exact project ID is loading.',
    updated_at=now()
where product_id='groundivo'
  and channel_key='clarity';

do $
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

  if not exists (
    select 1
    from public.product_traffic_channels
    where product_id='groundivo'
      and channel_key='clarity'
      and status='configured'
      and tracking_id='ygv0xf8tea'
  ) then
    raise exception 'GroundIVO Clarity project ID was not persisted';
  end if;
end
$;
