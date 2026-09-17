-- Direct IRS TDS adapter tracking. Secrets and IRS wire contract live only in the Edge Function environment.
alter table public.transcript_pull_requests
  add column if not exists provider_status text,
  add column if not exists provider_request_id text,
  add column if not exists provider_error text,
  add column if not exists provider_submitted_at timestamptz,
  add column if not exists provider_last_checked_at timestamptz,
  add column if not exists provider_file_path text,
  add column if not exists provider_result_keys text[] not null default '{}'::text[],
  add column if not exists provider_file_paths text[] not null default '{}'::text[],
  add column if not exists provider_filed_keys text[] not null default '{}'::text[];

create index if not exists idx_transcript_pull_requests_provider_request
  on public.transcript_pull_requests(tenant_id, provider, provider_request_id)
  where provider_request_id is not null;
