-- FormaCorp A-Z formation support.
-- Adds the minimum formation/payment fields needed for direct state filing workflows
-- without changing unrelated CRM tables or tenant isolation.

alter table public.formacorp
  add column if not exists fl_incorporator text,
  add column if not exists fl_authorized_shares bigint,
  add column if not exists fl_officers_directors text,
  add column if not exists formation_funds_status text not null default 'unpaid',
  add column if not exists formation_payment_reference text,
  add column if not exists formation_payment_intent_id text,
  add column if not exists state_disbursement_status text not null default 'not_paid',
  add column if not exists state_disbursement_reference text,
  add column if not exists state_disbursed_at timestamptz;

do $$ begin
  alter table public.formacorp add constraint formacorp_formation_funds_status_check
    check (formation_funds_status in ('unpaid','processing','received','refunded'));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.formacorp add constraint formacorp_state_disbursement_status_check
    check (state_disbursement_status in ('not_paid','prepaid_account','paid_to_state','refunded'));
exception when duplicate_object then null;
end $$;

create unique index if not exists formacorp_payment_intent_uidx
  on public.formacorp (formation_payment_intent_id)
  where formation_payment_intent_id is not null
    and formation_payment_intent_id <> '';
