-- Centurion Firm production-ready access + branding.
-- Keeps tenant isolation intact while enabling the full evaluation surface.
DO $$
DECLARE
  v_tenant constant uuid := '8fd9a2ac-95df-4bf0-99e9-cda4b20eae4a';
BEGIN
  UPDATE public.tenants
  SET
    plan_tier = 'enterprise',
    firm_name = 'Centurion Firm',
    logo_url = 'https://taxrescrm.app/centurion-logo.svg'
  WHERE id = v_tenant
    AND tenant_code = 'TRC-004';

  UPDATE public.settings
  SET
    name = 'Centurion Firm',
    firmname = 'Centurion Firm',
    website = 'https://centurionfirm.com',
    logourl = 'https://taxrescrm.app/centurion-logo.svg',
    tagline = 'Strategic Tax Solutions for the Innovators and Operators of Tomorrow'
  WHERE tenant_id = v_tenant;

  UPDATE public.employees
  SET
    access = 'Super Admin',
    role = 'Super Admin',
    status = 'Active',
    perm_leads = 3,
    perm_clients = 3,
    perm_billing = 3,
    perm_schedule = 3,
    perm_documents = 3,
    perm_reports = 3,
    perm_hr = 3,
    perm_settings = 3,
    perm_irs = 3,
    perm_comms = 3
  WHERE tenant_id = v_tenant
    AND lower(email) = lower('romy.cruz@centurionfirm.com');
END $$;

CREATE OR REPLACE FUNCTION public.get_branding_by_email_domain(p_domain text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  result json;
  v_domain text := lower(trim(coalesce(p_domain,'')));
BEGIN
  IF v_domain = '' THEN
    RETURN NULL;
  END IF;

  SELECT json_build_object(
    'tenant_id', t.id::text,
    'firm_name', coalesce(nullif(trim(s.name),''), nullif(trim(s.firmname),''), t.firm_name, 'TaxRes CRM'),
    'logo_url', coalesce(nullif(trim(s.logourl),''), nullif(trim(t.logo_url),''), null),
    'favicon_url', CASE
      WHEN t.tenant_code = 'TRC-004' THEN 'https://taxrescrm.app/centurion-favicon.svg'
      ELSE coalesce(
        nullif(trim(s.logourl),''),
        nullif(trim(t.logo_url),''),
        case
          when nullif(trim(s.website),'') is not null
            then regexp_replace(trim(s.website), '/+$', '') || '/favicon.ico'
          else null
        end
      )
    END,
    'sub', coalesce(nullif(trim(s.website),''), 'IRS Resolution Platform')
  )
  INTO result
  FROM public.tenants t
  LEFT JOIN public.settings s ON s.tenant_id=t.id
  WHERE lower(coalesce(t.status,'')) IN ('active','trial')
    AND (
      lower(split_part(coalesce(s.email,''),'@',2)) = v_domain
      OR lower(split_part(coalesce(s.firmemail,''),'@',2)) = v_domain
      OR EXISTS (
        SELECT 1
        FROM public.employees e
        WHERE e.tenant_id=t.id
          AND lower(split_part(coalesce(e.email,''),'@',2)) = v_domain
          AND lower(coalesce(e.status,'active')) = 'active'
      )
    )
  ORDER BY CASE
    WHEN lower(split_part(coalesce(s.email,''),'@',2)) = v_domain THEN 0
    WHEN lower(split_part(coalesce(s.firmemail,''),'@',2)) = v_domain THEN 1
    ELSE 2
  END,
  t.created_at ASC
  LIMIT 1;

  RETURN result;
END;
$function$;
