-- CENTRAL TAXRES DATABASE ONLY.
-- Quarantines the legacy Nashville copy without deleting historical business rows.
-- Dedicated Nashville database/project is intentionally not referenced here.

begin;

update public.tenants
set status='cancelled',
    deactivated_at=coalesce(deactivated_at, now()),
    deactivated_reason='QUARANTINED LEGACY COPY: Nashville operates from its separate dedicated database. Do not resolve this tenant in the central TaxRes family.'
where id='489ace07-1a6b-4864-833a-4f8420568b40'::uuid;

update public.employees
set status='Inactive'
where tenant_id='489ace07-1a6b-4864-833a-4f8420568b40'::uuid
  and lower(coalesce(status,''))<>'inactive';

update public.settings
set booking_config=coalesce(booking_config,'{}'::jsonb) || '{"enabled":false,"legacyQuarantined":true}'::jsonb
where tenant_id='489ace07-1a6b-4864-833a-4f8420568b40'::uuid;

-- Invalidate only ephemeral/public access handles. Historical rows remain.
delete from public.employee_portal_sessions
where tenant_id='489ace07-1a6b-4864-833a-4f8420568b40'::uuid;

delete from public.portal_sessions
where tenant_id='489ace07-1a6b-4864-833a-4f8420568b40'::uuid;

delete from public.admin_tenant_overrides
where tenant_id='489ace07-1a6b-4864-833a-4f8420568b40'::uuid;

update public.calevents
set booking_token=null
where tenant_id='489ace07-1a6b-4864-833a-4f8420568b40'::uuid
  and booking_token is not null;

create or replace function public.tenant_is_available(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path='public','pg_temp'
as $$
  select p_tenant is not null
     and exists (
       select 1
       from public.tenants t
       where t.id=p_tenant
         and lower(coalesce(t.status,'')) in ('active','trial')
     );
$$;

revoke all on function public.tenant_is_available(uuid) from public, anon, authenticated;
grant execute on function public.tenant_is_available(uuid) to service_role;

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path='public','pg_temp'
as $$
  select coalesce(
    case when public._is_platform_admin() then (
      select o.tenant_id
      from public.admin_tenant_overrides o
      join public.tenants t on t.id=o.tenant_id
      where o.admin_email=lower(coalesce(auth.jwt()->>'email',auth.email(),''))
        and o.updated_at>now()-interval '8 hours'
        and lower(coalesce(t.status,'')) in ('active','trial')
      limit 1
    ) end,
    (
      select t.id
      from public.tenants t
      join public.employees e on e.tenant_id=t.id
      where lower(e.email)=lower(coalesce(auth.jwt()->>'email',auth.email(),''))
        and coalesce(lower(e.status),'')='active'
        and lower(coalesce(t.status,'')) in ('active','trial')
      limit 1
    )
  )
$$;

create or replace function public.booking_get_public_meta(
  p_tenant text default ''::text,
  p_client_id text default ''::text
)
returns json
language plpgsql
security definer
set search_path='public','pg_temp'
as $$
declare v_tenant uuid; r json;
begin
  begin
    v_tenant:=nullif(trim(p_tenant),'')::uuid;
  exception when others then
    v_tenant:=null;
  end;

  if v_tenant is not null and not public.tenant_is_available(v_tenant) then
    return null;
  end if;

  if v_tenant is null and coalesce(trim(p_client_id),'')<>'' then
    begin
      select c.tenant_id into v_tenant
      from public.clients c
      where c.id=trim(p_client_id)
      limit 1;
    exception when others then
      v_tenant:=null;
    end;
    if v_tenant is not null and not public.tenant_is_available(v_tenant) then
      return null;
    end if;
  end if;

  if v_tenant is null then
    select t.id into v_tenant
    from public.tenants t
    where t.tenant_code='TCR-001'
      and lower(coalesce(t.status,'')) in ('active','trial')
    limit 1;
  end if;

  select json_build_object(
    'tenant_id',s.tenant_id::text,
    'firm_name',coalesce(s.name,'Tax Case Review'),
    'logo_url',coalesce(s.logourl,''),
    'email',coalesce(nullif(trim(s.email),''),nullif(trim(s.firmemail),''),''),
    'phone',coalesce(nullif(trim(s.phone),''),nullif(trim(s.firmphone),''),''),
    'payment',coalesce(s.booking_config->'payment','{"required":false}'::jsonb)
  )
  into r
  from public.settings s
  where s.tenant_id=v_tenant
  limit 1;

  return r;
end;
$$;

create or replace function public.emp_login_branding(p_email text)
returns json
language plpgsql
security definer
set search_path='public','pg_temp'
as $$
declare v_tenant uuid; v_firm record;
begin
  select e.tenant_id into v_tenant
  from public.employees e
  join public.tenants t on t.id=e.tenant_id
  where lower(trim(e.email))=lower(trim(p_email))
    and lower(coalesce(e.status,''))='active'
    and lower(coalesce(t.status,'')) in ('active','trial')
  order by e.created_at
  limit 1;

  if v_tenant is not null then
    select s.name,s.logourl into v_firm
    from public.settings s
    where s.tenant_id=v_tenant
    order by s.id
    limit 1;
  end if;

  if v_firm is null then
    select s.name,s.logourl into v_firm
    from public.settings s
    join public.tenants t on t.id=s.tenant_id
    where t.tenant_code='TCR-001'
      and lower(coalesce(t.status,'')) in ('active','trial')
    limit 1;
  end if;

  return json_build_object(
    'name',coalesce(v_firm.name,''),
    'logo_url',coalesce(v_firm.logourl,'')
  );
end;
$$;

create or replace function public.portal_get_stripe_pk(p_client_id text)
returns text
language plpgsql
security definer
set search_path='public','pg_temp'
as $$
declare v_tenant uuid; v_pk text;
begin
  select c.tenant_id into v_tenant
  from public.clients c
  where c.id::text=p_client_id
  limit 1;

  if not public.tenant_is_available(v_tenant) then
    return null;
  end if;

  select s.stripe_publishable_key into v_pk
  from public.settings s
  where s.tenant_id=v_tenant
  limit 1;

  return v_pk;
end;
$$;

-- Wrap public token/id entrypoints so historical rows remain but cancelled tenants cannot resolve.
do $$
begin
  if to_regprocedure('public.portal_login_unchecked(text,text,text)') is null then
    alter function public.portal_login(text,text,text) rename to portal_login_unchecked;
  end if;
  if to_regprocedure('public.financial_intake_load_unchecked(text)') is null then
    alter function public.financial_intake_load(text) rename to financial_intake_load_unchecked;
  end if;
  if to_regprocedure('public.financial_intake_submit_unchecked(text,jsonb,jsonb,jsonb)') is null then
    alter function public.financial_intake_submit(text,jsonb,jsonb,jsonb) rename to financial_intake_submit_unchecked;
  end if;
  if to_regprocedure('public.organizer_get_unchecked(text)') is null then
    alter function public.organizer_get(text) rename to organizer_get_unchecked;
  end if;
  if to_regprocedure('public.organizer_save_answers_unchecked(text,jsonb)') is null then
    alter function public.organizer_save_answers(text,jsonb) rename to organizer_save_answers_unchecked;
  end if;
  if to_regprocedure('public.organizer_submit_unchecked(text,jsonb)') is null then
    alter function public.organizer_submit(text,jsonb) rename to organizer_submit_unchecked;
  end if;
end $$;

revoke all on function public.portal_login_unchecked(text,text,text) from public, anon, authenticated;
revoke all on function public.financial_intake_load_unchecked(text) from public, anon, authenticated;
revoke all on function public.financial_intake_submit_unchecked(text,jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.organizer_get_unchecked(text) from public, anon, authenticated;
revoke all on function public.organizer_save_answers_unchecked(text,jsonb) from public, anon, authenticated;
revoke all on function public.organizer_submit_unchecked(text,jsonb) from public, anon, authenticated;

create or replace function public.portal_login(p_id text,p_email text,p_pin text)
returns table(token text,client_name text,is_lead boolean)
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare v_tenant uuid;
begin
  select c.tenant_id into v_tenant from public.clients c
  where c.id::text=p_id and c.deleted_at is null limit 1;
  if v_tenant is null then
    select l.tenant_id into v_tenant from public.leads l
    where l.id::text=p_id and l.deleted_at is null limit 1;
  end if;

  if not public.tenant_is_available(v_tenant) then
    raise exception 'That information does not match what we have on file. Contact your representative if you need help accessing your portal.';
  end if;

  return query
    select * from public.portal_login_unchecked(p_id,p_email,p_pin);
end;
$$;

create or replace function public.financial_intake_load(p_id text)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare v_tenant uuid;
begin
  select f.tenant_id into v_tenant
  from public.financial_intake_responses f
  where f.id::text=p_id
  limit 1;

  if v_tenant is null then
    select l.tenant_id into v_tenant
    from public.leads l
    where l.id::text=p_id
    limit 1;
  end if;

  if not public.tenant_is_available(v_tenant) then
    return null;
  end if;

  return public.financial_intake_load_unchecked(p_id);
end;
$$;

create or replace function public.financial_intake_submit(
  p_id text,p_answers jsonb,p_lead_patch jsonb,p_profile jsonb
)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare v_tenant uuid;
begin
  select f.tenant_id into v_tenant
  from public.financial_intake_responses f
  where f.id::text=p_id
  limit 1;

  if not public.tenant_is_available(v_tenant) then
    raise exception 'Financial intake is unavailable.';
  end if;

  return public.financial_intake_submit_unchecked(p_id,p_answers,p_lead_patch,p_profile);
end;
$$;

create or replace function public.organizer_get(p_id text)
returns public.tax_organizer_responses
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare v_tenant uuid;
begin
  select o.tenant_id into v_tenant
  from public.tax_organizer_responses o
  where o.id::text=p_id
  limit 1;

  if not public.tenant_is_available(v_tenant) then
    return null;
  end if;

  return public.organizer_get_unchecked(p_id);
end;
$$;

create or replace function public.organizer_save_answers(p_id text,p_answers jsonb)
returns void
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare v_tenant uuid;
begin
  select o.tenant_id into v_tenant
  from public.tax_organizer_responses o
  where o.id::text=p_id
  limit 1;

  if not public.tenant_is_available(v_tenant) then
    raise exception 'Organizer is unavailable.';
  end if;

  perform public.organizer_save_answers_unchecked(p_id,p_answers);
end;
$$;

create or replace function public.organizer_submit(p_id text,p_answers jsonb)
returns void
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare v_tenant uuid;
begin
  select o.tenant_id into v_tenant
  from public.tax_organizer_responses o
  where o.id::text=p_id
  limit 1;

  if not public.tenant_is_available(v_tenant) then
    raise exception 'Organizer is unavailable.';
  end if;

  perform public.organizer_submit_unchecked(p_id,p_answers);
end;
$$;

grant execute on function public.portal_login(text,text,text) to anon, authenticated, service_role;
grant execute on function public.financial_intake_load(text) to anon, authenticated, service_role;
grant execute on function public.financial_intake_submit(text,jsonb,jsonb,jsonb) to anon, authenticated, service_role;
grant execute on function public.organizer_get(text) to anon, authenticated, service_role;
grant execute on function public.organizer_save_answers(text,jsonb) to anon, authenticated, service_role;
grant execute on function public.organizer_submit(text,jsonb) to anon, authenticated, service_role;

commit;
