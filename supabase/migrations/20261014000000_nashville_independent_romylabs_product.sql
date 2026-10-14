-- Nashville independent RomyLabs product registration
-- This script is staged only. Apply in controlled production migration after
-- sandbox acceptance. It preserves office, billing account and payment IDs.
begin;
do $$
declare
  v_office_id constant text := '489ace07-1a6b-4864-833a-4f8420568b40';
  v_registry_count integer;
  v_billing_count integer;
  v_payment_count integer;
begin
  select count(*) into v_registry_count
  from public.romylabs_office_registry
  where external_office_id = v_office_id and product_key = 'taxres_crm';
  select count(*) into v_billing_count
  from public.romylabs_billing_accounts
  where external_tenant_id = v_office_id and product_key = 'taxres_crm';
  if v_registry_count <> 1 or v_billing_count <> 1 then
    raise exception 'Nashville legacy office/billing cardinality mismatch: office %, billing %',v_registry_count,v_billing_count;
  end if;
  if exists(select 1 from public.romylabs_office_registry where external_office_id=v_office_id and product_key='nashville')
    or exists(select 1 from public.romylabs_billing_accounts where external_tenant_id=v_office_id and product_key='nashville')
    or exists(select 1 from public.romylabs_products where product_id='nashville') then
    raise exception 'Nashville already partially migrated; reconcile before running';
  end if;
  select count(*) into v_payment_count
  from public.romylabs_subscription_payments sp
  join public.romylabs_billing_accounts ba on ba.id=sp.account_id
  where ba.external_tenant_id=v_office_id and ba.product_key='taxres_crm';
  if v_payment_count <> 2 then
    raise exception 'Nashville payment count changed from validated baseline: %', v_payment_count;
  end if;
end $$;
insert into public.romylabs_products
  (product_id,name,active,description,lifecycle,public,app_url,accent_color,
   sort_order,industry,updated_at)
values
  ('nashville','Nashville Tax Solutions',true,
   'Independent tax resolution CRM; separately managed tenant and database',
   'live',false,null,'#6366f1',
   11,'Tax Resolution',now());
update public.romylabs_office_registry
set product_key='nashville',updated_at=now()
where product_key='taxres_crm'
  and external_office_id='489ace07-1a6b-4864-833a-4f8420568b40';
update public.romylabs_billing_accounts
set product_key='nashville',updated_at=now()
where product_key='taxres_crm'
  and external_tenant_id='489ace07-1a6b-4864-833a-4f8420568b40';
do $$
declare v_id constant text := '489ace07-1a6b-4864-833a-4f8420568b40';
begin
  if (select count(*) from public.romylabs_office_registry where external_office_id=v_id and product_key='nashville')<>1
  or (select count(*) from public.romylabs_billing_accounts where external_tenant_id=v_id and product_key='nashville')<>1
  or (select count(*) from public.romylabs_subscription_payments where account_id =
      (select id from public.romylabs_billing_accounts where external_tenant_id=v_id and product_key='nashville'))<>2
  then raise exception 'Nashville post-migration verification failed'; end if;
  -- Product registration normally seeds a required *demo* office. It must
  -- never be mistaken for a second operational Nashville office.
  if (select count(*) from public.romylabs_office_registry
      where product_key='nashville' and external_office_id=v_id) <> 1
     or (select count(*) from public.romylabs_office_registry
      where product_key='taxres_crm' and external_office_id=v_id) <> 0
  then raise exception 'Nashville office ownership overlap'; end if;
end $$;
commit;
