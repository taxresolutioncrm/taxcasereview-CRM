-- Canonical TaxRes CRM pricing tiers for standard future offices.
-- Starter $79/user/month; Professional $99/user/month; Enterprise $129/user/month.
-- Existing offices and negotiated rates are deliberately not renamed or repriced.

create or replace function public.taxres_standard_plan_rate(p_plan_tier text)
returns numeric
language sql
immutable
as $$
  select case lower(trim(coalesce(p_plan_tier,'')))
    when 'starter' then 79::numeric
    when 'professional' then 99::numeric
    when 'growth' then 99::numeric
    when 'enterprise' then 129::numeric
    when 'pro' then 129::numeric
    else null::numeric
  end
$$;

alter table public.tenants drop constraint if exists tenants_plan_tier_check;
alter table public.tenants add constraint tenants_plan_tier_check
  check (plan_tier in ('starter','professional','enterprise','growth','pro'));

create or replace function public.provision_tenant(
  p_firm_name text,
  p_tenant_code text default null,
  p_admin_name text default null,
  p_admin_email text default null,
  p_firm_phone text default null,
  p_brand_color text default null,
  p_plan_tier text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid;
  v_settings_id text;
  v_emp_id text;
  v_code text;
  v_email text := lower(trim(p_admin_email));
  v_name text := nullif(trim(coalesce(p_admin_name,'')), '');
  v_tier text := lower(coalesce(nullif(trim(p_plan_tier),''),'starter'));
  v_rate numeric;
  v_next_num int;
begin
  if not public._is_platform_admin() then
    raise exception 'Not authorized to provision a tenant.';
  end if;

  if v_tier = 'growth' then v_tier := 'professional'; end if;
  if v_tier = 'pro' then v_tier := 'enterprise'; end if;
  if v_tier not in ('starter','professional','enterprise') then v_tier := 'starter'; end if;
  v_rate := public.taxres_standard_plan_rate(v_tier);

  if p_firm_name is null or trim(p_firm_name) = '' then
    raise exception 'Firm name is required.';
  end if;
  if v_email is null or v_email = '' then
    raise exception 'Admin email is required.';
  end if;

  if p_tenant_code is not null and trim(p_tenant_code) <> '' then
    v_code := trim(p_tenant_code);
  else
    select coalesce(
      max(case when tenant_code ~ '^TRC-[0-9]+$'
               then (regexp_replace(tenant_code, '^TRC-', ''))::int
               else 0 end), 0
    ) + 1 into v_next_num from tenants;
    v_code := 'TRC-' || lpad(v_next_num::text, 3, '0');
  end if;

  if exists (select 1 from tenants where lower(tenant_code) = lower(v_code)) then
    raise exception 'Tenant code "%" is already in use.', v_code;
  end if;
  if exists (select 1 from employees where lower(email) = v_email) then
    raise exception 'An employee with email "%" already exists.', v_email;
  end if;

  insert into tenants (firm_name, tenant_code, firm_phone, plan_tier, status, brand_color, per_seat_rate, created_at)
  values (trim(p_firm_name), v_code, p_firm_phone, v_tier, 'trial', p_brand_color, v_rate, now())
  returning id into v_tenant;

  v_settings_id := 'tenant_' || replace(v_tenant::text, '-', '');
  insert into settings (id, tenant_id) values (v_settings_id, v_tenant);

  insert into employees (name, email, access, tenant_id)
  values (coalesce(v_name, split_part(v_email,'@',1)), v_email, 'Super Admin', v_tenant)
  returning id into v_emp_id;

  return jsonb_build_object(
    'ok', true,
    'tenant_id', v_tenant,
    'tenant_code', v_code,
    'settings_id', v_settings_id,
    'admin_employee_id', v_emp_id,
    'admin_email', v_email,
    'plan_tier', v_tier,
    'per_seat_rate', v_rate
  );
end $function$;

create or replace function public.update_office(
  p_tenant_id uuid,
  p_patch jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_allowed text[] := array['firm_name','firm_phone','firm_address','primary_contact_name',
    'primary_contact_email','contract_start_date','contract_end_date','monthly_rate','notes',
    'signalwire_phone_number','signalwire_project_id','plan_tier','brand_color','per_seat_rate'];
  v_set text;
  v_keys text[];
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_requested_tier text;
  v_current_tier text;
  v_current_rate numeric;
  v_current_standard numeric;
begin
  if not public._is_platform_admin() then raise exception 'Not authorized.'; end if;

  if v_patch ? 'plan_tier' then
    v_requested_tier := lower(trim(coalesce(v_patch->>'plan_tier','')));
    if v_requested_tier = 'growth' then v_requested_tier := 'professional'; end if;
    if v_requested_tier = 'pro' then v_requested_tier := 'enterprise'; end if;
    if v_requested_tier not in ('starter','professional','enterprise') then
      raise exception 'Invalid plan tier.';
    end if;

    select plan_tier, per_seat_rate
      into v_current_tier, v_current_rate
      from public.tenants where id = p_tenant_id;
    if not found then raise exception 'Office not found.'; end if;

    v_current_standard := public.taxres_standard_plan_rate(v_current_tier);
    v_patch := jsonb_set(v_patch, '{plan_tier}', to_jsonb(v_requested_tier), true);

    if not (v_patch ? 'per_seat_rate')
       and (v_current_rate is null or v_current_rate = v_current_standard) then
      v_patch := jsonb_set(
        v_patch,
        '{per_seat_rate}',
        to_jsonb(public.taxres_standard_plan_rate(v_requested_tier)),
        true
      );
    end if;
  end if;

  select array_agg(k) into v_keys
  from jsonb_object_keys(v_patch) k
  where k = any(v_allowed);

  if v_keys is null or array_length(v_keys,1) = 0 then
    return jsonb_build_object('ok', true, 'updated', 0);
  end if;

  select string_agg(format('%1$I = nullif($1->>%1$L, %2$L)::%3$s', k, '',
           case when k in ('contract_start_date','contract_end_date') then 'date'
                when k in ('monthly_rate','per_seat_rate') then 'numeric'
                else 'text' end), ', ')
  into v_set from unnest(v_keys) k;

  execute format('update tenants set %s where id = $2', v_set) using v_patch, p_tenant_id;
  return jsonb_build_object('ok', true, 'updated', array_length(v_keys,1));
end $function$;
