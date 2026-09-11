-- Traffic coverage portfolio invariant test.
-- Run against a sandbox/dev database after applying migrations.

do $$
declare
  required_channels integer;
  missing_rows integer;
  phl_rows integer;
  phl_non_na integer;
begin
  select count(*) into required_channels
  from public.traffic_channel_catalog
  where default_required = true;

  if required_channels <> 12 then
    raise exception 'Expected 12 required traffic channels, found %', required_channels;
  end if;

  select count(*) into missing_rows
  from public.romylabs_products p
  cross join public.traffic_channel_catalog c
  left join public.product_traffic_channels pt
    on pt.product_id = p.product_id
   and pt.channel_key = c.channel_key
  where p.active = true
    and c.default_required = true
    and pt.product_id is null;

  if missing_rows <> 0 then
    raise exception 'Active product traffic matrix has % missing required rows', missing_rows;
  end if;

  select count(*) into phl_rows
  from public.product_traffic_channels
  where product_id = 'phl_land_care';

  if phl_rows <> required_channels then
    raise exception 'PHL Land Care expected % traffic rows, found %', required_channels, phl_rows;
  end if;

  select count(*) into phl_non_na
  from public.product_traffic_channels
  where product_id = 'phl_land_care'
    and status <> 'not_applicable';

  if phl_non_na <> 0 then
    raise exception 'PHL Land Care has % traffic channels not marked N/A', phl_non_na;
  end if;
end
$$;

select p.product_id,
       p.name,
       count(pt.*) as channel_rows,
       count(*) filter (where pt.status='live') as live,
       count(*) filter (where pt.status='configured') as configured,
       count(*) filter (where pt.status='planned') as planned,
       count(*) filter (where pt.status='blocked') as blocked,
       count(*) filter (where pt.status='not_applicable') as not_applicable
from public.romylabs_products p
join public.product_traffic_channels pt on pt.product_id=p.product_id
where p.active = true
group by p.product_id,p.name
order by p.name;
