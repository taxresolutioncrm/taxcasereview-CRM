-- Product-aware RomyLabs sales -> external CRM office handoff.
-- Keeps TaxRes tenant_id semantics intact while allowing standalone product
-- offices (Restore Relay and future products) to be linked durably.

alter table public.prospects
  add column if not exists external_product_key text,
  add column if not exists external_office_id text;

alter table public.romylabs_sales_agreements
  add column if not exists external_product_key text,
  add column if not exists external_office_id text;

create index if not exists idx_prospects_external_office
  on public.prospects(external_product_key, external_office_id)
  where external_office_id is not null;

create index if not exists idx_romylabs_sales_agreements_external_office
  on public.romylabs_sales_agreements(external_product_key, external_office_id)
  where external_office_id is not null;

create or replace function public.admin_romylabs_link_external_office(
  p_prospect_id uuid,
  p_agreement_id uuid,
  p_product_key text,
  p_external_office_id text,
  p_firm_name text,
  p_seats integer default null,
  p_monthly_amount numeric default null,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_product text := lower(trim(coalesce(p_product_key,'')));
  v_office text := trim(coalesce(p_external_office_id,''));
  v_prospect public.prospects%rowtype;
begin
  if not public._is_platform_admin() then raise exception 'Not authorized'; end if;
  if v_product='' or v_office='' then raise exception 'Product and external office are required'; end if;

  select * into v_prospect from public.prospects where id=p_prospect_id for update;
  if not found then raise exception 'Prospect not found'; end if;

  if v_prospect.external_office_id is not null
     and (v_prospect.external_office_id<>v_office or coalesce(v_prospect.external_product_key,'')<>v_product)
  then
    raise exception 'Prospect already linked to another product office';
  end if;

  insert into public.romylabs_office_registry(
    product_key,external_office_id,firm_name,status,seats,monthly_amount,metadata,created_at,updated_at
  ) values(
    v_product,v_office,
    coalesce(nullif(trim(p_firm_name),''),v_prospect.firm_name,'RomyLabs Office'),
    'active',p_seats,p_monthly_amount,
    coalesce(p_metadata,'{}'::jsonb)
      || jsonb_build_object('prospect_id',p_prospect_id,'agreement_id',p_agreement_id,'source','sales_provisioning'),
    now(),now()
  )
  on conflict (product_key,external_office_id) do update
  set firm_name=excluded.firm_name,
      status='active',
      seats=coalesce(excluded.seats,public.romylabs_office_registry.seats),
      monthly_amount=coalesce(excluded.monthly_amount,public.romylabs_office_registry.monthly_amount),
      metadata=coalesce(public.romylabs_office_registry.metadata,'{}'::jsonb)||excluded.metadata,
      updated_at=now();

  update public.prospects
     set external_product_key=v_product,
         external_office_id=v_office,
         converted_at=coalesce(converted_at,now()),
         stage='Won',
         won_lost_date=coalesce(won_lost_date,current_date),
         next_action='Office created — begin onboarding',
         updated_at=now()
   where id=p_prospect_id;

  if p_agreement_id is not null then
    update public.romylabs_sales_agreements
       set external_product_key=v_product,
           external_office_id=v_office,
           updated_at=now()
     where id=p_agreement_id
       and prospect_id=p_prospect_id;
  end if;

  return jsonb_build_object(
    'ok',true,
    'prospect_id',p_prospect_id,
    'agreement_id',p_agreement_id,
    'product_key',v_product,
    'external_office_id',v_office
  );
end $$;

revoke all on function public.admin_romylabs_link_external_office(uuid,uuid,text,text,text,integer,numeric,jsonb) from public,anon;
grant execute on function public.admin_romylabs_link_external_office(uuid,uuid,text,text,text,integer,numeric,jsonb) to authenticated,service_role;
