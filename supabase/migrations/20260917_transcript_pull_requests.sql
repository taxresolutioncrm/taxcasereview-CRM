-- Nashville IRS transcript pull request tracker.
-- Supports the existing Pull Transcripts UI and watched-folder completion flow.
-- No IRS login automation or direct TDS/A2A credentials are stored here.

create table if not exists public.transcript_pull_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default coalesce(current_tenant_id(), '00000000-0000-0000-0000-000000000000'::uuid),
  client_name text not null,
  transcript_types text[] not null default '{}',
  tax_years text,
  provider text not null default 'manual' check (provider in ('manual','irs_a2a','partner_api')),
  status text not null default 'Requested' check (status in ('Requested','In Progress','Completed','Canceled')),
  poa_record_id uuid references public.poa_records(id) on delete set null,
  requested_by text,
  notes text,
  result_analysis_ids uuid[] not null default '{}',
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists transcript_pull_requests_tenant_requested_idx
  on public.transcript_pull_requests (tenant_id, requested_at desc);
create index if not exists transcript_pull_requests_tenant_client_idx
  on public.transcript_pull_requests (tenant_id, client_name);
create index if not exists transcript_pull_requests_tenant_status_idx
  on public.transcript_pull_requests (tenant_id, status);

alter table public.transcript_pull_requests enable row level security;

-- Self-contained RLS: every operation must satisfy BOTH Nashville tenant isolation
-- and the IRS-module permission level. These are permissive policies with the
-- full predicate so the table does not depend on unrelated/global allow policies.
drop policy if exists tenant_rls_transcript_pull_requests on public.transcript_pull_requests;
drop policy if exists module_view_transcript_pull_requests on public.transcript_pull_requests;
drop policy if exists module_edit_transcript_pull_requests_insert on public.transcript_pull_requests;
drop policy if exists module_edit_transcript_pull_requests_update on public.transcript_pull_requests;
drop policy if exists module_edit_transcript_pull_requests_delete on public.transcript_pull_requests;
drop policy if exists transcript_pull_requests_select on public.transcript_pull_requests;
drop policy if exists transcript_pull_requests_insert on public.transcript_pull_requests;
drop policy if exists transcript_pull_requests_update on public.transcript_pull_requests;
drop policy if exists transcript_pull_requests_delete on public.transcript_pull_requests;

create policy transcript_pull_requests_select
  on public.transcript_pull_requests
  for select
  to authenticated
  using (
    tenant_id = app_private.current_tenant_id()
    and app_private.permission_level('irs'::text) >= 1
  );

create policy transcript_pull_requests_insert
  on public.transcript_pull_requests
  for insert
  to authenticated
  with check (
    tenant_id = app_private.current_tenant_id()
    and app_private.permission_level('irs'::text) >= 2
  );

create policy transcript_pull_requests_update
  on public.transcript_pull_requests
  for update
  to authenticated
  using (
    tenant_id = app_private.current_tenant_id()
    and app_private.permission_level('irs'::text) >= 2
  )
  with check (
    tenant_id = app_private.current_tenant_id()
    and app_private.permission_level('irs'::text) >= 2
  );

create policy transcript_pull_requests_delete
  on public.transcript_pull_requests
  for delete
  to authenticated
  using (
    tenant_id = app_private.current_tenant_id()
    and app_private.permission_level('irs'::text) >= 2
  );

grant select, insert, update, delete on public.transcript_pull_requests to authenticated;
