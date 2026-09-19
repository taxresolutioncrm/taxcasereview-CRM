create table if not exists public.platform_internal_secrets (
  key text primary key,
  secret text not null,
  updated_at timestamptz not null default now()
);

alter table public.platform_internal_secrets enable row level security;
revoke all on table public.platform_internal_secrets from anon, authenticated;
grant select, insert, update, delete on table public.platform_internal_secrets to service_role;

comment on table public.platform_internal_secrets is
  'Service-role-only shared secrets for RomyLabs internal server-to-server integrations.';
