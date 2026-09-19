-- FormaCorp Bizee partner integration contract.
-- Adds provider metadata without assuming undocumented Bizee endpoint shapes.
-- Safe for TCR, Nashville, CloudCPA, Demo, and future TaxRes offices.

alter table public.formacorp_service_requests
  add column if not exists provider text,
  add column if not exists provider_order_id text,
  add column if not exists provider_status text,
  add column if not exists provider_payload jsonb not null default '{}'::jsonb,
  add column if not exists provider_last_synced_at timestamptz,
  add column if not exists provider_error text;

create index if not exists idx_formacorp_service_requests_provider_order
  on public.formacorp_service_requests(provider, provider_order_id)
  where provider_order_id is not null;

alter table public.formacorp_documents
  add column if not exists provider text,
  add column if not exists provider_document_id text,
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb;

drop index if exists public.uq_formacorp_documents_provider_document;
create unique index if not exists uq_formacorp_documents_tenant_provider_document
  on public.formacorp_documents(tenant_id, provider, provider_document_id);

create table if not exists public.formacorp_provider_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id(),
  case_id uuid references public.formacorp(id) on delete cascade,
  service_request_id uuid references public.formacorp_service_requests(id) on delete cascade,
  provider text not null,
  provider_event_id text,
  event_type text,
  event_status text,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

create unique index if not exists uq_formacorp_provider_events_tenant_event
  on public.formacorp_provider_events(tenant_id, provider, provider_event_id);

create index if not exists idx_formacorp_provider_events_case
  on public.formacorp_provider_events(case_id, received_at desc);

alter table public.formacorp_provider_events enable row level security;
revoke all on public.formacorp_provider_events from anon;
grant select,insert,update,delete on public.formacorp_provider_events to authenticated;

drop policy if exists tenant_scoped_formacorp_provider_events on public.formacorp_provider_events;
create policy tenant_scoped_formacorp_provider_events on public.formacorp_provider_events
for all to authenticated
using (tenant_id=current_tenant_id())
with check (tenant_id=current_tenant_id());
