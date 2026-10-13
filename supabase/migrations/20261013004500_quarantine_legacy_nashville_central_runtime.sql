-- Fourth-sweep Nashville quarantine in the central TaxRes family database.
-- Nashville remains in RomyLabs control-plane registries/history, but the legacy
-- central operational tenant is no longer a valid runtime tenant.
do $$
begin
  if to_regprocedure('public.booking_get_config(text)') is not null
     and to_regprocedure('public.booking_get_config_pre_nash_quarantine(text)') is null then
    alter function public.booking_get_config(text) rename to booking_get_config_pre_nash_quarantine;
  end if;
  if to_regprocedure('public.booking_get_public_meta(text,text)') is not null
     and to_regprocedure('public.booking_get_public_meta_pre_nash_quarantine(text,text)') is null then
    alter function public.booking_get_public_meta(text,text) rename to booking_get_public_meta_pre_nash_quarantine;
  end if;
  if to_regprocedure('public.booking_get_slots(date,text)') is not null
     and to_regprocedure('public.booking_get_slots_pre_nash_quarantine(date,text)') is null then
    alter function public.booking_get_slots(date,text) rename to booking_get_slots_pre_nash_quarantine;
  end if;
  if to_regprocedure('public.booking_create(text,text,text,text,date,text,text,text)') is not null
     and to_regprocedure('public.booking_create_pre_nash_quarantine(text,text,text,text,date,text,text,text)') is null then
    alter function public.booking_create(text,text,text,text,date,text,text,text) rename to booking_create_pre_nash_quarantine;
  end if;
  if to_regprocedure('public.kiosk_load_secure(text)') is not null
     and to_regprocedure('public.kiosk_load_secure_pre_nash_quarantine(text)') is null then
    alter function public.kiosk_load_secure(text) rename to kiosk_load_secure_pre_nash_quarantine;
  end if;
  if to_regprocedure('public.kiosk_login(text,text,text)') is not null
     and to_regprocedure('public.kiosk_login_pre_nash_quarantine(text,text,text)') is null then
    alter function public.kiosk_login(text,text,text) rename to kiosk_login_pre_nash_quarantine;
  end if;
  if to_regprocedure('public.emp_login(text,text)') is not null
     and to_regprocedure('public.emp_login_pre_nash_quarantine(text,text)') is null then
    alter function public.emp_login(text,text) rename to emp_login_pre_nash_quarantine;
  end if;
  if to_regprocedure('public.emp_login_branding(text)') is not null
     and to_regprocedure('public.emp_login_branding_pre_nash_quarantine(text)') is null then
    alter function public.emp_login_branding(text) rename to emp_login_branding_pre_nash_quarantine;
  end if;
  if to_regprocedure('public.portal_login(text,text,text)') is not null
     and to_regprocedure('public.portal_login_pre_nash_quarantine(text,text,text)') is null then
    alter function public.portal_login(text,text,text) rename to portal_login_pre_nash_quarantine;
  end if;
  if to_regprocedure('public.organizer_get(text)') is not null
     and to_regprocedure('public.organizer_get_pre_nash_quarantine(text)') is null then
    alter function public.organizer_get(text) rename to organizer_get_pre_nash_quarantine;
  end if;
  if to_regprocedure('public.organizer_save_answers(text,jsonb)') is not null
     and to_regprocedure('public.organizer_save_answers_pre_nash_quarantine(text,jsonb)') is null then
    alter function public.organizer_save_answers(text,jsonb) rename to organizer_save_answers_pre_nash_quarantine;
  end if;
  if to_regprocedure('public.organizer_submit(text,jsonb)') is not null
     and to_regprocedure('public.organizer_submit_pre_nash_quarantine(text,jsonb)') is null then
    alter function public.organizer_submit(text,jsonb) rename to organizer_submit_pre_nash_quarantine;
  end if;
  if to_regprocedure('public.financial_intake_load(text)') is not null
     and to_regprocedure('public.financial_intake_load_pre_nash_quarantine(text)') is null then
    alter function public.financial_intake_load(text) rename to financial_intake_load_pre_nash_quarantine;
  end if;
  if to_regprocedure('public.financial_intake_save(text,jsonb)') is not null
     and to_regprocedure('public.financial_intake_save_pre_nash_quarantine(text,jsonb)') is null then
    alter function public.financial_intake_save(text,jsonb) rename to financial_intake_save_pre_nash_quarantine;
  end if;
  if to_regprocedure('public.financial_intake_submit(text,jsonb,jsonb,jsonb)') is not null
     and to_regprocedure('public.financial_intake_submit_pre_nash_quarantine(text,jsonb,jsonb,jsonb)') is null then
    alter function public.financial_intake_submit(text,jsonb,jsonb,jsonb) rename to financial_intake_submit_pre_nash_quarantine;
  end if;
end $$;

-- Defense in depth: the stale operational mirror is retained for history/migration
-- evidence, but is no longer active in the central runtime.
update public.tenants
set status='cancelled', deactivated_at=coalesce(deactivated_at,now())
where id='489ace07-1a6b-4864-833a-4f8420568b40'::uuid
  and status<>'cancelled';

update public.employees
set status='Inactive'
where tenant_id='489ace07-1a6b-4864-833a-4f8420568b40'::uuid
  and lower(coalesce(status,''))='active';

update public.settings
set booking_config=jsonb_set(coalesce(booking_config,'{}'::jsonb),'{enabled}','false'::jsonb,true)
where tenant_id='489ace07-1a6b-4864-833a-4f8420568b40'::uuid;

delete from public.admin_tenant_overrides
where tenant_id='489ace07-1a6b-4864-833a-4f8420568b40'::uuid;

create or replace function public.central_nashville_quarantined(p_tenant uuid)
returns boolean language sql immutable
as $$ select p_tenant='489ace07-1a6b-4864-833a-4f8420568b40'::uuid $$;

revoke all on function public.central_nashville_quarantined(uuid) from public;
grant execute on function public.central_nashville_quarantined(uuid) to anon,authenticated,service_role;

-- Authenticated central runtime: stale Nashville employee rows and old admin
-- overrides no longer establish a usable tenant context.
create or replace function public.current_tenant_id()
returns uuid language sql stable security definer
set search_path to 'public','pg_temp'
as $function$
  select coalesce(
    case when public._is_platform_admin() then (
      select o.tenant_id
      from public.admin_tenant_overrides o
      where o.admin_email=lower(coalesce(auth.jwt()->>'email',auth.email(),''))
        and o.updated_at>now()-interval '8 hours'
        and not public.central_nashville_quarantined(o.tenant_id)
      limit 1
    ) end,
    (
      select t.id
      from public.tenants t
      join public.employees e on e.tenant_id=t.id
      where lower(e.email)=lower(coalesce(auth.jwt()->>'email',auth.email(),''))
        and coalesce(lower(e.status),'')='active'
        and not public.central_nashville_quarantined(t.id)
      limit 1
    )
  )
$function$;

create or replace function public.set_admin_tenant_override(p_tenant_id uuid)
returns void language plpgsql security definer
set search_path to 'public','pg_temp'
as $function$
declare v_email text:=lower(coalesce(auth.jwt()->>'email',auth.email(),''));
begin
  if not public._is_platform_admin() then raise exception 'Not authorized'; end if;
  if v_email='' then raise exception 'Authenticated admin email required'; end if;
  if p_tenant_id is null then
    delete from public.admin_tenant_overrides where admin_email=v_email;
    return;
  end if;
  if public.central_nashville_quarantined(p_tenant_id) then
    raise exception 'Nashville is isolated in its dedicated CRM.';
  end if;
  if not exists(select 1 from public.tenants where id=p_tenant_id) then raise exception 'Tenant not found'; end if;
  insert into public.admin_tenant_overrides(admin_email,tenant_id,updated_at)
  values(v_email,p_tenant_id,now())
  on conflict(admin_email) do update set tenant_id=excluded.tenant_id,updated_at=now();
end
$function$;

-- Central admin office list is operational, not the RomyLabs control-plane registry.
create or replace function public.list_tenants()
returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp'
as $function$
begin
  if not public._is_platform_admin() then raise exception 'Not authorized to list offices.'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',t.id,'firm_name',t.firm_name,'tenant_code',t.tenant_code,
      'firm_phone',t.firm_phone,'plan_tier',t.plan_tier,'status',t.status,
      'brand_color',t.brand_color,'created_at',t.created_at,'deactivated_at',t.deactivated_at,
      'per_seat_rate',t.per_seat_rate,'billing_seats',t.billing_seats,
      'employee_count',(select count(*) from public.employees e where e.tenant_id=t.id and lower(coalesce(e.status,'active'))='active'),
      'effective_monthly',coalesce(nullif(t.monthly_rate,0),case when t.per_seat_rate is not null then t.per_seat_rate*coalesce(nullif(t.billing_seats,0),(select count(*) from public.employees e where e.tenant_id=t.id and lower(coalesce(e.status,'active'))='active')) end),
      'admin_email',(select e.email from public.employees e where e.tenant_id=t.id and e.access='Super Admin' and lower(coalesce(e.status,'active'))='active' order by e.created_at limit 1)
    ) order by t.created_at),'[]'::jsonb)
    from public.tenants t
    where t.status<>'deleted'
      and not public.central_nashville_quarantined(t.id)
  );
end
$function$;

-- Public booking wrappers.
create or replace function public.booking_get_config(p_tenant text default '')
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v uuid;
begin
  begin v:=nullif(trim(p_tenant),'')::uuid; exception when others then v:=null; end;
  if public.central_nashville_quarantined(v) then return null; end if;
  return public.booking_get_config_pre_nash_quarantine(p_tenant);
end $function$;

create or replace function public.booking_get_public_meta(p_tenant text default '',p_client_id text default '')
returns json language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v uuid;
begin
  begin v:=nullif(trim(p_tenant),'')::uuid; exception when others then v:=null; end;
  if v is null and coalesce(trim(p_client_id),'')<>'' then
    select c.tenant_id into v from public.clients c where c.id::text=trim(p_client_id) limit 1;
  end if;
  if public.central_nashville_quarantined(v) then return null; end if;
  return public.booking_get_public_meta_pre_nash_quarantine(p_tenant,p_client_id);
end $function$;

create or replace function public.booking_get_slots(p_date date,p_tenant text default null)
returns setof text language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v uuid;
begin
  begin v:=nullif(trim(p_tenant),'')::uuid; exception when others then v:=null; end;
  if public.central_nashville_quarantined(v) then return; end if;
  return query select * from public.booking_get_slots_pre_nash_quarantine(p_date,p_tenant);
end $function$;

create or replace function public.booking_create(p_name text,p_email text,p_phone text,p_event_type text,p_date date,p_time text,p_notes text,p_tenant text default null)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v uuid;
begin
  begin v:=nullif(trim(p_tenant),'')::uuid; exception when others then v:=null; end;
  if public.central_nashville_quarantined(v) then
    return jsonb_build_object('ok',false,'message','This office uses its dedicated booking system.');
  end if;
  return public.booking_create_pre_nash_quarantine(p_name,p_email,p_phone,p_event_type,p_date,p_time,p_notes,p_tenant);
end $function$;

-- Employee/kiosk portal wrappers.
create or replace function public.kiosk_load_secure(p_tenant text default null)
returns json language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v uuid;
begin
  begin v:=nullif(trim(p_tenant),'')::uuid; exception when others then v:=null; end;
  if public.central_nashville_quarantined(v) then raise exception 'Kiosk unavailable on this host.'; end if;
  return public.kiosk_load_secure_pre_nash_quarantine(p_tenant);
end $function$;

create or replace function public.kiosk_login(p_employee_id text,p_pin text,p_tenant text default null)
returns json language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v uuid;
begin
  begin v:=nullif(trim(p_tenant),'')::uuid; exception when others then v:=null; end;
  if public.central_nashville_quarantined(v) then raise exception 'Kiosk unavailable on this host.'; end if;
  return public.kiosk_login_pre_nash_quarantine(p_employee_id,p_pin,p_tenant);
end $function$;

create or replace function public.emp_login(p_email text,p_pin text)
returns json language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v uuid;
begin
  select e.tenant_id into v from public.employees e where lower(trim(e.email))=lower(trim(p_email)) order by e.created_at limit 1;
  if public.central_nashville_quarantined(v) then raise exception 'Use the Nashville employee portal.'; end if;
  return public.emp_login_pre_nash_quarantine(p_email,p_pin);
end $function$;

create or replace function public.emp_login_branding(p_email text)
returns json language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v uuid;
begin
  select e.tenant_id into v from public.employees e where lower(trim(e.email))=lower(trim(p_email)) order by e.created_at limit 1;
  if public.central_nashville_quarantined(v) then return null; end if;
  return public.emp_login_branding_pre_nash_quarantine(p_email);
end $function$;

-- Client portal wrapper.
create or replace function public.portal_login(p_id text,p_email text,p_pin text)
returns table(token text,client_name text,is_lead boolean)
language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v uuid;
begin
  select c.tenant_id into v from public.clients c where c.id::text=p_id and c.deleted_at is null limit 1;
  if v is null then select l.tenant_id into v from public.leads l where l.id::text=p_id and l.deleted_at is null limit 1; end if;
  if public.central_nashville_quarantined(v) then raise exception 'Use the Nashville client portal.'; end if;
  return query select * from public.portal_login_pre_nash_quarantine(p_id,p_email,p_pin);
end $function$;

-- Organizer wrappers.
create or replace function public.organizer_get(p_id text)
returns public.tax_organizer_responses language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v uuid;
begin
  select r.tenant_id into v from public.tax_organizer_responses r where r.id::text=p_id limit 1;
  if public.central_nashville_quarantined(v) then return null; end if;
  return public.organizer_get_pre_nash_quarantine(p_id);
end $function$;

create or replace function public.organizer_save_answers(p_id text,p_answers jsonb)
returns void language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v uuid;
begin
  select r.tenant_id into v from public.tax_organizer_responses r where r.id::text=p_id limit 1;
  if public.central_nashville_quarantined(v) then raise exception 'Organizer unavailable on this host.'; end if;
  perform public.organizer_save_answers_pre_nash_quarantine(p_id,p_answers);
end $function$;

create or replace function public.organizer_submit(p_id text,p_answers jsonb)
returns void language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v uuid;
begin
  select r.tenant_id into v from public.tax_organizer_responses r where r.id::text=p_id limit 1;
  if public.central_nashville_quarantined(v) then raise exception 'Organizer unavailable on this host.'; end if;
  perform public.organizer_submit_pre_nash_quarantine(p_id,p_answers);
end $function$;

-- Financial-intake wrappers.
create or replace function public.financial_intake_load(p_id text)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v uuid;
begin
  select r.tenant_id into v from public.financial_intake_responses r where r.id::text=p_id limit 1;
  if v is null then select l.tenant_id into v from public.leads l where l.id::text=p_id limit 1; end if;
  if public.central_nashville_quarantined(v) then return null; end if;
  return public.financial_intake_load_pre_nash_quarantine(p_id);
end $function$;

create or replace function public.financial_intake_save(p_id text,p_answers jsonb)
returns void language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v uuid;
begin
  select r.tenant_id into v from public.financial_intake_responses r where r.id::text=p_id limit 1;
  if public.central_nashville_quarantined(v) then raise exception 'Financial intake unavailable on this host.'; end if;
  perform public.financial_intake_save_pre_nash_quarantine(p_id,p_answers);
end $function$;

create or replace function public.financial_intake_submit(p_id text,p_answers jsonb,p_lead_patch jsonb,p_profile jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v uuid;
begin
  select r.tenant_id into v from public.financial_intake_responses r where r.id::text=p_id limit 1;
  if public.central_nashville_quarantined(v) then raise exception 'Financial intake unavailable on this host.'; end if;
  return public.financial_intake_submit_pre_nash_quarantine(p_id,p_answers,p_lead_patch,p_profile);
end $function$;

-- Hidden originals are callable only by the wrapper owner/service context.
revoke all on function public.booking_get_config_pre_nash_quarantine(text) from public,anon,authenticated;
revoke all on function public.booking_get_public_meta_pre_nash_quarantine(text,text) from public,anon,authenticated;
revoke all on function public.booking_get_slots_pre_nash_quarantine(date,text) from public,anon,authenticated;
revoke all on function public.booking_create_pre_nash_quarantine(text,text,text,text,date,text,text,text) from public,anon,authenticated;
revoke all on function public.kiosk_load_secure_pre_nash_quarantine(text) from public,anon,authenticated;
revoke all on function public.kiosk_login_pre_nash_quarantine(text,text,text) from public,anon,authenticated;
revoke all on function public.emp_login_pre_nash_quarantine(text,text) from public,anon,authenticated;
revoke all on function public.emp_login_branding_pre_nash_quarantine(text) from public,anon,authenticated;
revoke all on function public.portal_login_pre_nash_quarantine(text,text,text) from public,anon,authenticated;
revoke all on function public.organizer_get_pre_nash_quarantine(text) from public,anon,authenticated;
revoke all on function public.organizer_save_answers_pre_nash_quarantine(text,jsonb) from public,anon,authenticated;
revoke all on function public.organizer_submit_pre_nash_quarantine(text,jsonb) from public,anon,authenticated;
revoke all on function public.financial_intake_load_pre_nash_quarantine(text) from public,anon,authenticated;
revoke all on function public.financial_intake_save_pre_nash_quarantine(text,jsonb) from public,anon,authenticated;
revoke all on function public.financial_intake_submit_pre_nash_quarantine(text,jsonb,jsonb,jsonb) from public,anon,authenticated;

grant execute on function public.booking_get_config(text),public.booking_get_public_meta(text,text),public.booking_get_slots(date,text),public.booking_create(text,text,text,text,date,text,text,text),public.kiosk_load_secure(text),public.kiosk_login(text,text,text),public.emp_login(text,text),public.emp_login_branding(text),public.portal_login(text,text,text),public.organizer_get(text),public.organizer_save_answers(text,jsonb),public.organizer_submit(text,jsonb),public.financial_intake_load(text),public.financial_intake_save(text,jsonb),public.financial_intake_submit(text,jsonb,jsonb,jsonb) to anon,authenticated;
