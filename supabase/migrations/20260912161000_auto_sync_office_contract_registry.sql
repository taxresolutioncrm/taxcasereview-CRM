-- Keep every live CRM office visible in Admin Portal registered for universal contracts.
create or replace function public.admin_romylabs_upsert_office_registry(
  p_product_key text,
  p_external_office_id text,
  p_firm_name text,
  p_status text default 'active',
  p_seats integer default null,
  p_monthly_amount numeric default null,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_row public.romylabs_office_registry;
begin
  if not public._is_platform_admin() then raise exception 'not authorized'; end if;
  if coalesce(trim(p_product_key),'')='' or coalesce(trim(p_external_office_id),'')='' then
    return jsonb_build_object('ok',false,'error','product and office id required');
  end if;

  insert into public.romylabs_office_registry(
    product_key,external_office_id,firm_name,status,seats,monthly_amount,metadata,created_at,updated_at
  ) values(
    lower(trim(p_product_key)),trim(p_external_office_id),
    coalesce(nullif(trim(p_firm_name),''),initcap(replace(lower(trim(p_product_key)),'_',' '))||' Office'),
    coalesce(nullif(trim(p_status),''),'active'),p_seats,p_monthly_amount,coalesce(p_metadata,'{}'::jsonb),now(),now()
  )
  on conflict (product_key,external_office_id) do update
  set firm_name=excluded.firm_name,
      status=excluded.status,
      seats=coalesce(excluded.seats,public.romylabs_office_registry.seats),
      monthly_amount=coalesce(excluded.monthly_amount,public.romylabs_office_registry.monthly_amount),
      metadata=coalesce(public.romylabs_office_registry.metadata,'{}'::jsonb)||coalesce(excluded.metadata,'{}'::jsonb),
      updated_at=now()
  returning * into v_row;

  return jsonb_build_object('ok',true,'office',to_jsonb(v_row));
end $$;

revoke all on function public.admin_romylabs_upsert_office_registry(text,text,text,text,integer,numeric,jsonb) from public,anon;
grant execute on function public.admin_romylabs_upsert_office_registry(text,text,text,text,integer,numeric,jsonb) to authenticated,service_role;
