-- Restore the QA employee visibility policy as RESTRICTIVE.
-- A 2026-09-20 optimization migration accidentally recreated this SELECT policy
-- as PERMISSIVE. PostgreSQL ORs permissive policies, so that policy bypassed the
-- tenant_isolation SELECT condition for every non-QA employee and exposed
-- legacy Nashville employee rows in TCR staff pickers / Team Chat.
--
-- This policy is intentionally filter-only. tenant_isolation remains the
-- authorization policy; this one may only further restrict rows.

drop policy if exists hide_qa_certification_employees_from_staff on public.employees;

create policy hide_qa_certification_employees_from_staff
on public.employees
as restrictive
for select
to authenticated
using (
  (
    coalesce(notes,'') not ilike 'TEMP QA%'
    and coalesce(id,'') not like 'qa_%'
    and coalesce(email,'') not like 'qa_%@%'
  )
  or lower(coalesce(email,'')) = lower(coalesce((select auth.jwt()->>'email'),''))
);

do $$
declare
  v_permissive text;
begin
  select permissive
    into v_permissive
  from pg_policies
  where schemaname='public'
    and tablename='employees'
    and policyname='hide_qa_certification_employees_from_staff';

  if v_permissive is distinct from 'RESTRICTIVE' then
    raise exception 'Employee QA visibility policy must be RESTRICTIVE, found %', coalesce(v_permissive,'missing');
  end if;
end $$;
