-- PoolVerge Clarity aggregated dashboard cache. No visitor recordings or secrets.
-- Only the authenticated admin Edge Function can read this private data.
create table if not exists public.romylabs_poolverge_clarity_cache (
  product_id text primary key check (product_id='pool_crm'),
  project_id text not null check (project_id='z31rnrvbns'),
  metrics jsonb,
  fetched_at timestamptz,
  attempted_at timestamptz not null default '2000-01-01T00:00:00Z',
  last_error text
);
alter table public.romylabs_poolverge_clarity_cache enable row level security;
revoke all on public.romylabs_poolverge_clarity_cache from public,anon,authenticated;
grant select,insert,update on public.romylabs_poolverge_clarity_cache to service_role;
insert into public.romylabs_poolverge_clarity_cache (product_id,project_id)
values ('pool_crm','z31rnrvbns')
on conflict (product_id) do nothing;
