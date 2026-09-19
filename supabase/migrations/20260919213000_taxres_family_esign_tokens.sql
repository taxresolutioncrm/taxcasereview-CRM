-- Secure token-bound signing for the shared TaxRes family (TCR, Demo, CloudCPA).
-- Existing signing rows are backfilled; new requests receive a 64-hex token automatically.
alter table public.esigns add column if not exists signer_token text;
alter table public.esigns add column if not exists finalized_at timestamptz;

update public.esigns
set signer_token=encode(gen_random_bytes(32),'hex')
where signer_token is null or signer_token !~ '^[0-9a-f]{64}$';

alter table public.esigns
  alter column signer_token set default encode(gen_random_bytes(32),'hex');
alter table public.esigns
  alter column signer_token set not null;

create unique index if not exists esigns_signer_token_uidx
  on public.esigns(signer_token);
