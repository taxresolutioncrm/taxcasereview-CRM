-- RETIRED — DO NOT USE.
--
-- This legacy reset targeted obsolete DEMO-001 tenant
-- 518808b4-10dd-47fd-900e-6c3fc1ff2e7e and still contained the old
-- demo@taxrescrm.com identity plus prospect-specific Nashville values.
--
-- The only supported TaxRes showcase reset is:
--   supabase/migrations/demo_reset_seed.sql
--
-- Canonical Demo tenant:
--   a0000000-0000-0000-0000-000000000001
-- Canonical login:
--   demo@taxrescrm.net
-- Canonical outbound identity:
--   romy@taxrescrm.net
--
-- This file intentionally aborts if someone runs it so an obsolete reset can
-- never wipe or rebrand another office.

DO $$
BEGIN
  RAISE EXCEPTION 'RETIRED DEMO RESET: use demo_reset_seed.sql for tenant a0000000-0000-0000-0000-000000000001';
END $$;
