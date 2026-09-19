create table if not exists public.taxres_family_sso_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  employee_email text not null,
  target_app text not null,
  code_challenge text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.taxres_family_sso_codes enable row level security;

revoke all on public.taxres_family_sso_codes from public, anon, authenticated;
grant all on public.taxres_family_sso_codes to service_role;

create index if not exists taxres_family_sso_codes_expiry_idx
  on public.taxres_family_sso_codes (expires_at)
  where consumed_at is null;
