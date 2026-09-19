-- FormaCorp TaxRes-family compatibility
-- Idempotent schema contract for TCR, Nashville, CloudCPA, Demo, and future TaxRes offices.
-- Keeps the native FormaCorp workflow on the same tenant-scoped database contract everywhere.

alter table public.formacorp
  add column if not exists principal_address text,
  add column if not exists mailing_address text,
  add column if not exists registered_agent_address text,
  add column if not exists authorized_representative text,
  add column if not exists authorized_representative_title text,
  add column if not exists correspondence_email text,
  add column if not exists effective_date text,
  add column if not exists registered_agent_accepted boolean not null default false,
  add column if not exists fl_registered_agent_signature text,
  add column if not exists fl_authorized_representative_signature text,
  add column if not exists fl_filing_authorized boolean not null default false,
  add column if not exists fl_authorized_at timestamptz,
  add column if not exists fl_certificate_of_status boolean not null default false,
  add column if not exists fl_certified_copy boolean not null default false,
  add column if not exists fl_filing_status text not null default 'Draft',
  add column if not exists fl_payment_status text not null default 'unpaid',
  add column if not exists fl_payment_reference text,
  add column if not exists fl_submission_method text not null default 'sunbiz_online',
  add column if not exists fl_tracking_number text,
  add column if not exists fl_pin text,
  add column if not exists fl_submitted_at timestamptz,
  add column if not exists fl_decision_at timestamptz,
  add column if not exists fl_rejection_reason text,
  add column if not exists fl_confirmation_url text,
  add column if not exists fl_state_fee numeric(10,2) not null default 125.00;

do $$ begin
  alter table public.formacorp add constraint formacorp_fl_filing_status_check
    check (fl_filing_status in ('Draft','Ready to Submit','Filing Queue','Submitted to Florida','Under State Review','Action Required','Approved / Active'));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.formacorp add constraint formacorp_fl_payment_status_check
    check (fl_payment_status in ('unpaid','received','state_paid','state_account','refunded'));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.formacorp add constraint formacorp_fl_submission_method_check
    check (fl_submission_method in ('sunbiz_online','prepaid_fax','mail'));
exception when duplicate_object then null;
end $$;

create table if not exists public.formacorp_filing_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id(),
  case_id uuid not null references public.formacorp(id) on delete cascade,
  event_type text not null default 'florida_filing',
  status text not null,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  actor_email text,
  created_at timestamptz not null default now()
);

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

create index if not exists idx_formacorp_filing_events_case on public.formacorp_filing_events(case_id, created_at desc);
create index if not exists idx_formacorp_filing_events_tenant on public.formacorp_filing_events(tenant_id);
create index if not exists idx_formacorp_lifecycle_tenant_case on public.formacorp_lifecycle(tenant_id, case_id);
create index if not exists idx_formacorp_service_requests_case on public.formacorp_service_requests(case_id, requested_at desc);
create index if not exists idx_formacorp_documents_case on public.formacorp_documents(case_id, created_at desc);

alter table public.formacorp_filing_events enable row level security;
alter table public.formacorp_lifecycle enable row level security;
alter table public.formacorp_service_requests enable row level security;
alter table public.formacorp_documents enable row level security;

revoke all on public.formacorp_filing_events from anon;
revoke all on public.formacorp_lifecycle from anon;
revoke all on public.formacorp_service_requests from anon;
revoke all on public.formacorp_documents from anon;

grant select,insert,update,delete on public.formacorp_filing_events to authenticated;
grant select,insert,update,delete on public.formacorp_lifecycle to authenticated;
grant select,insert,update,delete on public.formacorp_service_requests to authenticated;
grant select,insert,update,delete on public.formacorp_documents to authenticated;

drop policy if exists tenant_scoped_formacorp_filing_events on public.formacorp_filing_events;
create policy tenant_scoped_formacorp_filing_events on public.formacorp_filing_events
for all to authenticated
using (tenant_id=current_tenant_id())
with check (tenant_id=current_tenant_id());

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
