-- Add Microsoft Clarity as a first-class product traffic/behavior analytics channel.
insert into public.traffic_channel_catalog(channel_key,label,category,description,default_required,sort_order)
values ('clarity','Microsoft Clarity','analytics','Behavior analytics, heatmaps and session recordings for each product marketing site.',true,35)
on conflict (channel_key) do update
set label=excluded.label,
    category=excluded.category,
    description=excluded.description,
    default_required=true,
    sort_order=excluded.sort_order;

insert into public.product_traffic_channels(product_id,channel_key)
select p.product_id,'clarity'
from public.romylabs_products p
where p.active=true
on conflict (product_id,channel_key) do nothing;

update public.product_traffic_channels
set status='configured',
    tracking_id='yguz2tkhnt',
    destination_url='https://arcvena.com',
    notes='Arcvena Microsoft Clarity project ID supplied and wired into the product marketing site. Promote to Live after public-page verification confirms the exact project ID is loading.',
    updated_at=now()
where product_id='arcvena'
  and channel_key='clarity';

update public.product_traffic_channels
set status='not_applicable',
    notes='Internal-only CRM implementation; no standalone public marketing-site Clarity project is required.',
    updated_at=now()
where product_id='phl_land_care'
  and channel_key='clarity'
  and status='planned';

update public.product_traffic_channels
set notes='Product naming/domain is still unresolved. Keep Microsoft Clarity Planned until the canonical brand and domain are approved.',
    updated_at=now()
where product_id='aquagrid'
  and channel_key='clarity'
  and status='planned';

do $$
declare
  required_channels integer;
  missing_rows integer;
begin
  select count(*) into required_channels
  from public.traffic_channel_catalog
  where default_required=true;

  if required_channels <> 13 then
    raise exception 'Expected 13 required traffic channels after adding Clarity, found %', required_channels;
  end if;

  select count(*) into missing_rows
  from public.romylabs_products p
  cross join public.traffic_channel_catalog c
  left join public.product_traffic_channels pt
    on pt.product_id=p.product_id and pt.channel_key=c.channel_key
  where p.active=true and c.default_required=true and pt.product_id is null;

  if missing_rows <> 0 then
    raise exception 'Missing % required product traffic-channel rows after Clarity backfill', missing_rows;
  end if;
end
$$;
