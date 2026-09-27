-- Platform-owner employee lookup/edit APIs for the Admin Portal.
-- These are SECURITY DEFINER and explicitly owner-gated so cross-office lookup
-- does not depend on ordinary tenant RLS.

create or replace function public.admin_search_employees(p_query text, p_limit integer default 50)
returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_q text := trim(coalesce(p_query,''));
begin
  if not public._is_platform_admin() then raise exception 'Not authorized'; end if;
  if v_q='' then return '[]'::jsonb; end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(x) order by lower(x.name), lower(x.email)),'[]'::jsonb)
    from (
      select e.id,e.name,e.email,e.role,e.access,e.phone,e.avatar_url,e.tenant_id,e.created_at,e.status,
             t.firm_name as tenant_name
      from public.employees e
      left join public.tenants t on t.id=e.tenant_id
      where e.name ilike '%'||v_q||'%' or e.email ilike '%'||v_q||'%'
      limit least(greatest(coalesce(p_limit,50),1),200)
    ) x
  );
end $$;

create or replace function public.admin_update_employee_profile(
  p_employee_id uuid,
  p_name text,
  p_access text,
  p_role text,
  p_phone text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_row public.employees;
begin
  if not public._is_platform_admin() then raise exception 'Not authorized'; end if;
  if p_access not in ('Super Admin','Admin','Tax Associate','Read Only') then
    raise exception 'Invalid access level';
  end if;
  update public.employees
     set name=nullif(trim(p_name),''),
         access=p_access,
         role=coalesce(nullif(trim(p_role),''),p_access),
         phone=nullif(trim(p_phone),'')
   where id=p_employee_id
   returning * into v_row;
  if v_row.id is null then raise exception 'Employee not found'; end if;
  return jsonb_build_object('ok',true,'id',v_row.id);
end $$;

revoke all on function public.admin_search_employees(text,integer) from public,anon;
grant execute on function public.admin_search_employees(text,integer) to authenticated,service_role;
revoke all on function public.admin_update_employee_profile(uuid,text,text,text,text) from public,anon;
grant execute on function public.admin_update_employee_profile(uuid,text,text,text,text) to authenticated,service_role;
