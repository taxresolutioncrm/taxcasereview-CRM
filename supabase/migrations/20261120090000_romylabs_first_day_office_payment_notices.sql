-- First-of-month product-branded notices for the two explicitly authorized RomyLabs SaaS offices.
-- Separate from the existing unpaid-only fourth-day retry. Service role only.
create table if not exists public.romylabs_first_day_office_reminders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.romylabs_billing_accounts(id) on delete restrict,
  period_month date not null,
  recipient text not null,
  amount_cents bigint not null check(amount_cents > 0),
  status text not null default 'pending' check(status in ('pending','sending','sent')),
  attempts integer not null default 0,
  last_error text,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  created_at timestamptz not null default now(),
  unique(account_id,period_month)
);
create index if not exists romylabs_first_day_office_reminders_status_idx
  on public.romylabs_first_day_office_reminders(period_month,status);
alter table public.romylabs_first_day_office_reminders enable row level security;
revoke all on public.romylabs_first_day_office_reminders from public,anon,authenticated;
grant all on public.romylabs_first_day_office_reminders to service_role;
-- 13–16 UTC spans 9–12 Eastern across daylight saving changes. Function checks
-- local America/New_York day/hour and uses one send per account per month.
select cron.schedule(
  'romylabs-first-day-office-payment-notices',
  '*/15 13-16 1 * *',
  $cron$
  select net.http_post(
    url := 'https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/romylabs-first-day-office-reminders',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-internal-cron-token',
      (select decrypted_secret from vault.decrypted_secrets where name='tcr_internal_cron_token' limit 1)
    ),
    body := '{}'::jsonb
  );
  $cron$
);