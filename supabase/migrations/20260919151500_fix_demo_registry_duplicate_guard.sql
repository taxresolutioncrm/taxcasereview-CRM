-- Correct the portfolio demo invariant so products with a real demo tenant
-- do not also receive a registry-only placeholder demo.

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
     and not exists (
       select 1
       from public.romylabs_office_registry r
       where r.product_key = new.product_id
         and coalesce((r.metadata->>'required_demo_office')::boolean, false) = true
     )
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

-- Remove only automatically-created placeholders where the same product already
-- has another required demo row representing the real demo tenant.
delete from public.romylabs_office_registry placeholder
where placeholder.external_office_id = 'romylabs-demo'
  and placeholder.metadata->>'source' = 'product_registry_backfill'
  and exists (
    select 1
    from public.romylabs_office_registry real_demo
    where real_demo.product_key = placeholder.product_key
      and real_demo.external_office_id <> 'romylabs-demo'
      and coalesce((real_demo.metadata->>'required_demo_office')::boolean, false) = true
  );
