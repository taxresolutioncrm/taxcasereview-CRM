-- Automatically scan every configured Stalwart mailbox for calendar invites.
-- The edge function discovers Stalwart-backed products dynamically from the
-- credential vault, so this also works after mailboxes are consolidated.

do $$
declare
  j record;
begin
  for j in select jobid from cron.job where jobname = 'stalwart-calendar-sync'
  loop
    perform cron.unschedule(j.jobid);
  end loop;
end $$;

select cron.schedule(
  'stalwart-calendar-sync',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/stalwart-calendar-sync',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-internal-cron-token',
      (select decrypted_secret from vault.decrypted_secrets where name='tcr_internal_cron_token' limit 1)
    ),
    body := '{"limit":75}'::jsonb
  );
  $job$
);
