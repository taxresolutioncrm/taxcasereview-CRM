-- Shared Tax CRM: opt-in server-enforced TOTP MFA.
-- The project currently has no verified MFA factors. Existing staff remain able
-- to enroll; once a user verifies a factor, an aal1 session cannot resolve
-- tenant permissions or platform-admin privileges until factor challenge.
-- service_role unaffected. Do not force enrollment before tested account recovery.
CREATE OR REPLACE FUNCTION public._mfa_assurance_sufficient()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO pg_catalog, auth, public, pg_temp
AS $mfa$
 SELECT CASE
   WHEN auth.role()='service_role' THEN true
   WHEN auth.uid() IS NULL THEN false
   WHEN EXISTS (
     SELECT 1 FROM auth.mfa_factors f
     WHERE f.user_id=auth.uid() AND f.status::text='verified'
   ) THEN coalesce(auth.jwt()->>'aal','aal1')='aal2'
   ELSE true
 END;
$mfa$;
REVOKE ALL ON FUNCTION public._mfa_assurance_sufficient() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._mfa_assurance_sufficient() TO service_role;

CREATE OR REPLACE FUNCTION public._is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public, pg_temp
AS $owner$
 SELECT auth.role()='service_role'
   OR (public._mfa_assurance_sufficient() AND lower(coalesce(auth.jwt()->>'email',auth.email(),'')) IN (
     'info@romylabs.com','romy@romylabs.com','romy@taxrescrm.net','romy@taxcasereview.org'
   ));
$owner$;

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public, pg_temp
AS $tenant$
 SELECT CASE WHEN public._mfa_assurance_sufficient() THEN coalesce(
   CASE WHEN public._is_platform_admin() THEN (
     SELECT o.tenant_id FROM public.admin_tenant_overrides o
     JOIN public.tenants t ON t.id=o.tenant_id
     WHERE o.admin_email=lower(coalesce(auth.jwt()->>'email',auth.email(),''))
       AND o.updated_at>now()-interval '8 hours'
       AND lower(coalesce(t.status,'')) IN ('active','trial')
     LIMIT 1
   ) END,
   (
     SELECT t.id FROM public.tenants t
     JOIN public.employees e ON e.tenant_id=t.id
     WHERE lower(e.email)=lower(coalesce(auth.jwt()->>'email',auth.email(),''))
       AND coalesce(lower(e.status),'')='active'
       AND lower(coalesce(t.status,'')) IN ('active','trial')
     LIMIT 1
   )
 ) ELSE null::uuid END;
$tenant$;
