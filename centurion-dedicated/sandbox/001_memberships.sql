-- CENTURION DEDICATED PROJECT ONLY. Never apply to TCR or Nashville.
-- Staging artifact; DO NOT run until existing auth-user membership inventory is verified.
BEGIN;
CREATE TABLE IF NOT EXISTS public.centurion_office_memberships (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'staff' CHECK (role IN ('staff','admin','owner')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tenant_id)
);
CREATE TABLE IF NOT EXISTS public.centurion_active_offices (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT active_membership_fk FOREIGN KEY (user_id,tenant_id)
    REFERENCES public.centurion_office_memberships(user_id,tenant_id)
);
ALTER TABLE public.centurion_office_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.centurion_active_offices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.centurion_office_memberships,public.centurion_active_offices FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.centurion_office_memberships,public.centurion_active_offices TO authenticated;
DROP POLICY IF EXISTS centurion_membership_self_read ON public.centurion_office_memberships;
CREATE POLICY centurion_membership_self_read ON public.centurion_office_memberships
 FOR SELECT TO authenticated USING (user_id = (select auth.uid()));
DROP POLICY IF EXISTS centurion_active_office_self_read ON public.centurion_active_offices;
CREATE POLICY centurion_active_office_self_read ON public.centurion_active_offices
 FOR SELECT TO authenticated USING (user_id = (select auth.uid()));

-- Backfill only existing Supabase Auth identities matching exactly one active
-- Centurion employee record. Uninvited employees have no auth user yet and
-- must continue through the established invitation process.
DO $
BEGIN
  IF EXISTS (
    SELECT lower(trim(email)) FROM public.employees
    WHERE lower(coalesce(status,''))='active' AND email IS NOT NULL
    GROUP BY lower(trim(email)) HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'Duplicate active employee email: manual reconciliation required'; END IF;
  IF EXISTS (
    SELECT 1 FROM auth.users au JOIN public.employees e
    ON lower(trim(au.email))=lower(trim(e.email))
    WHERE lower(coalesce(e.status,''))='active' AND e.tenant_id IS NULL
  ) THEN RAISE EXCEPTION 'Active authenticated employee missing tenant'; END IF;
END $;
INSERT INTO public.centurion_office_memberships(user_id,tenant_id,role)
SELECT au.id,e.tenant_id,
 CASE WHEN lower(coalesce(e.access,e.role,''))='super admin' THEN 'owner' WHEN lower(coalesce(e.access,e.role,''))='admin' THEN 'admin' ELSE 'staff' END
FROM auth.users au JOIN public.employees e
ON lower(trim(au.email))=lower(trim(e.email))
WHERE e.tenant_id IS NOT NULL AND lower(coalesce(e.status,''))='active'
ON CONFLICT(user_id,tenant_id) DO NOTHING;
INSERT INTO public.centurion_active_offices(user_id,tenant_id)
SELECT m.user_id,m.tenant_id FROM public.centurion_office_memberships m
WHERE m.active AND NOT EXISTS (
 SELECT 1 FROM public.centurion_office_memberships other
 WHERE other.user_id=m.user_id AND other.tenant_id<>m.tenant_id AND other.active
)
ON CONFLICT(user_id) DO NOTHING;
-- A dedicated platform owner must have an existing Auth account.
DO $
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM public.centurion_office_memberships WHERE role='owner' AND active
 ) THEN RAISE EXCEPTION 'No verified Centurion Super Admin login to bootstrap office owner'; END IF;
END $;
-- Enforce existing authenticated-user continuity before replacing resolver.
DO $
DECLARE n_missing integer;
BEGIN
 SELECT count(*) INTO n_missing FROM auth.users au
 JOIN public.employees e ON lower(trim(au.email))=lower(trim(e.email))
 WHERE lower(coalesce(e.status,''))='active' AND NOT EXISTS (
  SELECT 1 FROM public.centurion_active_offices x WHERE x.user_id=au.id
 );
 IF n_missing>0 THEN RAISE EXCEPTION '% active logins lack selected office',n_missing; END IF;
END $;
CREATE OR REPLACE FUNCTION public.centurion_select_office(p_tenant_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_user uuid := (select auth.uid());
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode='28000'; END IF;
 IF NOT EXISTS (
    SELECT 1 FROM public.centurion_office_memberships m
    JOIN public.tenants t ON t.id=m.tenant_id
    WHERE m.user_id=v_user AND m.tenant_id=p_tenant_id
      AND m.active AND t.status IN ('active','trial')
 ) THEN RAISE EXCEPTION 'Not a member of this office' USING errcode='42501'; END IF;
 INSERT INTO public.centurion_active_offices(user_id,tenant_id,updated_at)
 VALUES(v_user,p_tenant_id,now())
 ON CONFLICT (user_id) DO UPDATE
 SET tenant_id=excluded.tenant_id,updated_at=excluded.updated_at;
 RETURN p_tenant_id;
END $$;
REVOKE ALL ON FUNCTION public.centurion_select_office(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.centurion_select_office(uuid) TO authenticated;

-- Explicitly fail closed for unauthenticated/unselected office sessions.
-- IMPORTANT: run only after backfill + existing-user login rehearsal.
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
 SELECT a.tenant_id FROM public.centurion_active_offices a
 JOIN public.centurion_office_memberships m
   ON m.user_id=a.user_id AND m.tenant_id=a.tenant_id AND m.active
 JOIN public.tenants t ON t.id=m.tenant_id AND t.status IN ('active','trial')
 WHERE a.user_id=(select auth.uid())
 LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.current_tenant_id() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated;
COMMIT;
