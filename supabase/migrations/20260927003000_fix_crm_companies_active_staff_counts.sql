-- Keep CRM Companies / office detail staff and billing counts aligned with
-- the authoritative Admin Portal definition: active employee rows only.

create or replace function public.list_tenants()
returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
begin
  if not public._is_platform_admin() then raise exception 'Not authorized to list offices.'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'firm_name', t.firm_name, 'tenant_code', t.tenant_code,
      'firm_phone', t.firm_phone, 'plan_tier', t.plan_tier, 'status', t.status,
      'brand_color', t.brand_color, 'created_at', t.created_at,
      'deactivated_at', t.deactivated_at,
      'per_seat_rate', t.per_seat_rate, 'billing_seats', t.billing_seats,
      'employee_count', (
        select count(*) from public.employees e
        where e.tenant_id=t.id and lower(coalesce(e.status,'active'))='active'
      ),
      'effective_monthly', coalesce(
        nullif(t.monthly_rate,0),
        case when t.per_seat_rate is not null then
          t.per_seat_rate * coalesce(
            nullif(t.billing_seats,0),
            (select count(*) from public.employees e
             where e.tenant_id=t.id and lower(coalesce(e.status,'active'))='active')
          )
        end
      ),
      'admin_email', (
        select e.email from public.employees e
        where e.tenant_id=t.id
          and e.access='Super Admin'
          and lower(coalesce(e.status,'active'))='active'
        order by e.created_at limit 1
      )
    ) order by t.created_at), '[]'::jsonb)
    from public.tenants t
    where t.status <> 'deleted'
  );
end;
$function$;

create or replace function public.get_office_detail(p_tenant_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v_active_staff int; v_seat_rate numeric; v_flat numeric; v_billing_seats int;
begin
  if not public._is_platform_admin() then raise exception 'Not authorized.'; end if;
  select count(*) into v_active_staff from public.employees
  where tenant_id=p_tenant_id and lower(coalesce(status,'active'))='active';
  select per_seat_rate, monthly_rate, billing_seats
    into v_seat_rate, v_flat, v_billing_seats
  from public.tenants where id=p_tenant_id;

  return jsonb_build_object(
    'tenant', (select to_jsonb(t) from public.tenants t where t.id=p_tenant_id),
    'billing', jsonb_build_object(
      'seats', coalesce(nullif(v_billing_seats,0),v_active_staff),
      'active_staff', v_active_staff,
      'per_seat_rate', v_seat_rate,
      'computed_monthly', case when v_seat_rate is not null
        then coalesce(nullif(v_billing_seats,0),v_active_staff) * v_seat_rate else null end,
      'flat_override', v_flat,
      'effective_monthly', coalesce(nullif(v_flat,0),
        case when v_seat_rate is not null
          then coalesce(nullif(v_billing_seats,0),v_active_staff) * v_seat_rate else null end)
    ),
    'employees', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',e.id,'name',e.name,'email',e.email,'access',e.access,'status',e.status
      ) order by e.name),'[]'::jsonb)
      from public.employees e where e.tenant_id=p_tenant_id
    ),
    'agreements', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',a.id,'file_name',a.file_name,'file_path',a.file_path,'file_size',a.file_size,
        'label',a.label,'uploaded_by',a.uploaded_by,'created_at',a.created_at
      ) order by a.created_at desc),'[]'::jsonb)
      from public.office_agreements a where a.tenant_id=p_tenant_id
    )
  );
end;
$function$;

revoke all on function public.list_tenants() from public,anon;
grant execute on function public.list_tenants() to authenticated,service_role;
revoke all on function public.get_office_detail(uuid) from public,anon;
grant execute on function public.get_office_detail(uuid) to authenticated,service_role;
