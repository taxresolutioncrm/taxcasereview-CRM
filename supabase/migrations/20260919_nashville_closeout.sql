-- Nashville closeout: Book Whip integrity, employee portal auth bridge, and QB uniqueness.

create unique index if not exists accounting_connections_tenant_provider_uidx
on public.accounting_connections(tenant_id,provider);

create or replace function public.emp_login_auth()
returns json
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_emp public.employees;
  v_token text;
  v_firm record;
  v_email text := lower(btrim(coalesce(auth.email(),'')));
  v_tenant constant uuid := '489ace07-1a6b-4864-833a-4f8420568b40'::uuid;
begin
  if auth.uid() is null or v_email='' then
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
    raise exception 'Active Nashville employee required';
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
      'name',coalesce(v_firm.name,'Nashville Tax Solutions'),
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

create or replace function public.dedupe_nashville_book_whip_month(p_month date)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tenant constant uuid := '489ace07-1a6b-4864-833a-4f8420568b40';
  v_month date := date_trunc('month',p_month)::date;
  v_deleted integer := 0;
begin
  with groups as (
    select
      lower(regexp_replace(trim(client_name),'\s+[0-9]{5}$','','g')) norm,
      min(id::text) filter (where source='uploaded_csv') uploaded_id,
      max(client_id) filter (where client_id is not null and client_id<>'') any_client_id
    from public.book_whip_rows
    where tenant_id=v_tenant and snapshot_month=v_month
    group by 1
    having count(*)>1
  )
  update public.book_whip_rows bw
  set client_id=coalesce(nullif(bw.client_id,''),g.any_client_id),
      updated_at=now()
  from groups g
  where g.uploaded_id is not null
    and bw.id::text=g.uploaded_id
    and g.any_client_id is not null;

  with keepers as (
    select
      lower(regexp_replace(trim(client_name),'\s+[0-9]{5}$','','g')) norm,
      coalesce(
        min(id::text) filter (where source='uploaded_csv'),
        min(id::text)
      ) keep_id
    from public.book_whip_rows
    where tenant_id=v_tenant and snapshot_month=v_month
    group by 1
    having count(*)>1
  )
  delete from public.book_whip_rows bw
  using keepers k
  where bw.tenant_id=v_tenant
    and bw.snapshot_month=v_month
    and lower(regexp_replace(trim(bw.client_name),'\s+[0-9]{5}$','','g'))=k.norm
    and bw.id::text<>k.keep_id
    and bw.source<>'uploaded_csv';

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function public.system_refresh_nashville_book_whip()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tenant constant uuid := '489ace07-1a6b-4864-833a-4f8420568b40';
  v_month date := date_trunc('month', current_date)::date;
  v_count integer;
begin
  perform public.system_create_nashville_book_whip_month(v_month);
  perform public.dedupe_nashville_book_whip_month(v_month);
  perform public.refresh_book_whip_live_fields(v_tenant,v_month);

  select count(*) into v_count
  from public.book_whip_rows
  where tenant_id=v_tenant and snapshot_month=v_month;
  return v_count;
end;
$$;

revoke all on function public.dedupe_nashville_book_whip_month(date) from public, anon, authenticated;
revoke all on function public.system_refresh_nashville_book_whip() from public, anon, authenticated;
revoke all on function public.system_create_nashville_book_whip_month(date) from public, anon, authenticated;
