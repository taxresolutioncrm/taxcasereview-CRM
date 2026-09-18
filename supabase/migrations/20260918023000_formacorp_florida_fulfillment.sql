-- FormaCorp Florida fulfillment workflow
-- Adds operational filing state, authorization, submission tracking, and audit events
-- without changing unrelated CRM tables or permissions.

alter table public.formacorp
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

create index if not exists idx_formacorp_filing_events_case on public.formacorp_filing_events(case_id, created_at desc);
create index if not exists idx_formacorp_filing_events_tenant on public.formacorp_filing_events(tenant_id);

alter table public.formacorp_filing_events enable row level security;

drop policy if exists tenant_scoped_formacorp_filing_events on public.formacorp_filing_events;
create policy tenant_scoped_formacorp_filing_events on public.formacorp_filing_events
for all to authenticated
using (tenant_id = current_tenant_id())
with check (tenant_id = current_tenant_id());
