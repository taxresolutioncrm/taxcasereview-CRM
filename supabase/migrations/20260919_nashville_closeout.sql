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

CREATE OR REPLACE FUNCTION public.dedupe_nashville_book_whip_month(p_month date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      coalesce(min(id::text) filter (where source='uploaded_csv'),min(id::text)) keep_id
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

  -- Legacy uploaded names sometimes have a suffix or formatting difference but
  -- still map unambiguously to a CRM client. Backfill those links so the client
  -- name remains clickable without inventing a match when more than one exists.
  with missing as (
    select id,lower(regexp_replace(trim(client_name),'\s+[0-9]{5}$','','g')) norm
    from public.book_whip_rows
    where tenant_id=v_tenant and snapshot_month=v_month and nullif(client_id,'') is null
  ), matches as (
    select m.id,max(c.id) matched_id
    from missing m
    join public.clients c
      on c.tenant_id=v_tenant
     and c.deleted_at is null
     and lower(regexp_replace(trim(c.name),'\s+[0-9]{5}$','','g'))=m.norm
    group by m.id
    having count(c.id)=1
  )
  update public.book_whip_rows bw
  set client_id=matches.matched_id,updated_at=now()
  from matches
  where bw.id=matches.id;

  return v_deleted;
end;
$function$


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


-- Keep the authenticated UI refresh path deduped too.
CREATE OR REPLACE FUNCTION public.create_book_whip_month(p_month date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app_private'
AS $function$
declare
  v_tenant uuid := app_private.current_tenant_id();
  v_month date := date_trunc('month', p_month)::date;
  v_prev date;
  v_count integer;
begin
  if v_tenant is null then
    raise exception 'Tenant context required';
  end if;

  if not exists (
    select 1 from public.employees e
    where e.tenant_id = v_tenant
      and lower(e.email) = lower(coalesce(auth.jwt()->>'email',''))
      and e.status = 'Active'
      and coalesce(e.perm_reports,0) >= 2
  ) then
    raise exception 'Reports edit access required';
  end if;

  select max(snapshot_month)
    into v_prev
  from public.book_whip_rows
  where tenant_id = v_tenant
    and snapshot_month < v_month;

  insert into public.book_whip_rows (
    tenant_id,snapshot_month,client_id,client_name,client_since,client_owner,source_created_on,
    tags,spouse_name,client_display,assigned_associate,financials,last_payment,transcripts,
    state_res_hold,hold_date,notes,quote,return_quote,resolution_step,chris_flag,johnny_flag,
    last_contact_date,source,source_file
  )
  select
    c.tenant_id,
    v_month,
    c.id,
    c.name,
    coalesce(c."clientSince",c.clientsince),
    coalesce(c."assignedTo",c.assignedto),
    c.created_at::text,
    c.tags,
    coalesce(c."spouseName",c.spousename),
    c.name,
    coalesce(c."taxAssociate",prev.assigned_associate),
    prev.financials,
    coalesce((
      select case
        when p.amount is null or trim(p.amount) = '' then null
        when trim(p.amount) like '$%' then trim(p.amount) || ' on ' || coalesce(nullif(trim(p.date),''),p.created_at::date::text)
        else '$' || trim(p.amount) || ' on ' || coalesce(nullif(trim(p.date),''),p.created_at::date::text)
      end
      from public.payments p
      where p.tenant_id = c.tenant_id
        and (
          p.client_id = c.id
          or lower(coalesce(p."clientName",p.clientname,'')) = lower(c.name)
        )
      order by p.created_at desc nulls last
      limit 1
    ),prev.last_payment),
    prev.transcripts,
    prev.state_res_hold,
    prev.hold_date,
    coalesce(prev.notes,c.internal_note,c.notes),
    prev.quote,
    prev.return_quote,
    prev.resolution_step,
    prev.chris_flag,
    prev.johnny_flag,
    prev.last_contact_date,
    case when v_prev is null then 'monthly_generated' else 'monthly_carry_forward' end,
    null
  from (
    select distinct on (tenant_id,name) *
    from public.clients
    where tenant_id = v_tenant
      and deleted_at is null
      and coalesce(archived,false) = false
      and lower(coalesce(status,'')) = 'active'
      and coalesce(name,'') <> ''
    order by tenant_id,name,created_at desc nulls last,id
  ) c
  left join public.book_whip_rows prev
    on prev.tenant_id = c.tenant_id
   and prev.snapshot_month = v_prev
   and lower(prev.client_name) = lower(c.name)
  on conflict (tenant_id,snapshot_month,client_name) do update
    set client_id = excluded.client_id,
        client_since = excluded.client_since,
        client_owner = excluded.client_owner,
        source_created_on = excluded.source_created_on,
        tags = excluded.tags,
        spouse_name = excluded.spouse_name,
        client_display = excluded.client_display,
        assigned_associate = coalesce(public.book_whip_rows.assigned_associate,excluded.assigned_associate),
        last_payment = coalesce(excluded.last_payment,public.book_whip_rows.last_payment),
        updated_at = now();

  delete from public.book_whip_rows bw
  where bw.tenant_id = v_tenant
    and bw.snapshot_month = v_month
    and bw.source <> 'uploaded_csv'
    and not exists (
      select 1
      from public.clients c
      where c.tenant_id = v_tenant
        and c.deleted_at is null
        and coalesce(c.archived,false) = false
        and lower(coalesce(c.status,'')) = 'active'
        and lower(c.name) = lower(bw.client_name)
    );

  if v_tenant = '489ace07-1a6b-4864-833a-4f8420568b40'::uuid then
    perform public.dedupe_nashville_book_whip_month(v_month);
    perform public.refresh_book_whip_live_fields(v_tenant,v_month);
  end if;

  select count(*) into v_count
  from public.book_whip_rows
  where tenant_id = v_tenant and snapshot_month = v_month;

  return v_count;
end;
$function$

