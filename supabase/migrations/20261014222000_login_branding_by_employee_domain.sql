-- Pre-auth tenant branding must resolve from the login identity domain,
-- even when the tenant has not populated a public office email in Settings.
-- This keeps each TaxRes family office branded before authentication.
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
    'favicon_url', coalesce(
      nullif(trim(s.logourl),''),
      nullif(trim(t.logo_url),''),
      case
        when nullif(trim(s.website),'') is not null
          then regexp_replace(trim(s.website), '/+$', '') || '/favicon.ico'
        else null
      end
    ),
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
