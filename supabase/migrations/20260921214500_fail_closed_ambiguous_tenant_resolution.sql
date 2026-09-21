-- Fail closed when one authenticated email is active in more than one tenant.
-- The previous LIMIT 1 behavior could silently choose an arbitrary office.
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with actor as (
    select lower(coalesce(auth.jwt()->>'email', auth.email(), '')) as email
  ),
  employee_tenants as (
    select array_agg(distinct e.tenant_id) as tenant_ids,
           count(distinct e.tenant_id) as tenant_count
    from public.employees e, actor a
    where lower(e.email)=a.email
      and coalesce(lower(e.status),'')='active'
  ),
  admin_override as (
    select o.tenant_id
    from public.admin_tenant_overrides o, actor a
    where public._is_platform_admin()
      and o.admin_email=a.email
      and o.updated_at > now() - interval '8 hours'
    limit 1
  )
  select coalesce(
    (select tenant_id from admin_override),
    case
      when (select tenant_count from employee_tenants)=1
        then ((select tenant_ids from employee_tenants))[1]
      else null
    end
  )
$function$;

-- Regression assertion: duplicate active cross-tenant identities must never
-- resolve nondeterministically. Keep this check explicit for future migrations.
do $$
begin
  if exists (
    select 1
    from public.employees
    where coalesce(lower(status),'')='active'
      and email is not null
    group by lower(email)
    having count(distinct tenant_id)>1
  ) then
    raise notice 'Duplicate active cross-tenant employee emails exist; current_tenant_id() will fail closed for those identities.';
  end if;
end $$;
