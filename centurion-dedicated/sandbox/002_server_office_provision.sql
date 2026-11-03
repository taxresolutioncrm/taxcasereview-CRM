-- Dedicated Centurion Supabase project only.
-- Service-role-only creation. Called by a dedicated Edge Function which
-- independently checks caller JWT, owner membership and selected office.
CREATE OR REPLACE FUNCTION public.centurion_create_office(
 p_code text, p_name text, p_admin_user uuid
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
 IF EXISTS(SELECT 1 FROM public.tenants WHERE lower(tenant_code)=lower(trim(p_code)))
 THEN RAISE EXCEPTION 'Office code already in use'; END IF;
 INSERT INTO public.tenants(tenant_code,firm_name,status,plan_tier)
 VALUES(upper(trim(p_code)),trim(p_name),'trial','starter')
 RETURNING id INTO v_id;
 INSERT INTO public.settings(id,tenant_id,name,firmname)
 VALUES ('tenant_' || replace(v_id::text,'-',''),v_id,trim(p_name),trim(p_name));
 INSERT INTO public.centurion_office_memberships(user_id,tenant_id,role)
 VALUES (p_admin_user,v_id,'admin');
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.centurion_create_office(text,text,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.centurion_create_office(text,text,uuid)
 TO service_role;
