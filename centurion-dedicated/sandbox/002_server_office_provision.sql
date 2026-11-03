-- Dedicated Centurion Supabase project only.
-- Service-role-only creation. Called by a dedicated Edge Function which
-- independently checks caller JWT, owner membership and selected office.
CREATE OR REPLACE FUNCTION public.centurion_create_office(
 p_code text, p_name text, p_admin_user uuid, p_owner_user uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_id uuid;
BEGIN
 IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role'
 THEN RAISE EXCEPTION 'Server authorization required' USING errcode='42501'; END IF;
 IF nullif(trim(p_code),'') IS NULL OR nullif(trim(p_name),'') IS NULL
 THEN RAISE EXCEPTION 'Office name/code required'; END IF;
 IF p_admin_user IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id=p_admin_user)
 THEN RAISE EXCEPTION 'Validated administrator required'; END IF;
 IF p_owner_user IS NULL OR NOT EXISTS (
   SELECT 1 FROM public.centurion_office_memberships
   WHERE user_id=p_owner_user AND active AND role='owner'
 ) THEN RAISE EXCEPTION 'Verified platform owner required'; END IF;
 IF EXISTS(SELECT 1 FROM public.tenants WHERE lower(tenant_code)=lower(trim(p_code)))
 THEN RAISE EXCEPTION 'Office code already in use'; END IF;
 INSERT INTO public.tenants(tenant_code,firm_name,status,plan_tier)
 VALUES(upper(trim(p_code)),trim(p_name),'trial','starter')
 RETURNING id INTO v_id;
 INSERT INTO public.settings(id,tenant_id,name,firmname)
 VALUES ('tenant_' || replace(v_id::text,'-',''),v_id,trim(p_name),trim(p_name));
 INSERT INTO public.centurion_office_memberships(user_id,tenant_id,role)
 VALUES (p_admin_user,v_id,'admin');
 INSERT INTO public.centurion_office_memberships(user_id,tenant_id,role)
 VALUES (p_owner_user,v_id,'owner')
 ON CONFLICT (user_id,tenant_id) DO UPDATE SET role='owner', active=true;
 -- Both identities need office-local employee records. Otherwise login succeeds
 -- but the CRM has no staff profile and renders an empty workspace.
 INSERT INTO public.employees(tenant_id,name,email,role,access,status,
   perm_clients,perm_billing,perm_schedule,perm_documents,perm_reports,
   perm_hr,perm_settings,perm_irs,perm_comms,perm_leads)
 SELECT v_id,coalesce(nullif(trim(old.name),''),split_part(au.email,'@',1)),au.email,
   CASE WHEN p_admin_user=p_owner_user THEN 'Super Admin' ELSE 'Admin' END,
   CASE WHEN p_admin_user=p_owner_user THEN 'Super Admin' ELSE 'Admin' END,
   'Active',3,3,3,3,3,3,3,3,3,3
 FROM auth.users au
 LEFT JOIN LATERAL (
  SELECT e.name FROM public.employees e
  WHERE lower(trim(e.email))=lower(trim(au.email)) LIMIT 1
 ) old ON true
 WHERE au.id=p_admin_user;
 IF p_admin_user<>p_owner_user THEN
   INSERT INTO public.employees(tenant_id,name,email,role,access,status,
     perm_clients,perm_billing,perm_schedule,perm_documents,perm_reports,
     perm_hr,perm_settings,perm_irs,perm_comms,perm_leads)
   SELECT v_id,coalesce(nullif(trim(old.name),''),split_part(au.email,'@',1)),au.email,
     'Super Admin','Super Admin','Active',3,3,3,3,3,3,3,3,3,3
   FROM auth.users au
   LEFT JOIN LATERAL (
     SELECT e.name FROM public.employees e
     WHERE lower(trim(e.email))=lower(trim(au.email)) LIMIT 1
   ) old ON true
   WHERE au.id=p_owner_user;
 END IF;
 RETURN v_id;
END $;
REVOKE ALL ON FUNCTION public.centurion_create_office(text,text,uuid,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.centurion_create_office(text,text,uuid,uuid)
 TO service_role;
