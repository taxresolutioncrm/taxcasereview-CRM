-- Close remaining RomyLabs Admin Portal accuracy gaps:
-- employee lookup/edit, explicit cross-office chat routing, and active-staff office counts.

create or replace function public.admin_search_employees(p_query text, p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_q text := '%' || lower(trim(coalesce(p_query,''))) || '%';
  v_limit integer := least(greatest(coalesce(p_limit,50),1),200);
begin
  if not public._is_platform_admin() then raise exception 'Not authorized'; end if;
  if trim(coalesce(p_query,'')) = '' then return '[]'::jsonb; end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id,
      'name', e.name,
      'email', e.email,
      'phone', e.phone,
      'role', e.role,
      'access', e.access,
      'status', e.status,
      'avatar_url', e.avatar_url,
      'tenant_id', e.tenant_id,
      'tenant_name', t.firm_name,
      'tenant_code', t.tenant_code,
      'created_at', e.created_at
    ) order by t.firm_name, e.name), '[]'::jsonb)
    from (
      select e.*
      from public.employees e
      where lower(coalesce(e.name,'')) like v_q
         or lower(coalesce(e.email,'')) like v_q
         or regexp_replace(coalesce(e.phone,''),'[^0-9]','','g') like '%' || regexp_replace(trim(coalesce(p_query,'')),'[^0-9]','','g') || '%'
      order by e.created_at desc nulls last
      limit v_limit
    ) e
    join public.tenants t on t.id=e.tenant_id
  );
end;
$$;

create or replace function public.admin_update_employee_profile(
  p_employee_id text,
  p_name text,
  p_access text,
  p_role text,
  p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_row public.employees;
begin
  if not public._is_platform_admin() then raise exception 'Not authorized'; end if;
  if p_employee_id is null or trim(p_employee_id)='' then return jsonb_build_object('ok',false,'error','employee_id_required'); end if;
  if trim(coalesce(p_name,''))='' then return jsonb_build_object('ok',false,'error','name_required'); end if;
  if coalesce(p_access,'') not in ('Super Admin','Admin','Manager','Tax Advisor','Tax Associate','Associate','Para','Sales Rep','Read Only','View Only') then
    return jsonb_build_object('ok',false,'error','invalid_access');
  end if;

  update public.employees
     set name=trim(p_name),
         access=p_access,
         role=coalesce(nullif(trim(coalesce(p_role,'')),''),p_access),
         phone=nullif(trim(coalesce(p_phone,'')),'')
   where id=p_employee_id
   returning * into v_row;

  if v_row.id is null then return jsonb_build_object('ok',false,'error','employee_not_found'); end if;
  return jsonb_build_object('ok',true,'id',v_row.id,'tenant_id',v_row.tenant_id);
end;
$$;

create or replace function public.admin_send_chat_message(
  p_tenant_id uuid,
  p_channel text,
  p_text text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_row public.chat_messages;
begin
  if not public._is_platform_admin() then raise exception 'Not authorized'; end if;
  if p_tenant_id is null or not exists(select 1 from public.tenants where id=p_tenant_id) then
    return jsonb_build_object('ok',false,'error','tenant_not_found');
  end if;
  if trim(coalesce(p_channel,''))='' then return jsonb_build_object('ok',false,'error','channel_required'); end if;
  if trim(coalesce(p_text,''))='' then return jsonb_build_object('ok',false,'error','message_required'); end if;

  insert into public.chat_messages(tenant_id,channel,sender,text,created_at,source)
  values(p_tenant_id,trim(p_channel),'Romy Cruz (Admin)',trim(p_text),now(),'romylabs_admin')
  returning * into v_row;

  return jsonb_build_object(
    'ok',true,
    'message',jsonb_build_object(
      'id',v_row.id,'tenant_id',v_row.tenant_id,'channel',v_row.channel,
      'sender',v_row.sender,'text',v_row.text,'created_at',v_row.created_at
    )
  );
end;
$$;

-- Keep CRM Companies / office directory staff counts aligned with Admin Portal:
-- active employees only, billing seats separately, and deleted offices excluded.
create or replace function public.list_tenants()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public._is_platform_admin() then raise exception 'Not authorized to list offices.'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id,
      'firm_name', t.firm_name,
      'tenant_code', t.tenant_code,
      'firm_phone', t.firm_phone,
      'plan_tier', t.plan_tier,
      'status', t.status,
      'brand_color', t.brand_color,
      'created_at', t.created_at,
      'deactivated_at', t.deactivated_at,
      'per_seat_rate', t.per_seat_rate,
      'billing_seats', t.billing_seats,
      'employee_count', (
        select count(*) from public.employees e
        where e.tenant_id=t.id and lower(coalesce(e.status,'active'))='active'
      ),
      'effective_monthly', coalesce(
        nullif(t.monthly_rate,0),
        case when t.per_seat_rate is not null then
          t.per_seat_rate * coalesce(
            nullif(t.billing_seats,0),
            (select count(*) from public.employees e where e.tenant_id=t.id and lower(coalesce(e.status,'active'))='active')
          )
        end,
        0
      ),
      'admin_email', (
        select e.email from public.employees e
        where e.tenant_id=t.id
          and lower(coalesce(e.status,'active'))='active'
          and e.access='Super Admin'
        order by e.created_at
        limit 1
      )
    ) order by t.created_at), '[]'::jsonb)
    from public.tenants t
    where t.status <> 'deleted'
  );
end;
$$;

revoke all on function public.admin_search_employees(text,integer) from public,anon;
revoke all on function public.admin_update_employee_profile(text,text,text,text,text) from public,anon;
revoke all on function public.admin_send_chat_message(uuid,text,text) from public,anon;
grant execute on function public.admin_search_employees(text,integer) to authenticated,service_role;
grant execute on function public.admin_update_employee_profile(text,text,text,text,text) to authenticated,service_role;
grant execute on function public.admin_send_chat_message(uuid,text,text) to authenticated,service_role;
