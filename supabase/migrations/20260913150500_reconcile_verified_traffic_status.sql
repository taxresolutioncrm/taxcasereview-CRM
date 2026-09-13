-- Reconcile Traffic Coverage status with provider evidence already present in the reporting tables.

with latest as (
  select distinct on (product_id)
    product_id, site_url, impressions, clicks, data_through, synced_at
  from public.marketing_gsc_snapshots
  order by product_id, synced_at desc
)
update public.product_traffic_channels c
set status='live',
    destination_url='https://oculivo.com',
    last_verified_at=s.synced_at,
    notes=format(
      'Organic search is verified live by the connected Google Search Console property. Latest provider snapshot through %s reports %s impressions.',
      s.data_through::text,
      s.impressions::text
    ),
    updated_at=now()
from latest s
where c.product_id='oculivo'
  and c.channel_key='organic_search'
  and s.product_id=c.product_id
  and s.impressions>0;

with latest as (
  select distinct on (product_id)
    product_id, site_url, impressions, clicks, data_through, synced_at
  from public.marketing_gsc_snapshots
  order by product_id, synced_at desc
)
update public.product_traffic_channels c
set notes=format(
      'Verified live by successful Google Search Console sync through %s. Current provider result: %s impressions, %s clicks for %s.',
      s.data_through::text,
      s.impressions::text,
      s.clicks::text,
      s.site_url
    ),
    last_verified_at=s.synced_at,
    updated_at=now()
from latest s
where c.channel_key='search_console'
  and c.status='live'
  and c.product_id=s.product_id
  and c.product_id in ('bocasync','groundivo','oculivo','restore_relay');
