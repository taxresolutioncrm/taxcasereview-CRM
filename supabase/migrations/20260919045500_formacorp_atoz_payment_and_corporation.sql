-- FormaCorp A-Z formation support: corporation intake and state-fee collection audit.
-- No provider/service surcharge is introduced; state_fee_* tracks funds collected
-- for the government filing and later remittance through the supported state channel.

alter table public.formacorp
  add column if not exists corporation_shares bigint,
  add column if not exists corporation_par_value numeric(12,4),
  add column if not exists incorporator_name text,
  add column if not exists incorporator_address text,
  add column if not exists officers_directors text,
  add column if not exists articles_additional_provisions text,
  add column if not exists state_fee_collected_amount numeric(12,2),
  add column if not exists state_fee_payment_intent_id text,
  add column if not exists state_fee_collected_at timestamptz,
  add column if not exists state_fee_remitted_at timestamptz,
  add column if not exists state_fee_remittance_reference text,
  add column if not exists state_fee_refunded_at timestamptz;

create unique index if not exists ux_formacorp_state_fee_payment_intent
  on public.formacorp(state_fee_payment_intent_id)
  where state_fee_payment_intent_id is not null;
