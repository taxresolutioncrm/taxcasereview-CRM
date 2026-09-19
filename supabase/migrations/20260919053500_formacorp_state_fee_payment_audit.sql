-- FormaCorp government filing funds audit trail.
-- Tracks collection and remittance separately so the CRM can collect the exact
-- state filing amount using the existing Stripe stack without a FormaCorp surcharge.

alter table public.formacorp
  add column if not exists state_fee_amount numeric(12,2),
  add column if not exists state_fee_payment_status text not null default 'unpaid',
  add column if not exists state_fee_payment_reference text,
  add column if not exists state_fee_collected_amount numeric(12,2),
  add column if not exists state_fee_payment_intent_id text,
  add column if not exists state_fee_collected_at timestamptz,
  add column if not exists state_fee_remitted_at timestamptz,
  add column if not exists state_fee_remittance_reference text,
  add column if not exists state_fee_refunded_at timestamptz;

create unique index if not exists ux_formacorp_state_fee_payment_intent
  on public.formacorp(state_fee_payment_intent_id)
  where state_fee_payment_intent_id is not null;

do $$ begin
  alter table public.formacorp add constraint formacorp_state_fee_payment_status_check
    check (state_fee_payment_status in ('unpaid','received','remitted','refunded'));
exception when duplicate_object then null;
end $$;
