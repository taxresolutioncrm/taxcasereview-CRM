-- Batch tracking update: Restore Relay provider IDs supplied 2026-09-11.
-- Keep GA4 at Configured until the numeric GA4 Property ID is available for central reporting sync.
-- Keep Clarity at Configured until the public site is verified serving the exact project ID.

update public.product_traffic_channels
set status='configured',
    destination_url='https://restorerelay.com',
    notes='GA4 web stream Measurement ID G-SB2HLZHTPS supplied on 2026-09-11. Site wiring is prepared in the Restore Relay marketing release. Central Admin GA4 reporting still requires the separate numeric GA4 Property ID before this channel can be marked Live.',
    updated_at=now()
where product_id='restore_relay'
  and channel_key='ga4';

update public.product_traffic_channels
set status='configured',
    tracking_id='ygv6hce600',
    destination_url='https://restorerelay.com',
    notes='Microsoft Clarity project ID ygv6hce600 supplied on 2026-09-11 and prepared for the Restore Relay marketing release. Promote to Live only after the public site is verified loading the exact project ID.',
    updated_at=now()
where product_id='restore_relay'
  and channel_key='clarity';

do $$
begin
  if not exists (
    select 1 from public.product_traffic_channels
    where product_id='restore_relay' and channel_key='ga4'
      and status='configured' and notes like '%G-SB2HLZHTPS%'
  ) then raise exception 'Restore Relay GA4 Measurement ID batch update failed'; end if;

  if not exists (
    select 1 from public.product_traffic_channels
    where product_id='restore_relay' and channel_key='clarity'
      and status='configured' and tracking_id='ygv6hce600'
  ) then raise exception 'Restore Relay Clarity ID batch update failed'; end if;
end
$$;
