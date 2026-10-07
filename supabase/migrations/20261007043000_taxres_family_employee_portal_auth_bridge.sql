-- TaxRes-family authenticated Employee Portal bridge.
-- Resolve the current tenant from the signed-in employee instead of hardcoding
-- a single office, so every TaxRes-family tenant uses the same safe flow.

create or replace function public.emp_login_auth()
returns json
language plpgsql
security definer
set search_path to 'public','app_private','auth','pg_temp'
as $$
declare
  v_emp public.employees;
  v_token text;
  v_firm record;
  v_email text := lower(btrim(coalesce(auth.email(),'')));
  v_tenant uuid := app_private.current_tenant_id();
begin
  if auth.uid() is null or v_email='' or v_tenant is null then
    raise exception 'Authentication required';
  end if;

  select * into v_emp
  from public.employees
  where tenant_id=v_tenant
    and lower(btrim(email))=v_email
    and coalesce(status,'Active')='Active'
  order by created_at
  limit 1;

  if v_emp.id is null then
    raise exception 'Active employee required';
  end if;

  delete from public.employee_portal_sessions
  where employee_id=v_emp.id
    and tenant_id=v_tenant
    and expires_at <= now();

  v_token := gen_random_uuid()::text || '-' || gen_random_uuid()::text;
  insert into public.employee_portal_sessions(token,employee_id,employee_name,tenant_id,expires_at)
  values(v_token,v_emp.id,v_emp.name,v_tenant,now()+interval '12 hours');

  select s.name,s.logourl into v_firm
  from public.settings s
  where s.tenant_id=v_tenant
  order by s.id
  limit 1;

  return json_build_object(
    'token',v_token,
    'firm',json_build_object(
      'name',coalesce(v_firm.name,'TaxRes CRM'),
      'logo_url',coalesce(v_firm.logourl,'')
    ),
    'employee',json_build_object(
      'id',v_emp.id,'name',v_emp.name,'email',v_emp.email,'phone',v_emp.phone,
      'title',v_emp.title,'access',v_emp.access,'employee_id',v_emp.employee_id,
      'pto_balance',v_emp.pto_balance,'sick_balance',v_emp.sick_balance,
      'vacation_balance',v_emp.vacation_balance,
      'has_pin',(v_emp.portal_pin is not null and btrim(v_emp.portal_pin)<>'')
    )
  );
end;
$$;

revoke all on function public.emp_login_auth() from public, anon;
grant execute on function public.emp_login_auth() to authenticated;

comment on function public.emp_login_auth()
is 'Creates an Employee Portal token for the currently authenticated active employee in their own TaxRes-family tenant.';
