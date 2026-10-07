-- Fast, centrally cached Nashville metrics for the Admin Portal.
create table if not exists public.romylabs_metrics_cache (
  product_key text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.romylabs_metrics_cache enable row level security;
revoke all on table public.romylabs_metrics_cache from public, anon, authenticated;

insert into public.romylabs_metrics_cache(product_key,payload,fetched_at,updated_at)
values (
  'nashville',
  jsonb_build_object(
    'ok',true,
    'product','nashville_tax_solutions',
    'product_label','Nashville Tax Solutions',
    'tenant_id','489ace07-1a6b-4864-833a-4f8420568b40',
    'fetched_at','2026-10-07T15:07:27.112676+00:00',
    'metrics',jsonb_build_object(
      'mrr',0,
      'arr',0,
      'total_clients',2250,
      'active_staff',25,
      'active_users',25,
      'active_cases',755,
      'storage_bytes',70583205550,
      'storage_objects',73474,
      'last_activity','2026-10-07T15:07:27.112676+00:00',
      'active_offices',1,
      'total_offices',1
    ),
    'offices',jsonb_build_array(jsonb_build_object(
      'id','489ace07-1a6b-4864-833a-4f8420568b40',
      'name','Nashville Tax Solutions',
      'is_active',true,
      'mrr',0,
      'employee_count',25,
      'active_staff',25,
      'total_clients',2250,
      'client_count',2250,
      'job_count',755,
      'active_cases',755,
      'storage_bytes',70583205550,
      'storage_objects',73474,
      'storage_files',73474,
      'last_activity','2026-10-07T15:07:27.112676+00:00'
    )),
    'recent_activity',jsonb_build_array(jsonb_build_object(
      'ts','2026-10-07T15:07:27.112676+00:00',
      'text','Nashville CRM activity'
    ))
  ),
  '2026-10-07T15:07:27.112676+00:00'::timestamptz,
  now()
)
on conflict (product_key) do update
set payload=excluded.payload,
    fetched_at=excluded.fetched_at,
    updated_at=now();

do $$
declare r record;
begin
  for r in select jobid from cron.job where jobname='nashville-metrics-cache-refresh' loop
    perform cron.unschedule(r.jobid);
  end loop;
end $$;

select cron.schedule(
  'nashville-metrics-cache-refresh',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := 'https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/hub-proxy',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-internal-cron-token',
      (select decrypted_secret from vault.decrypted_secrets where name='tcr_internal_cron_token' limit 1)
    ),
    body := '{"action":"refresh_nashville_metrics"}'::jsonb
  );
  $job$
);
