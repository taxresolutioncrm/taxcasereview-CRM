-- Reconcile Traffic Coverage status with provider evidence already present in the reporting tables.

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
from lateral (
  select product_id,impressions,data_through,synced_at
  from public.marketing_gsc_snapshots
  where product_id='oculivo'
  order by synced_at desc
  limit 1
) s
where c.product_id='oculivo'
  and c.channel_key='organic_search'
  and s.impressions>0;

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
from lateral (
  select s2.product_id,s2.site_url,s2.impressions,s2.clicks,s2.data_through,s2.synced_at
  from public.marketing_gsc_snapshots s2
  where s2.product_id=c.product_id
  order by s2.synced_at desc
  limit 1
) s
where c.channel_key='search_console'
  and c.status='live'
  and c.product_id in ('bocasync','groundivo','oculivo','restore_relay');
