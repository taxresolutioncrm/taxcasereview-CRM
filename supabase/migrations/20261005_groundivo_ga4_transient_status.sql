-- Restore GroundIVO GA4 live status after a transient Google Analytics outage.
update public.product_traffic_channels
set status='live',
    updated_at=now()
where product_id='groundivo'
  and channel_key='ga4'
  and tracking_id='553878966'
  and exists (
    select 1
    from public.marketing_sync_log
    where product_id='groundivo'
      and source='ga4'
      and status='success'
  );
