-- Automatic client-focused work time. Separate from employee payroll and billable time.
-- This table never creates an invoice or billing_time_entries record.
create table if not exists public.client_work_sessions (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id text not null,
  client_name text not null,
  user_id uuid not null,
  employee_email text not null,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  elapsed_seconds integer not null default 0,
  source text not null default 'client_profile',
  constraint client_work_seconds_nonnegative check (elapsed_seconds between 0 and 86400),
  constraint client_work_source_valid check (source='client_profile')
);
create index if not exists client_work_sessions_client_lookup
  on public.client_work_sessions(tenant_id,client_id,started_at desc);
create index if not exists client_work_sessions_actor_lookup
  on public.client_work_sessions(tenant_id,user_id,started_at desc);
alter table public.client_work_sessions enable row level security;
revoke all on public.client_work_sessions from anon,authenticated;
grant select,insert,update on public.client_work_sessions to authenticated;
drop policy if exists client_work_sessions_read_tenant on public.client_work_sessions;
create policy client_work_sessions_read_tenant
  on public.client_work_sessions for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) AND (select auth.uid()) is not null);
drop policy if exists client_work_sessions_insert_self on public.client_work_sessions;
create policy client_work_sessions_insert_self
  on public.client_work_sessions for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()) AND user_id=(select auth.uid())
    and exists(select 1 from public.clients c where c.id=client_id and c.tenant_id=client_work_sessions.tenant_id));
drop policy if exists client_work_sessions_update_self on public.client_work_sessions;
create policy client_work_sessions_update_self
  on public.client_work_sessions for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) AND user_id=(select auth.uid()))
  with check (tenant_id = (select public.current_tenant_id()) AND user_id=(select auth.uid())
    and exists(select 1 from public.clients c where c.id=client_id and c.tenant_id=client_work_sessions.tenant_id));
