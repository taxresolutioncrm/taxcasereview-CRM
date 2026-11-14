-- Scoped security hardening for employee-portal RPCs.
-- Alter function configuration only: preserve the function bodies, signatures,
-- existing portal-token authentication and EXECUTE grants.
ALTER FUNCTION public.emp_clients(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.emp_cases(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.emp_sms_threads(text) SET search_path = public, pg_temp;
