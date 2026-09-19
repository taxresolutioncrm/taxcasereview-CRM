-- Nashville / TaxRes capacity hardening for sustained 100-user operation.
-- Index only the employee/session access paths that were measured or are directly used by the UI.

create index if not exists idx_employee_portal_sessions_tenant_employee_expires
on public.employee_portal_sessions(tenant_id,employee_id,expires_at desc);

create index if not exists idx_chat_channels_tenant_archived_position
on public.chat_channels(tenant_id,archived,position);

create index if not exists idx_time_entries_tenant_worker_started
on public.time_entries(tenant_id,worker_name,started_at desc);

create index if not exists idx_billing_time_tenant_employee_date
on public.billing_time_entries(tenant_id,employee_name,date desc);

create index if not exists idx_employees_tenant_status_name
on public.employees(tenant_id,status,name);


create index if not exists idx_time_off_requests_tenant_employee_created
on public.time_off_requests(tenant_id,employee_id,created_at desc);

create index if not exists idx_time_off_requests_tenant_status_created
on public.time_off_requests(tenant_id,status,created_at desc);
