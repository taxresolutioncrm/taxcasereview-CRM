-- RomyLabs SaaS office-only payment reminders (separate from tenant client billing).
-- Every month on the 4th at 9 AM America/New_York, remind only accounts whose
-- subscription has not been fully paid for that month. No suspension/status changes.
create table if not exists public.romylabs_day4_payment_reminders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.romylabs_billing_accounts(id) on delete restrict,
  period_month date not null,
  recipient text not null,
  amount_cents bigint not null check (amount_cents > 0),
  status text not null default 'pending' check (status in ('pending','sending','sent')),
  attempts integer not null default 0,
  last_error text,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  created_at timestamptz not null default now(),
  unique(account_id,period_month)
);
create index if not exists romylabs_day4_payment_reminders_status_idx
  on public.romylabs_day4_payment_reminders(period_month,status);
alter table public.romylabs_day4_payment_reminders enable row level security;
-- This outbox is service-role only. No browser reads or writes.
revoke all on public.romylabs_day4_payment_reminders from anon,authenticated;
grant all on public.romylabs_day4_payment_reminders to service_role;

-- Existing Vault internal cron token; never store a token in the SQL migration.
-- Evaluate Eastern time in the Edge Function to support EST/EDT correctly.
select cron.schedule(
  'romylabs-office-day4-payment-reminders',
  '*/15 13-16 4 * *',
  $cron$
  select net.http_post(
    url := 'https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/romylabs-day4-payment-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-cron-token',
      (select decrypted_secret from vault.decrypted_secrets where name='tcr_internal_cron_token' limit 1)
    ),
    body := '{}'::jsonb
  );
  $cron$
);
