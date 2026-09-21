-- TaxRes family e-file transmission audit and tenant-scoped return tracking
alter table if exists public.tax_returns
  add column if not exists efile_provider text,
  add column if not exists efile_submission_id text,
  add column if not exists efile_ack_number text,
  add column if not exists efile_status text,
  add column if not exists efile_submitted_at timestamptz;

create table if not exists public.efile_submissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  tax_return_id uuid references public.tax_returns(id) on delete cascade,
  provider text not null,
  provider_submission_id text,
  acknowledgement_number text,
  status text not null default 'submitted',
  error_message text,
  requested_by text,
  provider_response jsonb,
  created_at timestamptz not null default now()
);

create index if not exists efile_submissions_tenant_created_idx
  on public.efile_submissions(tenant_id, created_at desc);

alter table public.efile_submissions enable row level security;

drop policy if exists "efile_submissions_tenant_read" on public.efile_submissions;
create policy "efile_submissions_tenant_read"
  on public.efile_submissions
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

revoke insert, update, delete on public.efile_submissions from authenticated, anon;
grant select on public.efile_submissions to authenticated;
