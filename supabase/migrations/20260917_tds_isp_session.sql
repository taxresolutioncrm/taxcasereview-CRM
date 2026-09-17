-- Short-lived IRS e-Services / ISP authorization sessions.
-- Tokens are written/read only by the transcript-pull Edge Function service role.
create table if not exists public.irs_tds_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  user_email text,
  organization_name text,
  state text unique,
  state_expires_at timestamptz,
  pkce_verifier_ciphertext text,
  access_token_ciphertext text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

alter table public.irs_tds_sessions enable row level security;

-- Intentionally no end-user policies. Browser clients never read tokens or session rows.
-- The authenticated Edge Function returns only safe session metadata.
create index if not exists idx_irs_tds_sessions_user
  on public.irs_tds_sessions(tenant_id, user_id);
create index if not exists idx_irs_tds_sessions_state
  on public.irs_tds_sessions(state)
  where state is not null;
create index if not exists idx_irs_tds_sessions_expiry
  on public.irs_tds_sessions(expires_at)
  where expires_at is not null;
