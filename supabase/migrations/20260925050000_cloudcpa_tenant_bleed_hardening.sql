-- CloudCPA / TaxRes tenant bleed hardening.
-- The employee QA visibility policy was PERMISSIVE and did not include a
-- tenant predicate. Because PostgreSQL ORs permissive SELECT policies, it
-- bypassed the tenant_isolation policy and exposed non-QA employees from
-- every office to authenticated users.
--
-- Keep the QA hiding behavior, but make it a restrictive tenant-aware guard.

drop policy if exists hide_qa_certification_employees_from_staff on public.employees;
create policy hide_qa_certification_employees_from_staff
on public.employees
as restrictive
for select
to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (
    (
      coalesce(notes,'') not ilike 'TEMP QA%'
      and coalesce(id,'') not like 'qa_%'
      and coalesce(email,'') not like 'qa_%@%'
    )
    or lower(coalesce(email,'')) = lower(coalesce((select auth.jwt()->>'email'),''))
  )
);

-- Platform admins may administer all tenants from the RomyLabs portal, but
-- inside a Jump-In CRM session chat preferences must follow the selected
-- tenant. Remove the platform-admin bypass from these tenant-owned tables.
drop policy if exists chat_rep_prefs_access on public.chat_rep_prefs;
create policy chat_rep_prefs_access
on public.chat_rep_prefs
for all
to authenticated
using (tenant_id = (select public.current_tenant_id()))
with check (tenant_id = (select public.current_tenant_id()));

drop policy if exists chat_conv_prefs_access on public.chat_conv_prefs;
create policy chat_conv_prefs_access
on public.chat_conv_prefs
for all
to authenticated
using (tenant_id = (select public.current_tenant_id()))
with check (tenant_id = (select public.current_tenant_id()));
