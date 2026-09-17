-- Short-lived IRS e-Services / ISP authorization sessions.
-- Tokens are written/read only by transcript-pull Edge Functions using the service role.
create table if not exists public.irs_tds_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  user_email text,
  organization_name text,
  state text unique,
  state_expires_at timestamptz,
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  access_expires_at timestamptz,
  session_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

-- Safe upgrade if an earlier sandbox draft of this table already exists.
alter table public.irs_tds_sessions
  add column if not exists refresh_token_ciphertext text,
  add column if not exists access_expires_at timestamptz,
  add column if not exists session_expires_at timestamptz;

alter table public.irs_tds_sessions enable row level security;

-- Intentionally no end-user policies. Browser clients never read tokens or session rows.
-- Authenticated CRM actions receive only safe metadata from the Edge Function.
create index if not exists idx_irs_tds_sessions_user
  on public.irs_tds_sessions(tenant_id, user_id);
create index if not exists idx_irs_tds_sessions_state
  on public.irs_tds_sessions(state)
  where state is not null;
create index if not exists idx_irs_tds_sessions_expiry
  on public.irs_tds_sessions(session_expires_at)
  where session_expires_at is not null;
