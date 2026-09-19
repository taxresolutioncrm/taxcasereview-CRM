-- RomyLabs portfolio invariant:
-- Every active non-internal CRM product has a demo office represented in the
-- central Admin Portal registry. Real product demo tenants may replace the
-- placeholder external_office_id later without changing the UI contract.

create or replace function public.ensure_romylabs_product_demo_registry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_demo_id text := 'romylabs-demo';
begin
  if new.active is true
     and coalesce(lower(new.lifecycle), '') <> 'internal'
     and new.product_id not in ('romylabs', 'taxres_crm')
  then
    insert into public.romylabs_office_registry (
      id, product_key, external_office_id, firm_name,
      seats, monthly_amount, status, metadata, created_at, updated_at
    )
    values (
      gen_random_uuid(), new.product_id, v_demo_id, new.name || ' Demo',
      1, 0, 'trial',
      jsonb_build_object(
        'demo', true,
        'required_demo_office', true,
        'registry_only', true,
        'source', 'product_registry_trigger'
      ),
      now(), now()
    )
    on conflict (product_key, external_office_id)
    do update set
      firm_name = excluded.firm_name,
      metadata = coalesce(public.romylabs_office_registry.metadata, '{}'::jsonb) || excluded.metadata,
      updated_at = now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_require_romylabs_product_demo on public.romylabs_products;
create trigger trg_require_romylabs_product_demo
after insert or update of active, lifecycle, name
on public.romylabs_products
for each row
execute function public.ensure_romylabs_product_demo_registry();

insert into public.romylabs_office_registry (
  id, product_key, external_office_id, firm_name,
  seats, monthly_amount, status, metadata, created_at, updated_at
)
select
  gen_random_uuid(), p.product_id, 'romylabs-demo', p.name || ' Demo',
  1, 0, 'trial',
  jsonb_build_object(
    'demo', true,
    'required_demo_office', true,
    'registry_only', true,
    'source', 'product_registry_backfill'
  ),
  now(), now()
from public.romylabs_products p
where p.active is true
  and coalesce(lower(p.lifecycle), '') <> 'internal'
  and p.product_id not in ('romylabs', 'taxres_crm')
on conflict (product_key, external_office_id)
do update set
  firm_name = excluded.firm_name,
  metadata = coalesce(public.romylabs_office_registry.metadata, '{}'::jsonb) || excluded.metadata,
  updated_at = now();
