-- TaxRes family transcript backend hardening.
-- Source-only sandbox migration. Apply only through the normal reviewed production release.

create table if not exists public.irs_tds_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  user_email text,
  organization_name text,
  state text unique,
  state_expires_at timestamptz,
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  access_expires_at timestamptz,
  session_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,user_id)
);

alter table public.irs_tds_sessions
  add column if not exists refresh_token_ciphertext text,
  add column if not exists access_expires_at timestamptz,
  add column if not exists session_expires_at timestamptz;

alter table public.irs_tds_sessions enable row level security;
revoke all on table public.irs_tds_sessions from anon, authenticated;
grant select,insert,update,delete on table public.irs_tds_sessions to service_role;

create index if not exists idx_irs_tds_sessions_user
  on public.irs_tds_sessions(tenant_id,user_id);
create index if not exists idx_irs_tds_sessions_state
  on public.irs_tds_sessions(state) where state is not null;
create index if not exists idx_irs_tds_sessions_expiry
  on public.irs_tds_sessions(session_expires_at) where session_expires_at is not null;

alter table public.transcript_pull_requests
  add column if not exists client_id text,
  add column if not exists provider_status text,
  add column if not exists provider_request_id text,
  add column if not exists provider_error text,
  add column if not exists provider_submitted_at timestamptz,
  add column if not exists provider_last_checked_at timestamptz,
  add column if not exists provider_file_path text,
  add column if not exists provider_result_keys text[] not null default '{}'::text[],
  add column if not exists provider_file_paths text[] not null default '{}'::text[],
  add column if not exists provider_filed_keys text[] not null default '{}'::text[];

update public.transcript_pull_requests r
set client_id=p.client_id
from public.poa_records p
where r.client_id is null
  and r.poa_record_id=p.id
  and p.client_id is not null;

create index if not exists transcript_pull_requests_tenant_client_id_idx
  on public.transcript_pull_requests(tenant_id,client_id)
  where client_id is not null;

create index if not exists idx_transcript_pull_requests_provider_request
  on public.transcript_pull_requests(tenant_id,provider,provider_request_id)
  where provider_request_id is not null;

alter table public.transcript_pull_requests enable row level security;

drop policy if exists transcript_pull_requests_tenant on public.transcript_pull_requests;
drop policy if exists transcript_pull_requests_select on public.transcript_pull_requests;
drop policy if exists transcript_pull_requests_insert on public.transcript_pull_requests;
drop policy if exists transcript_pull_requests_update on public.transcript_pull_requests;
drop policy if exists transcript_pull_requests_delete on public.transcript_pull_requests;

create policy transcript_pull_requests_select
  on public.transcript_pull_requests
  for select to authenticated
  using (
    tenant_id=public.current_tenant_id()
    and public.current_employee_permission('perm_irs')>=1
  );

create policy transcript_pull_requests_insert
  on public.transcript_pull_requests
  for insert to authenticated
  with check (
    tenant_id=public.current_tenant_id()
    and public.current_employee_permission('perm_irs')>=2
  );

create policy transcript_pull_requests_update
  on public.transcript_pull_requests
  for update to authenticated
  using (
    tenant_id=public.current_tenant_id()
    and public.current_employee_permission('perm_irs')>=2
  )
  with check (
    tenant_id=public.current_tenant_id()
    and public.current_employee_permission('perm_irs')>=2
  );

create policy transcript_pull_requests_delete
  on public.transcript_pull_requests
  for delete to authenticated
  using (
    tenant_id=public.current_tenant_id()
    and public.current_employee_permission('perm_irs')>=3
  );

grant select,insert,update,delete on public.transcript_pull_requests to authenticated;
