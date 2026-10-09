-- Production stability repair for RomyLabs realtime metrics.
-- Primary updates remain event-driven. These jobs are recovery-only and must not run every minute.
do $$
declare r record;
begin
  for r in
    select jobid
    from cron.job
    where jobname in (
      'romylabs-admin-metrics-trigger-watchdog',
      'romylabs-metrics-watchdog'
    )
  loop
    perform cron.unschedule(r.jobid);
  end loop;
end $$;

select cron.schedule(
  'romylabs-admin-metrics-trigger-watchdog',
  '17 * * * *',
  $job$select public.romylabs_install_metrics_change_triggers();$job$
);

select cron.schedule(
  'romylabs-metrics-watchdog',
  '7,22,37,52 * * * *',
  $job$
  select net.http_post(
    url := 'https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/hub-proxy',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-internal-cron-token',
      (select decrypted_secret
       from vault.decrypted_secrets
       where name='tcr_internal_cron_token'
       limit 1)
    ),
    body := '{"action":"refresh_stale_metrics"}'::jsonb,
    timeout_milliseconds := 1000
  );
  $job$
);
