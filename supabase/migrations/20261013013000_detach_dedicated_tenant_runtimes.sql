-- Detach dedicated-office runtimes from the central TaxRes CRM database.
-- tenant_supabase_config is the source of truth: a row means that tenant has
-- its own dedicated Supabase/runtime and must not be operated from central CRM.

alter table public.tenant_supabase_config
  add column if not exists app_url text;

update public.tenant_supabase_config
set app_url='https://nashville.taxrescrm.app'
where tenant_id='489ace07-1a6b-4864-833a-4f8420568b40'::uuid
  and coalesce(nullif(trim(app_url),''),'')='';

create schema if not exists app_private;

create or replace function app_private.is_external_tenant(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select p_tenant is not null and exists (
    select 1
    from public.tenant_supabase_config c
    where c.tenant_id=p_tenant
      and nullif(trim(c.supabase_url),'') is not null
  )
$$;

revoke all on function app_private.is_external_tenant(uuid) from public;
grant execute on function app_private.is_external_tenant(uuid) to authenticated, service_role;

create or replace function public.external_runtime_for_current_user()
returns jsonb
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select jsonb_build_object(
    'tenant_id',e.tenant_id::text,
    'app_url',nullif(trim(c.app_url),''),
    'firm_name',t.firm_name
  )
  from public.employees e
  join public.tenant_supabase_config c on c.tenant_id=e.tenant_id
  join public.tenants t on t.id=e.tenant_id
  where lower(e.email)=lower(coalesce(auth.email(),''))
    and lower(coalesce(e.status,'active'))='active'
    and nullif(trim(c.app_url),'') is not null
  order by e.created_at desc
  limit 1
$$;
revoke all on function public.external_runtime_for_current_user() from public;
grant execute on function public.external_runtime_for_current_user() to authenticated;

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select coalesce(
    case when public._is_platform_admin() then (
      select o.tenant_id
      from public.admin_tenant_overrides o
      where o.admin_email=lower(coalesce(auth.jwt()->>'email',auth.email(),''))
        and o.updated_at>now()-interval '8 hours'
        and not app_private.is_external_tenant(o.tenant_id)
      limit 1
    ) end,
    (
      select t.id
      from public.tenants t
      join public.employees e on e.tenant_id=t.id
      where lower(e.email)=lower(coalesce(auth.jwt()->>'email',auth.email(),''))
        and coalesce(lower(e.status),'')='active'
        and not app_private.is_external_tenant(t.id)
      order by e.created_at desc
      limit 1
    )
  )
$$;

create or replace function public.set_admin_tenant_override(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_email text:=lower(coalesce(auth.jwt()->>'email',auth.email(),''));
begin
  if not public._is_platform_admin() then raise exception 'Not authorized'; end if;
  if v_email='' then raise exception 'Authenticated admin email required'; end if;

  if p_tenant_id is null then
    delete from public.admin_tenant_overrides where admin_email=v_email;
    return;
  end if;

  if not exists(select 1 from public.tenants where id=p_tenant_id) then
    raise exception 'Tenant not found';
  end if;
  if app_private.is_external_tenant(p_tenant_id) then
    raise exception 'This office uses a dedicated runtime.';
  end if;

  insert into public.admin_tenant_overrides(admin_email,tenant_id,updated_at)
  values(v_email,p_tenant_id,now())
  on conflict(admin_email) do update
    set tenant_id=excluded.tenant_id,updated_at=now();
end
$$;

create or replace function public.list_tenants()
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if not public._is_platform_admin() then raise exception 'Not authorized to list offices.'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',t.id,'firm_name',t.firm_name,'tenant_code',t.tenant_code,
      'firm_phone',t.firm_phone,'plan_tier',t.plan_tier,'status',t.status,
      'brand_color',t.brand_color,'created_at',t.created_at,
      'deactivated_at',t.deactivated_at,'per_seat_rate',t.per_seat_rate,
      'billing_seats',t.billing_seats,
      'employee_count',(select count(*) from public.employees e where e.tenant_id=t.id and lower(coalesce(e.status,'active'))='active'),
      'effective_monthly',coalesce(nullif(t.monthly_rate,0),case when t.per_seat_rate is not null then
        t.per_seat_rate*coalesce(nullif(t.billing_seats,0),(select count(*) from public.employees e where e.tenant_id=t.id and lower(coalesce(e.status,'active'))='active')) end),
      'admin_email',(select e.email from public.employees e where e.tenant_id=t.id and e.access='Super Admin' and lower(coalesce(e.status,'active'))='active' order by e.created_at limit 1)
    ) order by t.created_at),'[]'::jsonb)
    from public.tenants t
    where t.status<>'deleted'
      and not app_private.is_external_tenant(t.id)
  );
end
$$;

create or replace function public.booking_get_public_meta(p_tenant text default ''::text,p_client_id text default ''::text)
returns json
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_tenant uuid; r json;
begin
  begin v_tenant:=nullif(trim(p_tenant),'')::uuid; exception when others then v_tenant:=null; end;
  if v_tenant is not null and (not exists(select 1 from public.tenants t where t.id=v_tenant) or app_private.is_external_tenant(v_tenant)) then
    return null;
  end if;
  if v_tenant is null and coalesce(trim(p_client_id),'')<>'' then
    begin
      select c.tenant_id into v_tenant from public.clients c where c.id=trim(p_client_id) limit 1;
    exception when others then v_tenant:=null; end;
    if app_private.is_external_tenant(v_tenant) then return null; end if;
  end if;
  if v_tenant is not null then
    select json_build_object(
      'tenant_id',s.tenant_id::text,'firm_name',coalesce(s.name,'Tax Case Review'),
      'logo_url',coalesce(s.logourl,''),'email',coalesce(nullif(trim(s.email),''),nullif(trim(s.firmemail),''),''),
      'phone',coalesce(nullif(trim(s.phone),''),nullif(trim(s.firmphone),''),''),
      'payment',coalesce(s.booking_config->'payment','{"required":false}'::jsonb)
    ) into r from public.settings s where s.tenant_id=v_tenant limit 1;
    if r is not null then return r; end if;
  end if;
  select json_build_object(
    'tenant_id',s.tenant_id::text,'firm_name',coalesce(s.name,'Tax Case Review'),
    'logo_url',coalesce(s.logourl,''),'email',coalesce(nullif(trim(s.email),''),nullif(trim(s.firmemail),''),''),
    'phone',coalesce(nullif(trim(s.phone),''),nullif(trim(s.firmphone),''),''),
    'payment',coalesce(s.booking_config->'payment','{"required":false}'::jsonb)
  ) into r
  from public.settings s
  where not app_private.is_external_tenant(s.tenant_id)
  order by s.id limit 1;
  return r;
end
$$;

create or replace function public.booking_get_config(p_tenant text default ''::text)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_tenant uuid; cfg jsonb;
begin
  begin v_tenant:=nullif(trim(p_tenant),'')::uuid; exception when others then v_tenant:=null; end;
  if v_tenant is not null and (not exists(select 1 from public.tenants t where t.id=v_tenant) or app_private.is_external_tenant(v_tenant)) then return null; end if;
  if v_tenant is null then
    select t.id into v_tenant from public.tenants t
    where t.tenant_code='TCR-001' and not app_private.is_external_tenant(t.id) limit 1;
  end if;
  select s.booking_config into cfg from public.settings s where s.tenant_id=v_tenant and s.booking_config is not null limit 1;
  if cfg is null or not coalesce((cfg->>'enabled')::boolean,false) then return null; end if;
  return jsonb_build_object(
    'enabled',true,'slotMinutes',coalesce((cfg->>'slotMinutes')::int,30),
    'maxDaysOut',coalesce((cfg->>'maxDaysOut')::int,30),
    'types',coalesce(cfg->'types','["Free Consultation"]'::jsonb),
    'hours',coalesce(cfg->'hours','{}'::jsonb),
    'blockedDates',coalesce(cfg->'blockedDates','[]'::jsonb),
    'startTime',coalesce(cfg->>'startTime','09:00'),'endTime',coalesce(cfg->>'endTime','17:00'),
    'mon',coalesce((cfg->>'mon')::boolean,true),'tue',coalesce((cfg->>'tue')::boolean,true),
    'wed',coalesce((cfg->>'wed')::boolean,true),'thu',coalesce((cfg->>'thu')::boolean,true),
    'fri',coalesce((cfg->>'fri')::boolean,true),'sat',coalesce((cfg->>'sat')::boolean,false),
    'sun',coalesce((cfg->>'sun')::boolean,false)
  );
end
$$;

create or replace function public.booking_get_slots(p_date date,p_tenant text default null::text)
returns setof text
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_tenant uuid; cfg jsonb; h jsonb; dkey text; slot int; buf int; lead_h int; t time; endt time; today_et date;
begin
  begin v_tenant:=nullif(trim(p_tenant),'')::uuid; exception when others then v_tenant:=null; end;
  if v_tenant is not null and (not exists(select 1 from public.tenants tt where tt.id=v_tenant) or app_private.is_external_tenant(v_tenant)) then return; end if;
  if v_tenant is null then
    select tt.id into v_tenant from public.tenants tt
    where tt.tenant_code='TCR-001' and not app_private.is_external_tenant(tt.id) limit 1;
  end if;
  select s.booking_config into cfg from public.settings s where s.tenant_id=v_tenant and s.booking_config is not null limit 1;
  if cfg is null or not coalesce((cfg->>'enabled')::boolean,false) then return; end if;
  if coalesce(cfg->'blockedDates','[]'::jsonb)?to_char(p_date,'YYYY-MM-DD') then return; end if;
  today_et:=(now() at time zone 'America/New_York')::date;
  if p_date<today_et or p_date>today_et+coalesce((cfg->>'maxDaysOut')::int,30) then return; end if;
  dkey:=lower(to_char(p_date,'dy')); h:=cfg->'hours'->dkey;
  if h is null or jsonb_typeof(h)='null' then return; end if;
  slot:=coalesce((cfg->>'slotMinutes')::int,30); buf:=coalesce((cfg->>'bufferMinutes')::int,0); lead_h:=coalesce((cfg->>'leadHours')::int,4);
  t:=(h->>0)::time; endt:=(h->>1)::time;
  while t+(slot||' minutes')::interval<=endt loop
    if (p_date::timestamp+t)>=(now() at time zone 'America/New_York')+(lead_h||' hours')::interval
      and not exists(
        select 1 from public.calevents c
        where c.tenant_id=v_tenant and c.date=to_char(p_date,'YYYY-MM-DD')
          and coalesce(c.status,'') not in ('canceled','cancelled') and coalesce(c.time,'')<>''
          and c.time::time<t+(slot||' minutes')::interval
          and coalesce(nullif(c."endTime",'')::time,c.time::time+(slot||' minutes')::interval)>t
      )
    then return next to_char(t,'HH24:MI'); end if;
    t:=t+((slot+buf)||' minutes')::interval;
  end loop;
end
$$;

create or replace function public.booking_get(p_token text)
returns jsonb
language sql
security definer
set search_path=public,pg_temp
as $$
  select jsonb_build_object(
    'client_name',"clientName",'event_type',"eventType",'date',date,'time',time,
    'status',coalesce(status,'scheduled'),'contact_email',contact_email
  )
  from public.calevents
  where coalesce(p_token,'')<>'' and booking_token=p_token
    and not app_private.is_external_tenant(tenant_id)
  limit 1
$$;

create or replace function public.get_branding_by_email_domain(p_domain text)
returns json
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare result json;
begin
  select json_build_object(
    'tenant_id',s.tenant_id::text,'firm_name',coalesce(s.name,'TaxRes CRM'),
    'logo_url',coalesce(nullif(trim(s.logourl),''),null),
    'sub',coalesce(nullif(trim(s.website),''),'IRS Resolution Platform')
  ) into result
  from public.settings s
  where lower(split_part(coalesce(s.email,''),'@',2))=lower(trim(p_domain))
    and not app_private.is_external_tenant(s.tenant_id)
  limit 1;
  return result;
end
$$;

create or replace function public.emp_login_branding(p_email text)
returns json
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_tenant uuid; v_firm record;
begin
  select e.tenant_id into v_tenant
  from public.employees e
  where lower(trim(e.email))=lower(trim(p_email))
    and not app_private.is_external_tenant(e.tenant_id)
  order by e.created_at limit 1;
  if v_tenant is null then return json_build_object('name','','logo_url',''); end if;
  select s.name,s.logourl into v_firm from public.settings s where s.tenant_id=v_tenant order by s.id limit 1;
  return json_build_object('name',coalesce(v_firm.name,''),'logo_url',coalesce(v_firm.logourl,''));
end
$$;

create or replace function public.emp_login(p_email text,p_pin text)
returns json
language plpgsql
security definer
set search_path='pg_catalog','public','extensions'
as $$
declare v_emp public.employees; v_token text; v_firm record; v_key text:=lower(trim(coalesce(p_email,''))); v_ok boolean:=false;
begin
  perform public._public_auth_check('employee_portal',v_key);
  select * into v_emp
  from public.employees
  where lower(trim(email))=v_key
    and lower(coalesce(status,''))='active'
    and tenant_id is not null
    and not app_private.is_external_tenant(tenant_id)
  order by created_at limit 1;
  if v_emp.id is not null and coalesce(trim(v_emp.portal_pin),'')<>'' then
    if v_emp.portal_pin like '$2%' then v_ok:=extensions.crypt(trim(coalesce(p_pin,'')),v_emp.portal_pin)=v_emp.portal_pin;
    else v_ok:=v_emp.portal_pin=trim(coalesce(p_pin,'')); end if;
  end if;
  if not v_ok then perform public._public_auth_fail('employee_portal',v_key); raise exception 'Email or PIN is incorrect.'; end if;
  perform public._public_auth_success('employee_portal',v_key);
  if v_emp.portal_pin not like '$2%' then update public.employees set portal_pin=extensions.crypt(v_emp.portal_pin,extensions.gen_salt('bf',10)) where id=v_emp.id and tenant_id=v_emp.tenant_id; end if;
  v_token:=gen_random_uuid()::text||'-'||gen_random_uuid()::text;
  delete from public.employee_portal_sessions where expires_at<now();
  insert into public.employee_portal_sessions(token,employee_id,employee_name,tenant_id,expires_at)
  values(v_token,v_emp.id,v_emp.name,v_emp.tenant_id,now()+interval '12 hours');
  select s.name,s.logourl into v_firm from public.settings s where s.tenant_id=v_emp.tenant_id order by s.id limit 1;
  return json_build_object(
    'token',v_token,'firm',json_build_object('name',coalesce(v_firm.name,''),'logo_url',coalesce(v_firm.logourl,'')),
    'employee',json_build_object('id',v_emp.id,'name',v_emp.name,'email',v_emp.email,'phone',v_emp.phone,'title',v_emp.title,'access',v_emp.access,'employee_id',v_emp.employee_id,'tenant_id',v_emp.tenant_id,'pto_balance',v_emp.pto_balance,'sick_balance',v_emp.sick_balance,'vacation_balance',v_emp.vacation_balance,'has_pin',true)
  );
end
$$;

create or replace function public.kiosk_load_secure(p_tenant text default null::text)
returns json
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_tenant uuid; v_emps json;
begin
  begin v_tenant:=coalesce(nullif(trim(p_tenant),''),'61a89aef-0e7e-4ea2-b222-44ab2024655a')::uuid;
  exception when invalid_text_representation then raise exception 'Invalid tenant.'; end;
  if app_private.is_external_tenant(v_tenant) then raise exception 'Kiosk unavailable in this runtime.'; end if;
  if not exists(select 1 from public.tenants where id=v_tenant and status in ('active','trial')) then raise exception 'Kiosk unavailable.'; end if;
  select coalesce(json_agg(e order by e.name),'[]'::json) into v_emps
  from (select id,name,title,(coalesce(trim(portal_pin),'')<>'') as has_pin from public.employees where tenant_id=v_tenant and coalesce(status,'Active') not in ('Inactive','Terminated')) e;
  return json_build_object('employees',v_emps,'tenant_id',v_tenant);
end
$$;

create or replace function public.kiosk_login(p_employee_id text,p_pin text,p_tenant text default null::text)
returns json
language plpgsql
security definer
set search_path='pg_catalog','public','extensions'
as $$
declare v_tenant uuid; v_emp public.employees; v_token text; v_key text; v_ok boolean:=false;
begin
  begin v_tenant:=coalesce(nullif(trim(p_tenant),''),'61a89aef-0e7e-4ea2-b222-44ab2024655a')::uuid;
  exception when invalid_text_representation then raise exception 'Invalid tenant.'; end;
  if app_private.is_external_tenant(v_tenant) then raise exception 'Kiosk unavailable in this runtime.'; end if;
  v_key:=v_tenant::text||':'||coalesce(p_employee_id,'');
  perform public._public_auth_check('kiosk',v_key);
  select * into v_emp from public.employees where id=p_employee_id and tenant_id=v_tenant and lower(coalesce(status,'active'))='active';
  if v_emp.id is not null and coalesce(trim(v_emp.portal_pin),'')<>'' then
    if v_emp.portal_pin like '$2%' then v_ok:=extensions.crypt(trim(coalesce(p_pin,'')),v_emp.portal_pin)=v_emp.portal_pin;
    else v_ok:=v_emp.portal_pin=trim(coalesce(p_pin,'')); end if;
  end if;
  if not v_ok then perform public._public_auth_fail('kiosk',v_key); raise exception 'Employee or PIN is incorrect.'; end if;
  perform public._public_auth_success('kiosk',v_key);
  if v_emp.portal_pin not like '$2%' then update public.employees set portal_pin=extensions.crypt(v_emp.portal_pin,extensions.gen_salt('bf',10)) where id=v_emp.id and tenant_id=v_tenant; end if;
  v_token:=gen_random_uuid()::text||'-'||gen_random_uuid()::text;
  insert into public.employee_portal_sessions(token,employee_id,employee_name,tenant_id,expires_at)
  values(v_token,v_emp.id,v_emp.name,v_tenant,now()+interval '30 minutes');
  return json_build_object('token',v_token,'employee',json_build_object('id',v_emp.id,'name',v_emp.name,'title',v_emp.title,'tenant_id',v_tenant));
end
$$;

create or replace function public.portal_login(p_id text,p_email text,p_pin text)
returns table(token text,client_name text,is_lead boolean)
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare rec record; found_lead boolean:=false; last4 text; new_token text; v_key text:=coalesce(trim(p_id),'')||':'||lower(trim(coalesce(p_email,'')));
begin
  perform public._public_auth_check('client_portal',v_key);
  if coalesce(trim(p_id),'')='' or coalesce(trim(p_email),'')='' or coalesce(trim(p_pin),'')='' then
    perform public._public_auth_fail('client_portal',v_key); raise exception 'That information doesn''t match what we have on file. Contact your representative if you need help accessing your portal.';
  end if;
  select id,name,ssn,email,tenant_id into rec from public.clients
  where id::text=p_id and deleted_at is null and not app_private.is_external_tenant(tenant_id) limit 1;
  if rec.id is null then
    select id,name,ssn,email,tenant_id into rec from public.leads
    where id::text=p_id and deleted_at is null and not app_private.is_external_tenant(tenant_id) limit 1;
    found_lead:=true;
  end if;
  if rec.id is null or rec.tenant_id is null then
    perform public._public_auth_fail('client_portal',v_key); raise exception 'That information doesn''t match what we have on file. Contact your representative if you need help accessing your portal.';
  end if;
  last4:=right(regexp_replace(coalesce(rec.ssn,''),'\D','','g'),4);
  if length(last4)<>4 or lower(trim(p_email))<>lower(trim(coalesce(rec.email,''))) or trim(p_pin)<>last4 then
    perform public._public_auth_fail('client_portal',v_key); raise exception 'That information doesn''t match what we have on file. Contact your representative if you need help accessing your portal.';
  end if;
  perform public._public_auth_success('client_portal',v_key);
  new_token:=gen_random_uuid()::text||'-'||gen_random_uuid()::text;
  delete from public.portal_sessions where expires_at<now();
  insert into public.portal_sessions(token,client_id,is_lead,client_name,tenant_id,expires_at)
  values(new_token,rec.id,found_lead,rec.name,rec.tenant_id,now()+interval '12 hours');
  return query select new_token,rec.name,found_lead;
end
$$;

create or replace function public.financial_intake_load(p_id text)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare rec public.financial_intake_responses%rowtype; lead_rec record; existing public.financial_intake_responses%rowtype; created public.financial_intake_responses%rowtype; lead_json jsonb:=null;
begin
  select * into rec from public.financial_intake_responses where id::text=p_id limit 1;
  if rec.id is not null then
    if app_private.is_external_tenant(rec.tenant_id) then return null; end if;
    select l.id,l.name,l.email,l.street,l.city,l.state,l.zip,l.county,l.tenant_id into lead_rec
    from public.leads l
    where l.tenant_id=rec.tenant_id
      and ((rec.client_id is not null and l.id::text=rec.client_id) or (rec.client_id is null and l.name=rec.client_name))
    order by case when rec.client_id is not null and l.id::text=rec.client_id then 0 else 1 end,l.created_at desc limit 1;
    if lead_rec.id is not null then lead_json:=jsonb_build_object('street',lead_rec.street,'city',lead_rec.city,'state',lead_rec.state,'zip',lead_rec.zip,'county',lead_rec.county); end if;
    return jsonb_build_object('record',to_jsonb(rec),'leadState',lead_rec.state,'lead',lead_json);
  end if;
  select l.id,l.name,l.email,l.street,l.city,l.state,l.zip,l.county,l.tenant_id into lead_rec
  from public.leads l where l.id::text=p_id limit 1;
  if lead_rec.id is null or app_private.is_external_tenant(lead_rec.tenant_id) then return null; end if;
  lead_json:=jsonb_build_object('street',lead_rec.street,'city',lead_rec.city,'state',lead_rec.state,'zip',lead_rec.zip,'county',lead_rec.county);
  select * into existing from public.financial_intake_responses f
  where f.tenant_id=lead_rec.tenant_id and (f.client_id=lead_rec.id::text or (f.client_id is null and f.client_name=lead_rec.name))
  order by f.created_at desc limit 1;
  if existing.id is not null then return jsonb_build_object('record',to_jsonb(existing),'leadState',lead_rec.state,'lead',lead_json); end if;
  insert into public.financial_intake_responses(client_name,client_email,status,answers,created_at,updated_at,tenant_id,client_id)
  values(lead_rec.name,coalesce(lead_rec.email,''),'Sent','{}'::jsonb,now(),now(),lead_rec.tenant_id,lead_rec.id::text)
  returning * into created;
  return jsonb_build_object('record',to_jsonb(created),'leadState',lead_rec.state,'lead',lead_json);
end
$$;

create or replace function public.organizer_get(p_id text)
returns public.tax_organizer_responses
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare rec public.tax_organizer_responses;
begin
  select * into rec from public.tax_organizer_responses where id::text=p_id limit 1;
  if rec.id is not null and app_private.is_external_tenant(rec.tenant_id) then
    return null;
  end if;
  return rec;
end
$$;

create or replace function app_private.reject_external_tenant_runtime_write()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_tenant uuid;
begin
  if coalesce(auth.role(),'') not in ('anon','authenticated') then
    return coalesce(new,old);
  end if;
  v_tenant:=case when tg_op='DELETE' then old.tenant_id else new.tenant_id end;
  if app_private.is_external_tenant(v_tenant) then
    raise exception 'This office uses a dedicated runtime.';
  end if;
  return coalesce(new,old);
end
$$;
revoke all on function app_private.reject_external_tenant_runtime_write() from public;

do $$
declare t text;
begin
  foreach t in array array[
    'clients','leads','cases','tasks','calevents','employees','documents','client_notes',
    'emails','sms_messages','fax_logs','esigns','invoices','payments','estimates','bookkeeping',
    'timeentries','time_off_requests','financial_intake_responses','tax_organizer_responses',
    'client_financial_profiles','client_compliance_records','portal_sessions','employee_portal_sessions'
  ]
  loop
    if to_regclass('public.'||t) is not null then
      execute format('drop trigger if exists central_reject_external_runtime_write on public.%I',t);
      execute format('create trigger central_reject_external_runtime_write before insert or update or delete on public.%I for each row execute function app_private.reject_external_tenant_runtime_write()',t);
    end if;
  end loop;
end
$$;

-- Old dedicated-office sessions cannot be reused in central after detach.
delete from public.portal_sessions ps
where app_private.is_external_tenant(ps.tenant_id);

delete from public.employee_portal_sessions es
where app_private.is_external_tenant(es.tenant_id);

delete from public.admin_tenant_overrides ao
where app_private.is_external_tenant(ao.tenant_id);


-- Provider credentials for dedicated tenants must not remain usable in central.
update public.accounting_connections a
set status='disconnected',
    access_token=null,
    refresh_token=null,
    token_expires_at=null,
    last_sync_result=jsonb_build_object('ok',false,'stage','detached_runtime')
where app_private.is_external_tenant(a.tenant_id);

update public.settings s
set
  qb_client_secret=null,
  qb_merchant_password=null,
  qb_merchant_2_password=null,
  m365_client_secret=null,
  gmail_client_secret=null,
  gmail_access_token=null,
  gmail_refresh_token=null,
  gmail_token_expiry=null,
  gmail_last_error=null,
  logourl=coalesce(
    (select nullif(trim(c.app_url),'')||'/logo.png'
     from public.tenant_supabase_config c
     where c.tenant_id=s.tenant_id),
    s.logourl
  )
where app_private.is_external_tenant(s.tenant_id);
