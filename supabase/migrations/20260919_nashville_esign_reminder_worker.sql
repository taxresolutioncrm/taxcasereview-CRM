-- Nashville legacy e-sign reminders must use the secured signer-token URL.
-- Replace the old cron target (which only swept RomyLabs office-signing envelopes)
-- with the Nashville esigns worker and authenticate it with a DB-held cron secret.

insert into public.platform_internal_secrets(key,secret,updated_at)
values(
  'nashville_esign_reminders_cron',
  encode(gen_random_bytes(32),'hex'),
  now()
)
on conflict (key) do nothing;

do $$
declare
  v_jobid bigint;
begin
  for v_jobid in
    select jobid from cron.job where jobname='nashville-esign-daily-reminders'
  loop
    perform cron.unschedule(v_jobid);
  end loop;
end
$$;

select cron.schedule(
  'nashville-esign-daily-reminders',
  '15 14 * * *',
  $cron$
  select net.http_post(
    url := 'https://ydrvncdedgjtcprczwpu.supabase.co/functions/v1/nashville-esign-reminders',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-internal-cron-token',(
        select secret from public.platform_internal_secrets
        where key='nashville_esign_reminders_cron'
      )
    ),
    body := '{}'::jsonb
  );
  $cron$
);