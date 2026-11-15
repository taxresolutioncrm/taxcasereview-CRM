-- Shared TCR / TaxRes / Centurion: immediately invalidate opaque sessions
-- when an employee is disabled, a client/lead is soft-deleted or an office
-- stops being active. No record deletion, no policy rewrites, no new services.
-- The server validates each session on use; this additionally revokes it at source.
CREATE OR REPLACE FUNCTION public._revoke_portal_sessions_on_identity_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $revoke$
BEGIN
  IF TG_TABLE_NAME='employees' THEN
    IF TG_OP='DELETE' THEN
      DELETE FROM public.employee_portal_sessions
        WHERE tenant_id=OLD.tenant_id AND employee_id=OLD.id;
      RETURN OLD;
    END IF;
    IF lower(coalesce(NEW.status,''))<>'active'
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.portal_pin IS DISTINCT FROM OLD.portal_pin THEN
      DELETE FROM public.employee_portal_sessions
        WHERE tenant_id=OLD.tenant_id AND employee_id=OLD.id;
    END IF;
  ELSIF TG_TABLE_NAME='clients' OR TG_TABLE_NAME='leads' THEN
    IF TG_OP='DELETE' THEN
      DELETE FROM public.portal_sessions
        WHERE tenant_id=OLD.tenant_id AND client_id=OLD.id
          AND is_lead=(TG_TABLE_NAME='leads');
      RETURN OLD;
    END IF;
    IF (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.ssn IS DISTINCT FROM OLD.ssn THEN
      DELETE FROM public.portal_sessions
        WHERE tenant_id=OLD.tenant_id AND client_id=OLD.id
          AND is_lead=(TG_TABLE_NAME='leads');
    END IF;
  ELSIF TG_TABLE_NAME='tenants' THEN
    IF TG_OP='DELETE' THEN
      DELETE FROM public.portal_sessions WHERE tenant_id=OLD.id;
      DELETE FROM public.employee_portal_sessions WHERE tenant_id=OLD.id;
      RETURN OLD;
    END IF;
    IF lower(coalesce(NEW.status,'')) NOT IN ('active','trial') THEN
      DELETE FROM public.portal_sessions WHERE tenant_id=OLD.id;
      DELETE FROM public.employee_portal_sessions WHERE tenant_id=OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$revoke$;

REVOKE ALL ON FUNCTION public._revoke_portal_sessions_on_identity_change()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._revoke_portal_sessions_on_identity_change() TO service_role;

DROP TRIGGER IF EXISTS security_employee_session_revoke ON public.employees;
CREATE TRIGGER security_employee_session_revoke
AFTER UPDATE OF status, tenant_id, portal_pin OR DELETE ON public.employees
FOR EACH ROW EXECUTE FUNCTION public._revoke_portal_sessions_on_identity_change();

DROP TRIGGER IF EXISTS security_client_session_revoke ON public.clients;
CREATE TRIGGER security_client_session_revoke
AFTER UPDATE OF deleted_at, tenant_id, ssn OR DELETE ON public.clients
FOR EACH ROW EXECUTE FUNCTION public._revoke_portal_sessions_on_identity_change();

DROP TRIGGER IF EXISTS security_lead_session_revoke ON public.leads;
CREATE TRIGGER security_lead_session_revoke
AFTER UPDATE OF deleted_at, tenant_id, ssn OR DELETE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public._revoke_portal_sessions_on_identity_change();

DROP TRIGGER IF EXISTS security_tenant_session_revoke ON public.tenants;
CREATE TRIGGER security_tenant_session_revoke
AFTER UPDATE OF status OR DELETE ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public._revoke_portal_sessions_on_identity_change();
