-- Allow the browser-assisted IRS TDS request provider.
-- Scoped to transcript_pull_requests only. Existing providers remain valid.

alter table public.transcript_pull_requests
  drop constraint if exists transcript_pull_requests_provider_check;

alter table public.transcript_pull_requests
  add constraint transcript_pull_requests_provider_check
  check (provider = any (array[
    'manual'::text,
    'irs_a2a'::text,
    'partner_api'::text,
    'irs_browser'::text
  ]));
