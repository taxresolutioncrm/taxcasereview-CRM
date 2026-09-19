-- Nashville IRS transcript/POA closeout indexes for 100-user scale.
create index if not exists idx_transcript_analyses_tenant_client_year
on public.transcript_analyses(tenant_id,client_id,tax_year);

create index if not exists idx_transcript_analyses_tenant_name_year
on public.transcript_analyses(tenant_id,client_name,tax_year);

create index if not exists idx_poa_records_tenant_client_status
on public.poa_records(tenant_id,client_id,status);
