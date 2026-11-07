-- Already applied in production as Supabase migration 20261107195601.
-- Invokes the existing authenticated GA4 coordinator once daily.
-- Uses the encrypted cron token from Vault, NOT the Supabase service role key.
select cron.schedule(
  'romylabs-ga4-portfolio-daily',
  '25 9 * * *',
  $job$
  select net.http_post(
    url := 'https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/ga4-portfolio-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-cron-token',
        (select decrypted_secret from vault.decrypted_secrets where name = 'tcr_internal_cron_token' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);
