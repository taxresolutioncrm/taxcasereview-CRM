# Daily portfolio GA4 refresh

This is isolated from the existing per-product `ga4-sync` Edge Function used by the Admin Portal. The new `ga4-portfolio-refresh` function must be deployed with `verify_jwt=false`, and **always** verifies the existing `x-internal-cron-token` through `verify_internal_cron_token` before accessing the registry. Do not send the Supabase service-role key through `pg_net`.

## Deployment gate
1. CI source authorization guard, TypeScript parsing, full frontend build and build marker all green.
2. Deploy the new function, then confirm its live code, version, and `verify_jwt=false` setting. An unauthenticated POST must respond 401.
3. Confirm the Vault secret `tcr_internal_cron_token` exists (name only; do not read its value into logs).
4. Schedule exactly one `pg_cron` job, and verify the first response plus per-product `marketing_sync_log` timestamps.
5. Ensure each GA4 property remains scoped by `product_id`; skip registered products with no GA4 property.
6. Do not alter existing website analytics measurement IDs, original GA4 properties, or other cron jobs.

## Daily job (09:25 UTC)
```sql
select cron.schedule(
 'romylabs-ga4-portfolio-daily',
 '25 9 * * *',
 $job$
 select net.http_post(
  url := 'https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/ga4-portfolio-refresh',
  headers := jsonb_build_object(
    'Content-Type','application/json',
    'x-internal-cron-token',
      (select decrypted_secret from vault.decrypted_secrets
       where name='tcr_internal_cron_token' limit 1)
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 45000
 );
 $job$
);
```

The coordinator uses up to three concurrent calls to the existing GA4 function. Failed products must be visible as failures, not silently marked successful. Inspect `cron.job_run_details`, `net._http_response`, and `marketing_sync_log` after rollout. Avoid dumping decrypted tokens in any result or diagnostics.
