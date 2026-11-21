-- Admin-controlled monthly reminder schedule, independently overridable by CRM
-- and individual SaaS office. Null = inherit; explicit false pauses delivery.
-- The existing service-only outbox still enforces one email per account/month.
alter table public.romylabs_monthly_reminder_content
  add column if not exists send_day smallint,
  add column if not exists send_time text,
  add column if not exists send_timezone text,
  add column if not exists is_enabled boolean;
alter table public.romylabs_monthly_reminder_content
  drop constraint if exists romylabs_reminder_send_day_valid,
  add constraint romylabs_reminder_send_day_valid
    check (send_day between 1 and 31),
  drop constraint if exists romylabs_reminder_send_time_valid,
  add constraint romylabs_reminder_send_time_valid
    check (send_time ~ '^(?:[01][0-9]|2[0-3]):(?:00|15|30|45)$'),
  drop constraint if exists romylabs_reminder_timezone_valid,
  add constraint romylabs_reminder_timezone_valid
    check (send_timezone in (
      'America/New_York','America/Chicago','America/Denver',
      'America/Los_Angeles','America/Phoenix','America/Anchorage',
      'Pacific/Honolulu','America/Puerto_Rico','America/Toronto',
      'America/Santo_Domingo','UTC'
    ));
-- The existing first-day cron job name is retained so scheduling is changed
-- in place without creating a parallel sender. Every 15 minutes permits all
-- configured local times and time zones. The function checks due-time itself.
select cron.schedule(
  'romylabs-first-day-office-payment-notices',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := 'https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/romylabs-first-day-office-reminders',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-internal-cron-token',
      (select decrypted_secret from vault.decrypted_secrets
       where name='tcr_internal_cron_token' limit 1)
    ),
    body := '{}'::jsonb
  );
  $cron$
);
