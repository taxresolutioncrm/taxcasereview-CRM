-- AI Resolution Analysis for central TaxRes-family client intelligence.
-- Schema only until sandbox acceptance passes.

create table if not exists public.document_ai_resolution_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id text not null,
  status text not null default 'complete' check (status in ('processing','complete','failed')),
  overall_summary text,
  top_candidate_keys jsonb not null default '[]'::jsonb,
  model text,
  error_message text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists document_ai_resolution_runs_client_idx
  on public.document_ai_resolution_runs (tenant_id, client_id, created_at desc);

create table if not exists public.document_ai_resolution_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  resolution_run_id uuid not null references public.document_ai_resolution_runs(id) on delete cascade,
  client_id text not null,
  program_key text not null,
  program_name text not null,
  family text not null default 'other',
  candidate_status text not null
    check (candidate_status in ('strong_candidate','possible_candidate','insufficient_data','not_indicated')),
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  summary text,
  why_supported jsonb not null default '[]'::jsonb,
  concerns jsonb not null default '[]'::jsonb,
  missing_information jsonb not null default '[]'::jsonb,
  likely_forms jsonb not null default '[]'::jsonb,
  next_steps jsonb not null default '[]'::jsonb,
  practitioner_note text,
  rank integer not null default 999,
  created_at timestamptz not null default now()
);

create index if not exists document_ai_resolution_candidates_client_idx
  on public.document_ai_resolution_candidates (tenant_id, client_id, rank, created_at desc);
create index if not exists document_ai_resolution_candidates_run_idx
  on public.document_ai_resolution_candidates (resolution_run_id, rank);

alter table public.document_ai_resolution_runs enable row level security;
alter table public.document_ai_resolution_candidates enable row level security;

drop policy if exists "document_ai_resolution_runs_tenant" on public.document_ai_resolution_runs;
create policy "document_ai_resolution_runs_tenant" on public.document_ai_resolution_runs
  for all to authenticated
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

drop policy if exists "document_ai_resolution_candidates_tenant" on public.document_ai_resolution_candidates;
create policy "document_ai_resolution_candidates_tenant" on public.document_ai_resolution_candidates
  for all to authenticated
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

revoke all on table public.document_ai_resolution_runs from anon;
revoke all on table public.document_ai_resolution_candidates from anon;

grant select, insert, update, delete on public.document_ai_resolution_runs to authenticated;
grant select, insert, update, delete on public.document_ai_resolution_candidates to authenticated;
