-- Keep both LinkedIn queues replenished without relying on a Monday-only generator.
do $$
declare r record;
begin
  for r in select jobid from cron.job where jobname in ('linkedin-taxres-queue-autopilot','linkedin-arcvena-queue-autopilot') loop
    perform cron.unschedule(r.jobid);
  end loop;
end $$;

select cron.schedule(
  'linkedin-taxres-queue-autopilot','11 * * * *',
  $job$
  select net.http_post(
    url := 'https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/linkedin-scheduler',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-internal-cron-token',
      (select decrypted_secret from vault.decrypted_secrets where name='tcr_internal_cron_token' limit 1)
    ),
    body := '{"action":"generate_content","product_id":"taxres_crm"}'::jsonb
  );
  $job$
);

select cron.schedule(
  'linkedin-arcvena-queue-autopilot','12 * * * *',
  $job$
  select net.http_post(
    url := 'https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/linkedin-scheduler',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-internal-cron-token',
      (select decrypted_secret from vault.decrypted_secrets where name='tcr_internal_cron_token' limit 1)
    ),
    body := '{"action":"generate_content","product_id":"arcvena"}'::jsonb
  );
  $job$
);
