-- Clarity Data Export API connection is not equivalent to positive site traffic.
-- Preserve existing statuses; "connected" means credentials verified even with 0 sessions.
-- This is not a forced "live" status and does not change any existing rows.
alter table public.product_traffic_channels
  drop constraint if exists product_traffic_channels_status_check;
alter table public.product_traffic_channels
  add constraint product_traffic_channels_status_check
  check (status = any (array[
    'planned'::text, 'configured'::text, 'connected'::text,
    'live'::text, 'blocked'::text, 'not_applicable'::text
  ]));
