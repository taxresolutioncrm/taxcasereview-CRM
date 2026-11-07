-- Already applied in production as Supabase migration 20261107195505.
-- Widen only the existing GA4 pages-per-session value to avoid numeric overflow
-- on high page-view sessions; no data, indexes or policies are dropped.
alter table public.marketing_ga4_traffic
  alter column pages_per_session type numeric(8,2);
