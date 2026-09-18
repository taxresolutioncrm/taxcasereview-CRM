-- FormaCorp full post-formation lifecycle
-- Adds substantive workflows behind EIN, operating agreement, banking, compliance,
-- and ongoing company-services stages. Scoped to FormaCorp only.

create table if not exists public.formacorp_lifecycle (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id(),
  case_id uuid not null references public.formacorp(id) on delete cascade,
  service_plan text not null default 'Launch',
  selected_services jsonb not null default '[]'::jsonb,
  ein_status text not null default 'Not Started',
  ein_responsible_party_name text,
  ein_application_method text,
  ein_requested_at timestamptz,
  ein_received_at timestamptz,
  ein_confirmation_ref text,
  ss4_document_path text,
  operating_agreement_status text not null default 'Not Started',
  operating_agreement_generated_at timestamptz,
  operating_agreement_signed_at timestamptz,
  operating_agreement_path text,
  operating_agreement_esign_id text,
  banking_status text not null default 'Not Started',
  bank_name text,
  bank_account_type text,
  bank_account_last4 text,
  bank_opened_at date,
  bank_signer text,
  bank_opening_deposit numeric(12,2),
  bank_documents_ready boolean not null default false,
  banking_resolution_path text,
  bookkeeping_status text not null default 'Not Connected',
  registered_agent_status text not null default 'Client / Self',
  registered_agent_renewal_date date,
  annual_report_status text not null default 'Not Due',
  annual_report_due_date date,
  annual_report_filed_at date,
  annual_report_confirmation text,
  good_standing_status text not null default 'Unknown',
  s_corp_election_status text not null default 'Not Requested',
  s_corp_filed_at date,
  dba_status text not null default 'Not Requested',
  business_license_status text not null default 'Not Reviewed',
  foreign_qualification_status text not null default 'Not Requested',
  virtual_address_status text not null default 'Not Requested',
  compliance_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, case_id)
);

create table if not exists public.formacorp_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id(),
  case_id uuid not null references public.formacorp(id) on delete cascade,
  document_type text not null,
  file_name text not null,
  storage_path text not null,
  source text not null default 'FormaCorp',
  created_at timestamptz not null default now()
);

create table if not exists public.formacorp_service_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id(),
  case_id uuid not null references public.formacorp(id) on delete cascade,
  service_type text not null,
  status text not null default 'Requested',
  jurisdiction_state text,
  agency text,
  state_fee numeric(12,2),
  service_fee numeric(12,2),
  payment_status text not null default 'Pending',
  submission_reference text,
  due_date date,
  requested_at timestamptz not null default now(),
  submitted_at timestamptz,
  completed_at timestamptz,
  confirmation text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_formacorp_lifecycle_tenant_case on public.formacorp_lifecycle(tenant_id, case_id);
create index if not exists idx_formacorp_service_requests_case on public.formacorp_service_requests(case_id, requested_at desc);
create index if not exists idx_formacorp_documents_case on public.formacorp_documents(case_id, created_at desc);

alter table public.formacorp_lifecycle enable row level security;
alter table public.formacorp_service_requests enable row level security;
alter table public.formacorp_documents enable row level security;

revoke all on public.formacorp_lifecycle from anon;
revoke all on public.formacorp_service_requests from anon;
revoke all on public.formacorp_documents from anon;

grant select,insert,update,delete on public.formacorp_lifecycle to authenticated;
grant select,insert,update,delete on public.formacorp_service_requests to authenticated;
grant select,insert,update,delete on public.formacorp_documents to authenticated;

drop policy if exists tenant_scoped_formacorp_lifecycle on public.formacorp_lifecycle;
create policy tenant_scoped_formacorp_lifecycle on public.formacorp_lifecycle
for all to authenticated
using (tenant_id=current_tenant_id())
with check (tenant_id=current_tenant_id());

drop policy if exists tenant_scoped_formacorp_service_requests on public.formacorp_service_requests;
create policy tenant_scoped_formacorp_service_requests on public.formacorp_service_requests
for all to authenticated
using (tenant_id=current_tenant_id())
with check (tenant_id=current_tenant_id());


drop policy if exists tenant_scoped_formacorp_documents on public.formacorp_documents;
create policy tenant_scoped_formacorp_documents on public.formacorp_documents
for all to authenticated
using (tenant_id=current_tenant_id())
with check (tenant_id=current_tenant_id());
