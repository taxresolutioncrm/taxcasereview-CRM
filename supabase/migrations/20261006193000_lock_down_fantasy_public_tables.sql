-- Close Supabase security advisor finding: rls_disabled_in_public
-- These fantasy integration tables are internal runtime state and must not be
-- directly readable/writable through PostgREST by anon/authenticated users.

alter table public.fantasy_bridge_probe enable row level security;
alter table public.fantasy_league_meta enable row level security;
alter table public.fantasy_live_snapshots enable row level security;

revoke all privileges on table public.fantasy_bridge_probe from anon, authenticated;
revoke all privileges on table public.fantasy_league_meta from anon, authenticated;
revoke all privileges on table public.fantasy_live_snapshots from anon, authenticated;

-- No client-facing policies are intentionally created.
-- SECURITY DEFINER/server-side flows continue to operate with owner/service access.
