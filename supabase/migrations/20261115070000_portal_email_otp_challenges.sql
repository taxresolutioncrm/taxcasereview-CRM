-- Shared CRM client portal: replace SSN-last-four with email possession proof.
-- This migration is additive. The legacy PIN RPC is retired only after
-- production delivery and verification of the new email challenge flow.
-- All OTP state is service-only, row-level security enabled, no PII exposed.
CREATE TABLE IF NOT EXISTS public.portal_email_login_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  client_id text NOT NULL,
  is_lead boolean NOT NULL,
  email text NOT NULL,
  code_hash text NOT NULL,
  request_ip_hash text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '10 minutes'),
  used_at timestamptz,
  CONSTRAINT portal_email_login_attempts_nonnegative CHECK (attempts>=0 AND attempts<=5)
);
CREATE INDEX IF NOT EXISTS portal_email_login_target_time_idx
  ON public.portal_email_login_challenges(client_id,email,created_at DESC);
CREATE INDEX IF NOT EXISTS portal_email_login_ip_time_idx
  ON public.portal_email_login_challenges(request_ip_hash,created_at DESC);
ALTER TABLE public.portal_email_login_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_email_login_challenges FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.portal_email_login_challenges TO service_role;

CREATE OR REPLACE FUNCTION public.portal_email_code_request(p_id text,p_email text,p_ip text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog, public, extensions, pg_temp
AS $fn$
DECLARE
  v_email text:=lower(trim(coalesce(p_email,'')));
  v_id text:=trim(coalesce(p_id,''));
  v_info record;
  v_lead boolean:=false;
  v_tenant record;
  v_iphash text;
  v_tries bigint;
  v_bytes bytea;
  v_code text;
  v_challenge_id uuid;
BEGIN
  IF length(v_id)<3 OR length(v_id)>128
     OR length(v_email)>254
     OR v_email !~ '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$'
  THEN RETURN NULL; END IF;

  SELECT id,tenant_id,name,email INTO v_info FROM public.clients
    WHERE id=v_id AND deleted_at IS NULL AND lower(trim(coalesce(email,'')))=v_email LIMIT 1;
  IF v_info.id IS NULL THEN
    SELECT id,tenant_id,name,email INTO v_info FROM public.leads
      WHERE id=v_id AND deleted_at IS NULL AND lower(trim(coalesce(email,'')))=v_email LIMIT 1;
    v_lead:=true;
  END IF;
  IF v_info.id IS NULL OR NOT coalesce(public.tenant_is_available(v_info.tenant_id),false)
  THEN RETURN NULL; END IF;
  SELECT firm_name INTO v_tenant FROM public.tenants WHERE id=v_info.tenant_id;

  SELECT count(*) INTO v_tries FROM public.portal_email_login_challenges
    WHERE client_id=v_id AND email=v_email AND created_at>now()-interval '15 minutes';
  IF v_tries>=3 THEN RETURN NULL; END IF;
  v_iphash:=CASE WHEN coalesce(trim(p_ip),'')='' THEN NULL
    ELSE encode(extensions.digest(lower(trim(p_ip)),'sha256'),'hex') END;
  IF v_iphash IS NOT NULL THEN
    SELECT count(*) INTO v_tries FROM public.portal_email_login_challenges
      WHERE request_ip_hash=v_iphash AND created_at>now()-interval '15 minutes';
    IF v_tries>=25 THEN RETURN NULL; END IF;
  END IF;

  v_bytes:=extensions.gen_random_bytes(4);
  v_code:=lpad(((get_byte(v_bytes,0)::bigint*16777216+
    get_byte(v_bytes,1)::bigint*65536+
    get_byte(v_bytes,2)::bigint*256+
    get_byte(v_bytes,3)::bigint)%1000000)::text,6,'0');
  INSERT INTO public.portal_email_login_challenges(
    tenant_id,client_id,is_lead,email,code_hash,request_ip_hash
  ) VALUES (
    v_info.tenant_id,v_id,v_lead,v_email,
    extensions.crypt(v_code,extensions.gen_salt('bf',10)),v_iphash
  ) RETURNING id INTO v_challenge_id;
  -- Only server-side service_role may see v_code or this JSON result.
  RETURN jsonb_build_object(
    'challenge_id',v_challenge_id,'code',v_code,
    'recipient',v_email,'tenant_id',v_info.tenant_id,
    'firm_name',coalesce(v_tenant.firm_name,'TaxRes CRM')
  );
END
$fn$;
REVOKE ALL ON FUNCTION public.portal_email_code_request(text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_email_code_request(text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.portal_email_code_verify(p_id text,p_email text,p_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO pg_catalog, public, extensions, pg_temp
AS $fn$
DECLARE
  v_id text:=trim(coalesce(p_id,''));
  v_email text:=lower(trim(coalesce(p_email,'')));
  v_code text:=trim(coalesce(p_code,''));
  v_challenge public.portal_email_login_challenges%ROWTYPE;
  v_subject record;
  v_token text;
BEGIN
  IF length(v_id)<3 OR length(v_id)>128
     OR length(v_email)>254 OR v_code !~ '^[0-9]{6}$'
  THEN RETURN NULL; END IF;
  SELECT * INTO v_challenge FROM public.portal_email_login_challenges
    WHERE client_id=v_id AND email=v_email AND used_at IS NULL
      AND expires_at>now() AND attempts<5
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF v_challenge.id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.portal_email_login_challenges
    SET attempts=attempts+1 WHERE id=v_challenge.id;
  -- Failed attempts return NULL, never RAISE: a raised exception would roll back
  -- the failure counter and permit unlimited guessing (old PIN login flaw).
  IF extensions.crypt(v_code,v_challenge.code_hash)<>v_challenge.code_hash
  THEN RETURN NULL; END IF;
  IF NOT coalesce(public.tenant_is_available(v_challenge.tenant_id),false)
  THEN RETURN NULL; END IF;
  IF v_challenge.is_lead THEN
    SELECT id,name,tenant_id,email INTO v_subject FROM public.leads
      WHERE id=v_id AND tenant_id=v_challenge.tenant_id
        AND deleted_at IS NULL AND lower(trim(coalesce(email,'')))=v_email LIMIT 1;
  ELSE
    SELECT id,name,tenant_id,email INTO v_subject FROM public.clients
      WHERE id=v_id AND tenant_id=v_challenge.tenant_id
        AND deleted_at IS NULL AND lower(trim(coalesce(email,'')))=v_email LIMIT 1;
  END IF;
  IF v_subject.id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.portal_email_login_challenges SET used_at=now()
    WHERE id=v_challenge.id AND used_at IS NULL;
  -- Logging in with verified email replaces all weaker previously issued
  -- portal sessions for this client/tenant.
  DELETE FROM public.portal_sessions
    WHERE client_id=v_id AND tenant_id=v_challenge.tenant_id AND is_lead=v_challenge.is_lead;
  v_token:=encode(extensions.gen_random_bytes(48),'hex');
  INSERT INTO public.portal_sessions(token,client_id,is_lead,client_name,tenant_id,expires_at)
    VALUES(v_token,v_id,v_challenge.is_lead,v_subject.name,v_challenge.tenant_id,now()+interval '12 hours');
  RETURN jsonb_build_object('token',v_token,'client_name',v_subject.name,'is_lead',v_challenge.is_lead);
END
$fn$;
REVOKE ALL ON FUNCTION public.portal_email_code_verify(text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_email_code_verify(text,text,text) TO service_role;
