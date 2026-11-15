-- Defense in depth: session tokens must be revoked when their identity's
-- permissions or verified contact address changes, not only when deactivated.
-- Also remove expired / already-invalid tokens, never customer records.
DO $patch$
DECLARE v_src text; v_emp text; v_client text; v_before integer; v_after integer;
BEGIN
 SELECT pg_get_functiondef('public._revoke_portal_sessions_on_identity_change()'::regprocedure) INTO v_src;
 v_emp:='OR NEW.portal_pin IS DISTINCT FROM OLD.portal_pin THEN';
 v_client:='OR NEW.ssn IS DISTINCT FROM OLD.ssn THEN';
 IF position(v_emp IN v_src)=0 OR position(v_client IN v_src)=0 THEN
   RAISE EXCEPTION 'Unknown current portal revocation function version';
 END IF;
 v_src:=replace(v_src,v_emp,
   'OR NEW.portal_pin IS DISTINCT FROM OLD.portal_pin'
   || E'\n       OR NEW.email IS DISTINCT FROM OLD.email'
   || E'\n       OR NEW.access IS DISTINCT FROM OLD.access'
   || E'\n       OR ROW(NEW.perm_leads,NEW.perm_clients,NEW.perm_billing,NEW.perm_schedule,NEW.perm_documents,NEW.perm_irs,NEW.perm_comms,NEW.perm_reports,NEW.perm_hr,NEW.perm_settings)'
   || E'\n          IS DISTINCT FROM ROW(OLD.perm_leads,OLD.perm_clients,OLD.perm_billing,OLD.perm_schedule,OLD.perm_documents,OLD.perm_irs,OLD.perm_comms,OLD.perm_reports,OLD.perm_hr,OLD.perm_settings) THEN');
 v_src:=replace(v_src,v_client,
   'OR NEW.ssn IS DISTINCT FROM OLD.ssn'
   || E'\n       OR NEW.email IS DISTINCT FROM OLD.email THEN');
 EXECUTE v_src;
 IF position('ROW(NEW.perm_leads' IN pg_get_functiondef('public._revoke_portal_sessions_on_identity_change()'::regprocedure))=0 THEN
   RAISE EXCEPTION 'Post-patch employee permission checks missing';
 END IF;
END $patch$;

DROP TRIGGER IF EXISTS security_employee_session_revoke ON public.employees;
CREATE TRIGGER security_employee_session_revoke
AFTER UPDATE OF status, tenant_id, portal_pin, email, access,
  perm_leads, perm_clients, perm_billing, perm_schedule, perm_documents,
  perm_irs, perm_comms, perm_reports, perm_hr, perm_settings
OR DELETE ON public.employees
FOR EACH ROW EXECUTE FUNCTION public._revoke_portal_sessions_on_identity_change();

DROP TRIGGER IF EXISTS security_client_session_revoke ON public.clients;
CREATE TRIGGER security_client_session_revoke
AFTER UPDATE OF deleted_at, tenant_id, ssn, email OR DELETE ON public.clients
FOR EACH ROW EXECUTE FUNCTION public._revoke_portal_sessions_on_identity_change();

DROP TRIGGER IF EXISTS security_lead_session_revoke ON public.leads;
CREATE TRIGGER security_lead_session_revoke
AFTER UPDATE OF deleted_at, tenant_id, ssn, email OR DELETE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public._revoke_portal_sessions_on_identity_change();

-- Existing sessions may predate the revoke-on-deactivation triggers.
-- Delete expired and invalid tokens only; do not touch still-valid sessions.
DELETE FROM public.employee_portal_sessions s
WHERE s.expires_at<=now() OR NOT EXISTS (
  SELECT 1 FROM public.employees e
  JOIN public.tenants t ON t.id=e.tenant_id
  WHERE e.id=s.employee_id AND e.tenant_id=s.tenant_id
    AND lower(coalesce(e.status,''))='active'
    AND lower(coalesce(t.status,'')) IN ('active','trial')
);
DELETE FROM public.portal_sessions s
WHERE s.expires_at<=now()
   OR NOT EXISTS (
      SELECT 1 FROM public.tenants t
      WHERE t.id=s.tenant_id AND lower(coalesce(t.status,'')) IN ('active','trial')
   )
   OR (s.is_lead AND NOT EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id=s.client_id AND l.tenant_id=s.tenant_id AND l.deleted_at IS NULL
   ))
   OR (NOT s.is_lead AND NOT EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id=s.client_id AND c.tenant_id=s.tenant_id AND c.deleted_at IS NULL
   ));
