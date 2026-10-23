-- Note-edit performance hotfix
-- Supports the exact tenant-scoped note-history lookup paths used by the UI.
create index if not exists client_notes_tenant_clientname_created_idx
  on public.client_notes (tenant_id, clientname, created_at desc);

create index if not exists lead_notes_tenant_lead_created_idx
  on public.lead_notes (tenant_id, lead_id, created_at desc);

create index if not exists case_notes_tenant_case_created_idx
  on public.case_notes (tenant_id, case_id, created_at desc);
