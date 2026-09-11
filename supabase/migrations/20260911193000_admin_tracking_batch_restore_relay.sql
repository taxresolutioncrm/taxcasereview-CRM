-- Batch tracking update: Restore Relay provider IDs supplied 2026-09-11.
-- Existing live Clarity implementations verified directly on production.
update public.product_traffic_channels
set status='live',
    tracking_id='xyck7g2mfl',
    destination_url='https://taxrescrm.net',
    notes='Verified live on 2026-09-11: TaxRes production config exposes Microsoft Clarity project ID xyck7g2mfl.',
    last_verified_at=now(),
    updated_at=now()
where product_id='taxres_crm' and channel_key='clarity';

update public.product_traffic_channels
set status='live',
    tracking_id='y62zna7yna',
    destination_url='https://www.camvella.com',
    notes='Verified live on 2026-09-11: Camvella production HTML loads Microsoft Clarity project ID y62zna7yna.',
    last_verified_at=now(),
    updated_at=now()
where product_id='camvella' and channel_key='clarity';

update public.product_traffic_channels
set status='live',
    tracking_id='y54zqoj6c2',
    destination_url='https://romylabs.com',
    notes='Verified live on 2026-09-11: RomyLabs production HTML loads Microsoft Clarity project ID y54zqoj6c2.',
    last_verified_at=now(),
    updated_at=now()
where product_id='romylabs' and channel_key='clarity';

-- Arcvena Clarity is now live-verified on the public site.
update public.product_traffic_channels
set status='live',
    tracking_id='yguz2tkhnt',
    destination_url='https://arcvena.com',
    notes='Verified live on 2026-09-11: Arcvena public HTML loads Microsoft Clarity project ID yguz2tkhnt and the previous project ID is no longer present.',
    last_verified_at=now(),
    updated_at=now()
where product_id='arcvena'
  and channel_key='clarity';

-- Keep GA4 at Configured until the numeric GA4 Property ID is available for central reporting sync.
-- BocaSync provider IDs recovered from the existing chat.
update public.product_traffic_channels
set status='configured',
    destination_url='https://bocasync.com',
    notes='GA4 web stream Measurement ID G-1K0FEZF916 supplied on 2026-09-11 and staged in the BocaSync marketing site. Central Admin GA4 reporting still requires the separate numeric GA4 Property ID before this channel can be marked Live.',
    updated_at=now()
where product_id='bocasync'
  and channel_key='ga4';

update public.product_traffic_channels
set status='configured',
    tracking_id='yguw0uq4km',
    destination_url='https://bocasync.com',
    notes='Microsoft Clarity project ID yguw0uq4km supplied on 2026-09-11 and staged in the BocaSync marketing site. Promote to Live after the public site is verified loading the exact project ID.',
    updated_at=now()
where product_id='bocasync'
  and channel_key='clarity';

-- Oculivo GA4 Measurement ID supplied from the Google tag setup screenshot.
update public.product_traffic_channels
set status='configured',
    destination_url='https://oculivo.com',
    notes='GA4 web stream Measurement ID G-WR6GGVYLXX supplied on 2026-09-11 and staged in the Oculivo website release. Central Admin GA4 reporting still requires the separate numeric GA4 Property ID before this channel can be marked Live.',
    updated_at=now()
where product_id='oculivo'
  and channel_key='ga4';

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

do $
begin
  if not exists (
    select 1 from public.product_traffic_channels
    where product_id='arcvena' and channel_key='clarity'
      and status='live' and tracking_id='yguz2tkhnt'
  ) then raise exception 'Arcvena Clarity live batch update failed'; end if;


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
