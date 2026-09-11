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


-- Proven source readiness should never regress to Planned after normalization.
do $$
declare
  bad_count integer;
begin
  select count(*) into bad_count
  from public.product_traffic_channels
  where product_id in ('bocasync','groundivo','restore_relay')
    and channel_key in ('organic_search','ai_aeo','local_search')
    and status='planned';

  if bad_count <> 0 then
    raise exception 'Expected normalized source-readiness statuses; % rows remain Planned', bad_count;
  end if;

  if exists (
    select 1
    from public.product_traffic_channels
    where product_id='oculivo'
      and updated_at >= timestamp with time zone '2026-09-11 04:35:00+00'
  ) then
    raise exception 'Oculivo traffic rows were modified by this release; Oculivo must remain untouched';
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
