-- Public tax organizer / financial intake bearer-link lifecycle, shared TCR/TaxRes/Centurion.
-- No client record or answers are deleted. Existing outstanding links get a 90-day
-- grace from this release, while NEW links expire after 60 days by default.
-- A revoked/expired link is rejected for load, save and submit.
-- Legacy lead-ID intake links are available only for a finite compatibility window.
ALTER TABLE public.tax_organizer_responses
  ADD COLUMN IF NOT EXISTS public_access_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS public_access_revoked_at timestamptz;
ALTER TABLE public.financial_intake_responses
  ADD COLUMN IF NOT EXISTS public_access_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS public_access_revoked_at timestamptz;
ALTER TABLE public.tax_organizer_responses
  ALTER COLUMN public_access_expires_at SET DEFAULT (now() + interval '60 days');
ALTER TABLE public.financial_intake_responses
  ALTER COLUMN public_access_expires_at SET DEFAULT (now() + interval '60 days');
UPDATE public.tax_organizer_responses
  SET public_access_expires_at=now()+interval '90 days'
  WHERE public_access_expires_at IS NULL;
UPDATE public.financial_intake_responses
  SET public_access_expires_at=now()+interval '90 days'
  WHERE public_access_expires_at IS NULL;

CREATE OR REPLACE FUNCTION public._public_form_access_active(p_kind text, p_id text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO pg_catalog, public, pg_temp
AS $guard$
DECLARE
  v_tenant uuid;
  v_expiry timestamptz;
  v_revoked timestamptz;
BEGIN
  IF p_id IS NULL OR length(p_id)>64 OR p_id !~ '^[0-9a-fA-F-]{36}$' THEN RETURN false; END IF;
  IF p_kind='organizer' THEN
    SELECT o.tenant_id,o.public_access_expires_at,o.public_access_revoked_at
      INTO v_tenant,v_expiry,v_revoked
      FROM public.tax_organizer_responses o WHERE o.id::text=p_id LIMIT 1;
    RETURN v_tenant IS NOT NULL AND v_revoked IS NULL AND v_expiry>now()
      AND public.tenant_is_available(v_tenant);
  ELSIF p_kind='financial_intake' THEN
    SELECT f.tenant_id,f.public_access_expires_at,f.public_access_revoked_at
      INTO v_tenant,v_expiry,v_revoked
      FROM public.financial_intake_responses f
      WHERE f.id::text=p_id OR f.client_id=p_id
      ORDER BY CASE WHEN f.id::text=p_id THEN 0 ELSE 1 END, f.created_at DESC LIMIT 1;
    IF v_tenant IS NOT NULL THEN
      RETURN v_revoked IS NULL AND v_expiry>now() AND public.tenant_is_available(v_tenant);
    END IF;
    -- Historic links created from a lead UUID can initialize their first intake.
    -- Sunset this pre-existing compatibility path. New links use intake row UUIDs.
    IF now()>=timestamptz '2027-02-14 00:00:00+00' THEN RETURN false; END IF;
    SELECT l.tenant_id INTO v_tenant FROM public.leads l
      WHERE l.id::text=p_id
        AND l.created_at<timestamptz '2026-11-15 00:00:00+00'
      LIMIT 1;
    RETURN public.tenant_is_available(v_tenant);
  END IF;
  RETURN false;
END;
$guard$;
REVOKE ALL ON FUNCTION public._public_form_access_active(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._public_form_access_active(text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.organizer_get(p_id text)
RETURNS public.tax_organizer_responses LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog, public, pg_temp
AS $f$
DECLARE v_tenant uuid;
BEGIN
  IF NOT public._public_form_access_active('organizer',p_id) THEN RETURN null; END IF;
  SELECT o.tenant_id INTO v_tenant FROM public.tax_organizer_responses o WHERE o.id::text=p_id LIMIT 1;
  IF NOT public.tenant_is_available(v_tenant) THEN RETURN null; END IF;
  RETURN public.organizer_get_unchecked(p_id);
END;
$f$;
CREATE OR REPLACE FUNCTION public.organizer_save_answers(p_id text,p_answers jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog, public, pg_temp
AS $f$
DECLARE v_tenant uuid;
BEGIN
  IF NOT public._public_form_access_active('organizer',p_id) THEN RAISE EXCEPTION 'Organizer link expired or revoked'; END IF;
  SELECT o.tenant_id INTO v_tenant FROM public.tax_organizer_responses o WHERE o.id::text=p_id LIMIT 1;
  IF NOT public.tenant_is_available(v_tenant) THEN RAISE EXCEPTION 'Organizer is unavailable.'; END IF;
  PERFORM public.organizer_save_answers_unchecked(p_id,p_answers);
END;
$f$;
CREATE OR REPLACE FUNCTION public.organizer_submit(p_id text,p_answers jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog, public, pg_temp
AS $f$
DECLARE v_tenant uuid;
BEGIN
  IF NOT public._public_form_access_active('organizer',p_id) THEN RAISE EXCEPTION 'Organizer link expired or revoked'; END IF;
  SELECT o.tenant_id INTO v_tenant FROM public.tax_organizer_responses o WHERE o.id::text=p_id LIMIT 1;
  IF NOT public.tenant_is_available(v_tenant) THEN RAISE EXCEPTION 'Organizer is unavailable.'; END IF;
  PERFORM public.organizer_submit_unchecked(p_id,p_answers);
END;
$f$;
CREATE OR REPLACE FUNCTION public.financial_intake_load(p_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog, public, pg_temp
AS $f$
DECLARE v_tenant uuid;
BEGIN
  IF NOT public._public_form_access_active('financial_intake',p_id) THEN RETURN null; END IF;
  SELECT f.tenant_id INTO v_tenant FROM public.financial_intake_responses f WHERE f.id::text=p_id LIMIT 1;
  IF v_tenant IS NULL THEN SELECT l.tenant_id INTO v_tenant FROM public.leads l WHERE l.id::text=p_id LIMIT 1; END IF;
  IF NOT public.tenant_is_available(v_tenant) THEN RETURN null; END IF;
  RETURN public.financial_intake_load_unchecked(p_id);
END;
$f$;
CREATE OR REPLACE FUNCTION public.financial_intake_save(p_id text,p_answers jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog, public, pg_temp
AS $f$
DECLARE v_tenant uuid;
BEGIN
  IF NOT public._public_form_access_active('financial_intake',p_id) THEN RAISE EXCEPTION 'Financial intake link expired or revoked'; END IF;
  SELECT f.tenant_id INTO v_tenant FROM public.financial_intake_responses f WHERE f.id::text=p_id LIMIT 1;
  IF NOT public.tenant_is_available(v_tenant) THEN RAISE EXCEPTION 'Financial intake is unavailable.'; END IF;
  PERFORM public.financial_intake_save_unchecked(p_id,p_answers);
END;
$f$;
CREATE OR REPLACE FUNCTION public.financial_intake_submit(p_id text,p_answers jsonb,p_lead_patch jsonb,p_profile jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog, public, pg_temp
AS $f$
DECLARE v_tenant uuid;
BEGIN
  IF NOT public._public_form_access_active('financial_intake',p_id) THEN RAISE EXCEPTION 'Financial intake link expired or revoked'; END IF;
  SELECT f.tenant_id INTO v_tenant FROM public.financial_intake_responses f WHERE f.id::text=p_id LIMIT 1;
  IF NOT public.tenant_is_available(v_tenant) THEN RAISE EXCEPTION 'Financial intake is unavailable.'; END IF;
  RETURN public.financial_intake_submit_unchecked(p_id,p_answers,p_lead_patch,p_profile);
END;
$f$;

-- Database grant checks are part of the live post-deploy acceptance test.
-- Public read/write must continue only through these six checked entry points.
