-- Nashville 100-user scale closeout.
-- Keeps the current UI/feature set while removing tenant-wide reloads and hot-path scans.

create index if not exists idx_employee_portal_sessions_tenant_employee_expires
on public.employee_portal_sessions(tenant_id,employee_id,expires_at desc);

create index if not exists idx_chat_channels_tenant_archived_position
on public.chat_channels(tenant_id,archived,position);

create index if not exists idx_time_entries_tenant_worker_started
on public.time_entries(tenant_id,worker_name,started_at desc);

create index if not exists idx_billing_time_tenant_employee_date
on public.billing_time_entries(tenant_id,employee_name,date desc);

create index if not exists idx_invoices_tenant_client_created
on public.invoices(tenant_id,client_id,created_at desc);

create index if not exists idx_payments_tenant_client_created
on public.payments(tenant_id,client_id,created_at desc);

create index if not exists idx_sms_tenant_client_created
on public.sms_messages(tenant_id,client_id,created_at desc);

create index if not exists idx_deadlines_tenant_client_due
on public.deadlines(tenant_id,client_id,"dueDate");

create index if not exists idx_formacorp_lifecycle_case_id
on public.formacorp_lifecycle(case_id);

create index if not exists idx_transcript_pull_requests_poa_record_id
on public.transcript_pull_requests(poa_record_id);

alter policy employees_tenant_select
on public.employees
using (
  lower(coalesce(email,'')) = lower(coalesce((select auth.jwt()) ->> 'email',''))
  or tenant_id = (select app_private.current_tenant_id())
);

alter policy hide_qa_certification_employees_from_staff
on public.employees
using (
  lower(coalesce(email,'')) not like 'qa-nash-%@taxrescrm.net'
  or lower(coalesce(email,'')) = lower(coalesce((select auth.jwt()) ->> 'email',''))
);

alter policy activity_log_staff_insert
on public.activity_log
with check (
  exists (
    select 1
    from public.employees e
    where e.tenant_id = (select app_private.current_tenant_id())
      and lower(e.email) = lower(coalesce((select auth.jwt()) ->> 'email',''))
      and e.status='Active'
  )
);

alter policy module_edit_tds_active_sessions_delete
on public.tds_active_sessions
using (
  (select app_private.permission_level('irs')) >= 2
  and user_id = (select auth.uid())
);

alter policy module_edit_tds_active_sessions_insert
on public.tds_active_sessions
with check (
  (select app_private.permission_level('irs')) >= 2
  and user_id = (select auth.uid())
);

alter policy module_edit_tds_active_sessions_update
on public.tds_active_sessions
using (
  (select app_private.permission_level('irs')) >= 2
  and user_id = (select auth.uid())
)
with check (
  (select app_private.permission_level('irs')) >= 2
  and user_id = (select auth.uid())
);

drop policy if exists tenant_rls_verizon_call_details on public.verizon_call_details;
create policy tenant_rls_verizon_call_details
on public.verizon_call_details
as restrictive
for all
to authenticated
using (tenant_id = (select app_private.current_tenant_id()))
with check (tenant_id = (select app_private.current_tenant_id()));

alter policy platform_owner_office_billing_read
on public.office_billing_payments
using (lower(coalesce((select auth.jwt()) ->> 'email','')) = 'romy@taxrescrm.net');

alter policy platform_owner_office_documents_all
on public.office_documents
using (lower(coalesce((select auth.jwt()) ->> 'email','')) = 'romy@taxrescrm.net')
with check (lower(coalesce((select auth.jwt()) ->> 'email','')) = 'romy@taxrescrm.net');
