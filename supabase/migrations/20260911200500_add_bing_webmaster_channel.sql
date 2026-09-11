-- Add Bing Webmaster Tools as a first-class product reporting channel.
insert into public.traffic_channel_catalog(channel_key,label,category,description,default_required,sort_order)
values ('bing_webmaster','Bing Webmaster Tools','search','Product-scoped Bing Webmaster search performance and indexing visibility.',true,25)
on conflict (channel_key) do update
set label=excluded.label,
    category=excluded.category,
    description=excluded.description,
    default_required=true,
    sort_order=excluded.sort_order;

insert into public.product_traffic_channels(product_id,channel_key)
select p.product_id,'bing_webmaster'
from public.romylabs_products p
where p.active=true
on conflict (product_id,channel_key) do nothing;

update public.product_traffic_channels t
set status='configured',
    destination_url=p.marketing_url,
    notes='Bing Webmaster reporting is product-scoped in the Admin Portal and uses the shared Bing API credential. Promote to Live only after Bing returns verified data for this product domain.',
    updated_at=now()
from public.romylabs_products p
where t.product_id=p.product_id
  and t.channel_key='bing_webmaster'
  and p.active=true
  and p.public=true
  and p.marketing_url is not null
  and t.status in ('planned','blocked');

update public.product_traffic_channels
set status='not_applicable',
    notes='Internal-only CRM implementation; no standalone Bing Webmaster property is required.',
    updated_at=now()
where product_id='phl_land_care'
  and channel_key='bing_webmaster';

update public.product_traffic_channels
set status='planned',
    notes='Product name/domain is unresolved. Configure Bing Webmaster only after the canonical brand and domain are approved.',
    destination_url=null,
    updated_at=now()
where product_id='aquagrid'
  and channel_key='bing_webmaster';

do $$
declare
  required_channels integer;
  missing_rows integer;
begin
  select count(*) into required_channels
  from public.traffic_channel_catalog
  where default_required=true;

  if required_channels <> 14 then
    raise exception 'Expected 14 required traffic channels after adding Bing Webmaster, found %', required_channels;
  end if;

  select count(*) into missing_rows
  from public.romylabs_products p
  cross join public.traffic_channel_catalog c
  left join public.product_traffic_channels pt
    on pt.product_id=p.product_id and pt.channel_key=c.channel_key
  where p.active=true and c.default_required=true and pt.product_id is null;

  if missing_rows <> 0 then
    raise exception 'Missing % required product traffic-channel rows after Bing backfill', missing_rows;
  end if;
end
$$;
