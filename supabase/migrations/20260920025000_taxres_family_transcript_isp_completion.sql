-- TaxRes-family IRS ISP/TDS transcript completion.
-- Additive/idempotent schema contract for the shared TaxRes backend.
-- No provider credentials or taxpayer transcript contents are embedded here.

create table if not exists public.transcript_pull_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default coalesce(current_tenant_id(), '00000000-0000-0000-0000-000000000000'::uuid),
  client_name text not null,
  transcript_types text[] not null default '{}'::text[],
  tax_years text,
  provider text not null default 'manual',
  status text not null default 'Requested',
  poa_record_id uuid references public.poa_records(id) on delete set null,
  requested_by text,
  notes text,
  result_analysis_ids uuid[] not null default '{}'::uuid[],
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

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
set client_id = p.client_id
from public.poa_records p
where r.client_id is null
  and r.poa_record_id = p.id
  and p.client_id is not null;

create index if not exists transcript_pull_requests_tenant_requested_idx
  on public.transcript_pull_requests(tenant_id, requested_at desc);
create index if not exists transcript_pull_requests_tenant_client_id_idx
  on public.transcript_pull_requests(tenant_id, client_id)
  where client_id is not null;
create index if not exists idx_transcript_pull_requests_provider_request
  on public.transcript_pull_requests(tenant_id, provider, provider_request_id)
  where provider_request_id is not null;

alter table public.transcript_pull_requests enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='transcript_pull_requests'
      and policyname='transcript_pull_requests_tenant'
  ) then
    create policy transcript_pull_requests_tenant
      on public.transcript_pull_requests
      for all to authenticated
      using (tenant_id = current_tenant_id())
      with check (tenant_id = current_tenant_id());
  end if;
end
$$;

grant select, insert, update, delete on public.transcript_pull_requests to authenticated;

create table if not exists public.irs_tds_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  user_email text,
  organization_name text,
  state text,
  state_expires_at timestamptz,
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  access_expires_at timestamptz,
  session_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.irs_tds_sessions
  add column if not exists tenant_id uuid,
  add column if not exists user_id uuid,
  add column if not exists user_email text,
  add column if not exists organization_name text,
  add column if not exists state text,
  add column if not exists state_expires_at timestamptz,
  add column if not exists access_token_ciphertext text,
  add column if not exists refresh_token_ciphertext text,
  add column if not exists access_expires_at timestamptz,
  add column if not exists session_expires_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists irs_tds_sessions_tenant_user_uidx
  on public.irs_tds_sessions(tenant_id, user_id);
create unique index if not exists irs_tds_sessions_state_uidx
  on public.irs_tds_sessions(state)
  where state is not null;
create index if not exists idx_irs_tds_sessions_expiry
  on public.irs_tds_sessions(session_expires_at)
  where session_expires_at is not null;

alter table public.irs_tds_sessions enable row level security;
revoke all on table public.irs_tds_sessions from anon, authenticated;
grant select, insert, update, delete on public.irs_tds_sessions to service_role;

alter table public.transcript_analyses
  add column if not exists client_id text,
  add column if not exists file_path text;

create index if not exists transcript_analyses_tenant_client_idx
  on public.transcript_analyses(tenant_id, client_id)
  where client_id is not null;
