-- Make the employee visibility guard restrictive so it cannot OR around tenant isolation.
-- The previous permissive SELECT policy allowed non-QA employees from every tenant
-- to satisfy RLS even when tenant_isolation did not match.
drop policy if exists hide_qa_certification_employees_from_staff on public.employees;

create policy hide_qa_certification_employees_from_staff
on public.employees
as restrictive
for select
to authenticated
using (
  (
    coalesce(notes, '') not ilike 'TEMP QA%'
    and coalesce(id, '') not like 'qa_%'
    and coalesce(email, '') not like 'qa_%@%'
  )
  or lower(coalesce(email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
);
