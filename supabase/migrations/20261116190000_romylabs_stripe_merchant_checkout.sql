-- RomyLabs merchant-only Stripe integration. Never mix with CRM tenant payments.
create table if not exists public.romylabs_stripe_settings (
  id boolean primary key default true check(id),
  stripe_account_id text,
  mode text not null default 'disabled' check(mode in ('disabled','test','live')),
  webhook_configured boolean not null default false,
  webhook_verified_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.romylabs_stripe_settings(id,mode) values(true,'disabled') on conflict(id) do nothing;
alter table public.romylabs_stripe_settings enable row level security;
revoke all on public.romylabs_stripe_settings from public,anon,authenticated;
grant select,insert,update on public.romylabs_stripe_settings to service_role;

create table if not exists public.romylabs_stripe_checkout_sessions (
  session_id text primary key,
  invoice_id uuid not null references public.romylabs_invoices(id) on delete restrict,
  amount_cents bigint not null check(amount_cents>0),
  currency text not null default 'usd',
  livemode boolean not null,
  status text not null default 'created',
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists romylabs_stripe_checkout_invoice_idx
 on public.romylabs_stripe_checkout_sessions(invoice_id);
alter table public.romylabs_stripe_checkout_sessions enable row level security;
revoke all on public.romylabs_stripe_checkout_sessions from public,anon,authenticated;
grant select,insert,update on public.romylabs_stripe_checkout_sessions to service_role;

create table if not exists public.romylabs_stripe_webhook_events(
  event_id text primary key,
  event_type text not null,
  livemode boolean not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text
);
alter table public.romylabs_stripe_webhook_events enable row level security;
revoke all on public.romylabs_stripe_webhook_events from public,anon,authenticated;
grant select,insert,update on public.romylabs_stripe_webhook_events to service_role;

-- Store merchant secrets only in Supabase Vault. This service-role-only RPC is
-- never exposed to the browser; the Edge Function verifies platform admin auth.
create or replace function public.romylabs_stripe_merchant_secret(
  p_name text, p_new_value text default null
) returns text language plpgsql security definer
set search_path=pg_catalog,public,vault,pg_temp
as $$
declare v_id uuid; v_val text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_name not in ('romylabs_stripe_test_key','romylabs_stripe_live_key',
                    'romylabs_stripe_test_webhook','romylabs_stripe_live_webhook')
  then raise exception 'Invalid merchant secret name'; end if;
  if p_new_value is not null then
    if length(p_new_value)<20 or length(p_new_value)>500 then
      raise exception 'Invalid merchant secret length';
    end if;
    select id into v_id from vault.secrets where name=p_name limit 1;
    if v_id is null then perform vault.create_secret(p_new_value,p_name,'RomyLabs merchant Stripe configuration');
    else perform vault.update_secret(v_id,p_new_value); end if;
  end if;
  select decrypted_secret into v_val from vault.decrypted_secrets where name=p_name limit 1;
  return v_val;
end $$;
revoke all on function public.romylabs_stripe_merchant_secret(text,text) from public,anon,authenticated;
grant execute on function public.romylabs_stripe_merchant_secret(text,text) to service_role;
