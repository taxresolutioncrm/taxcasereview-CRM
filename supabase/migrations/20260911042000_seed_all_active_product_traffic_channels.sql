-- Ensure every active RomyLabs product/CRM receives the standard acquisition-channel matrix.
-- Sandbox migration: backfills existing internal products (notably PHL Land Care CRM)
-- and prevents future active internal/non-public products from disappearing from Traffic Coverage.

create or replace function public.seed_product_traffic_channels()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.active = true then
    insert into public.product_traffic_channels(product_id, channel_key)
    select new.product_id, c.channel_key
    from public.traffic_channel_catalog c
    where c.default_required = true
    on conflict (product_id, channel_key) do nothing;
  end if;

  return new;
end;
$function$;

-- Backfill every currently-active product, including internal/non-public CRMs.
insert into public.product_traffic_channels(product_id, channel_key)
select p.product_id, c.channel_key
from public.romylabs_products p
cross join public.traffic_channel_catalog c
where p.active = true
  and c.default_required = true
on conflict (product_id, channel_key) do nothing;

-- Guard the invariant: no active product may be missing a required channel.
do $$
declare
  missing_count integer;
begin
  select count(*)
    into missing_count
  from public.romylabs_products p
  cross join public.traffic_channel_catalog c
  left join public.product_traffic_channels pt
    on pt.product_id = p.product_id
   and pt.channel_key = c.channel_key
  where p.active = true
    and c.default_required = true
    and pt.product_id is null;

  if missing_count <> 0 then
    raise exception 'Traffic coverage backfill failed: % required channel rows are missing', missing_count;
  end if;
end
$$;

revoke all on function public.seed_product_traffic_channels() from public, anon, authenticated;
grant execute on function public.seed_product_traffic_channels() to service_role;
