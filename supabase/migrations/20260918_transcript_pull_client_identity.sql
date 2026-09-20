-- Stable client identity for transcript requests.
-- Names remain display fields, but direct IRS work must not depend on names
-- being unique inside an office.
alter table public.transcript_pull_requests
  add column if not exists client_id text;

update public.transcript_pull_requests r
set client_id = p.client_id
from public.poa_records p
where r.client_id is null
  and r.poa_record_id = p.id
  and p.client_id is not null;

create index if not exists transcript_pull_requests_tenant_client_id_idx
  on public.transcript_pull_requests(tenant_id, client_id)
  where client_id is not null;
