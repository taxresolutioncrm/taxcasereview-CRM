-- LeadFlow final integration contract (sandbox)
-- Production application must be performed only after explicit deploy approval.
--
-- Restricted external RPCs:
--   leadflow_upsert_lead
--   leadflow_create_case
--   leadflow_book_appointment
--   leadflow_upsert_unpaid_lead
--   leadflow_cancel_appointment
--
-- All RPCs are service_role-only and explicitly scope writes to the
-- Tax Case Review tenant instead of relying on current_tenant_id().

CREATE OR REPLACE FUNCTION public.leadflow_upsert_lead(
  p_name                     text,
  p_email                    text,
  p_phone                    text    DEFAULT NULL,
  p_irs_balance              text    DEFAULT NULL,
  p_issue_type               text    DEFAULT NULL,
  p_state                    text    DEFAULT NULL,
  p_county                   text    DEFAULT NULL,
  p_notes                    text    DEFAULT NULL,
  p_stripe_payment_id        text    DEFAULT NULL,
  p_stripe_customer_id       text    DEFAULT NULL,
  p_investigation_fee_amount numeric DEFAULT NULL,
  p_assigned_to              text    DEFAULT 'Dana Richard'
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $func$
DECLARE
  v_id text;
  v_tenant uuid;
BEGIN
  IF NULLIF(btrim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'p_name is required';
  END IF;
  IF NULLIF(btrim(p_email), '') IS NULL THEN
    RAISE EXCEPTION 'p_email is required';
  END IF;

  SELECT t.id INTO v_tenant
  FROM public.tenants t
  WHERE t.tenant_code = 'TRC-001'
    AND lower(coalesce(t.status,'')) IN ('active','trial')
  LIMIT 1;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'LeadFlow tenant is unavailable';
  END IF;

  SELECT l.id INTO v_id
  FROM public.leads l
  WHERE l.tenant_id = v_tenant
    AND lower(l.email) = lower(btrim(p_email))
    AND l.deleted_at IS NULL
  ORDER BY l.created_at DESC NULLS LAST
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.leads l SET
      name                       = COALESCE(NULLIF(btrim(p_name), ''), l.name),
      status                     = 'Tax Inv Fee Paid',
      stripe_payment_id          = COALESCE(NULLIF(btrim(p_stripe_payment_id), ''), l.stripe_payment_id),
      stripe_customer_id         = COALESCE(NULLIF(btrim(p_stripe_customer_id), ''), l.stripe_customer_id),
      investigation_fee_paid     = true,
      inv_fee_paid               = true,
      investigation_fee_amount   = COALESCE(p_investigation_fee_amount, l.investigation_fee_amount),
      inv_fee_amount             = COALESCE(p_investigation_fee_amount, l.inv_fee_amount),
      "irsBalance"               = COALESCE(NULLIF(btrim(p_irs_balance), ''), l."irsBalance"),
      "issueType"                = COALESCE(NULLIF(btrim(p_issue_type), ''), l."issueType"),
      state                      = COALESCE(NULLIF(btrim(p_state), ''), l.state),
      county                     = COALESCE(NULLIF(btrim(p_county), ''), l.county),
      phone                      = COALESCE(NULLIF(btrim(p_phone), ''), l.phone),
      notes                      = CASE
                                     WHEN NULLIF(btrim(p_notes), '') IS NULL THEN l.notes
                                     WHEN NULLIF(btrim(l.notes), '') IS NULL THEN btrim(p_notes)
                                     ELSE l.notes || E'\n' || btrim(p_notes)
                                   END,
      "assignedTo"               = COALESCE(NULLIF(btrim(p_assigned_to), ''), l."assignedTo")
    WHERE l.id = v_id
      AND l.tenant_id = v_tenant;
  ELSE
    INSERT INTO public.leads (
      tenant_id, name, email, phone, "irsBalance", "issueType", state, county, notes,
      status, source, "assignedTo",
      stripe_payment_id, stripe_customer_id,
      investigation_fee_paid, inv_fee_paid,
      investigation_fee_amount, inv_fee_amount,
      created_at
    ) VALUES (
      v_tenant, btrim(p_name), lower(btrim(p_email)), NULLIF(btrim(p_phone), ''),
      NULLIF(btrim(p_irs_balance), ''), NULLIF(btrim(p_issue_type), ''),
      NULLIF(btrim(p_state), ''), NULLIF(btrim(p_county), ''), NULLIF(btrim(p_notes), ''),
      'Tax Inv Fee Paid', 'TaxCase Review Web', COALESCE(NULLIF(btrim(p_assigned_to), ''), 'Dana Richard'),
      NULLIF(btrim(p_stripe_payment_id), ''), NULLIF(btrim(p_stripe_customer_id), ''),
      true, true, p_investigation_fee_amount, p_investigation_fee_amount, now()
    ) RETURNING id INTO v_id;
  END IF;

  INSERT INTO public.chat_messages (tenant_id, channel, sender, text, created_at)
  VALUES (
    v_tenant, 'general', '🔔 System',
    '💰 New paid lead from the website: **' || btrim(p_name) || '** (' || lower(btrim(p_email)) || ')' ||
      CASE WHEN p_investigation_fee_amount IS NOT NULL
        THEN ' — paid $' || p_investigation_fee_amount
        ELSE '' END ||
      CASE WHEN NULLIF(btrim(p_issue_type), '') IS NOT NULL THEN '. Issue: ' || btrim(p_issue_type) ELSE '' END ||
      CASE WHEN NULLIF(btrim(p_irs_balance), '') IS NOT NULL THEN '. IRS balance: ' || btrim(p_irs_balance) ELSE '' END || '.',
    now()
  );

  RETURN v_id;
END;
$func$;

CREATE OR REPLACE FUNCTION public.leadflow_upsert_unpaid_lead(
  p_name        text,
  p_email       text,
  p_phone       text DEFAULT NULL,
  p_irs_balance text DEFAULT NULL,
  p_issue_type  text DEFAULT NULL,
  p_state       text DEFAULT NULL,
  p_county      text DEFAULT NULL,
  p_notes       text DEFAULT NULL,
  p_assigned_to text DEFAULT 'Dana Richard'
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $func$
DECLARE
  v_id text;
  v_tenant uuid;
BEGIN
  IF NULLIF(btrim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'p_name is required';
  END IF;
  IF NULLIF(btrim(p_email), '') IS NULL THEN
    RAISE EXCEPTION 'p_email is required';
  END IF;

  SELECT t.id INTO v_tenant
  FROM public.tenants t
  WHERE t.tenant_code = 'TRC-001'
    AND lower(coalesce(t.status,'')) IN ('active','trial')
  LIMIT 1;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'LeadFlow tenant is unavailable';
  END IF;

  SELECT l.id INTO v_id
  FROM public.leads l
  WHERE l.tenant_id = v_tenant
    AND lower(l.email) = lower(btrim(p_email))
    AND l.deleted_at IS NULL
  ORDER BY l.created_at DESC NULLS LAST
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.leads l SET
      name          = COALESCE(NULLIF(btrim(p_name), ''), l.name),
      phone         = COALESCE(NULLIF(btrim(p_phone), ''), l.phone),
      "irsBalance"  = COALESCE(NULLIF(btrim(p_irs_balance), ''), l."irsBalance"),
      "issueType"   = COALESCE(NULLIF(btrim(p_issue_type), ''), l."issueType"),
      state         = COALESCE(NULLIF(btrim(p_state), ''), l.state),
      county        = COALESCE(NULLIF(btrim(p_county), ''), l.county),
      notes         = CASE
                        WHEN NULLIF(btrim(p_notes), '') IS NULL THEN l.notes
                        WHEN NULLIF(btrim(l.notes), '') IS NULL THEN btrim(p_notes)
                        ELSE l.notes || E'\n' || btrim(p_notes)
                      END,
      "assignedTo"  = COALESCE(NULLIF(btrim(p_assigned_to), ''), l."assignedTo")
    WHERE l.id = v_id
      AND l.tenant_id = v_tenant;
  ELSE
    INSERT INTO public.leads (
      tenant_id, name, email, phone, "irsBalance", "issueType", state, county, notes,
      status, source, "assignedTo", investigation_fee_paid, inv_fee_paid, created_at
    ) VALUES (
      v_tenant, btrim(p_name), lower(btrim(p_email)), NULLIF(btrim(p_phone), ''),
      NULLIF(btrim(p_irs_balance), ''), NULLIF(btrim(p_issue_type), ''),
      NULLIF(btrim(p_state), ''), NULLIF(btrim(p_county), ''), NULLIF(btrim(p_notes), ''),
      'New Lead', 'TaxCase Review Web', COALESCE(NULLIF(btrim(p_assigned_to), ''), 'Dana Richard'),
      false, false, now()
    ) RETURNING id INTO v_id;

    INSERT INTO public.chat_messages (tenant_id, channel, sender, text, created_at)
    VALUES (
      v_tenant, 'general', '🔔 System',
      '🆕 New unpaid lead from the website: **' || btrim(p_name) || '** (' || lower(btrim(p_email)) || ').',
      now()
    );
  END IF;

  RETURN v_id;
END;
$func$;

CREATE OR REPLACE FUNCTION public.leadflow_create_case(
  p_lead_id     text,
  p_client_name text,
  p_case_type   text DEFAULT 'OIC',
  p_irs_balance text DEFAULT NULL,
  p_tax_years   text DEFAULT NULL,
  p_assigned_to text DEFAULT 'Dana Richard',
  p_notes       text DEFAULT 'Investigation fee paid. Case opened automatically via payment system.'
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $func$
DECLARE
  v_id text;
  v_tenant uuid;
BEGIN
  SELECT t.id INTO v_tenant
  FROM public.tenants t
  WHERE t.tenant_code = 'TRC-001'
    AND lower(coalesce(t.status,'')) IN ('active','trial')
  LIMIT 1;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'LeadFlow tenant is unavailable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = p_lead_id
      AND l.tenant_id = v_tenant
      AND l.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Lead not found';
  END IF;

  INSERT INTO public.cases (
    tenant_id, "clientName", "caseType", status, "irsBalance", "taxYears", "assignedTo",
    "irsOrState", notes, lead_id, created_at
  ) VALUES (
    v_tenant, p_client_name, COALESCE(NULLIF(btrim(p_case_type), ''), 'OIC'),
    'Open', NULLIF(btrim(p_irs_balance), ''), NULLIF(btrim(p_tax_years), ''),
    COALESCE(NULLIF(btrim(p_assigned_to), ''), 'Dana Richard'),
    'IRS Federal', p_notes, p_lead_id, now()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$func$;

CREATE OR REPLACE FUNCTION public.leadflow_book_appointment(
  p_client_name text,
  p_date        text,
  p_time        text,
  p_end_time    text DEFAULT NULL,
  p_event_type  text DEFAULT 'Consultation Call',
  p_assigned_to text DEFAULT 'Dana Richard',
  p_notes       text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $func$
DECLARE
  v_id text;
  v_tenant uuid;
BEGIN
  IF NULLIF(btrim(p_client_name), '') IS NULL THEN
    RAISE EXCEPTION 'p_client_name is required';
  END IF;
  IF p_date !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'p_date must be YYYY-MM-DD';
  END IF;
  IF p_time !~ '^([01]\d|2[0-3]):[0-5]\d$' THEN
    RAISE EXCEPTION 'p_time must be HH:MM';
  END IF;
  IF NULLIF(btrim(p_end_time), '') IS NOT NULL
     AND p_end_time !~ '^([01]\d|2[0-3]):[0-5]\d$' THEN
    RAISE EXCEPTION 'p_end_time must be HH:MM';
  END IF;

  SELECT t.id INTO v_tenant
  FROM public.tenants t
  WHERE t.tenant_code = 'TRC-001'
    AND lower(coalesce(t.status,'')) IN ('active','trial')
  LIMIT 1;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'LeadFlow tenant is unavailable';
  END IF;

  INSERT INTO public.calevents (
    tenant_id, title, "clientName", "assignedTo", date, time, "endTime", "eventType",
    color, notes, recurring, status, source, created_at, updated_at
  ) VALUES (
    v_tenant,
    'Tax Investigation Consultation - ' || btrim(p_client_name),
    btrim(p_client_name),
    COALESCE(NULLIF(btrim(p_assigned_to), ''), 'Dana Richard'),
    p_date, p_time, NULLIF(btrim(p_end_time), ''),
    COALESCE(NULLIF(btrim(p_event_type), ''), 'Consultation Call'),
    'bb', NULLIF(btrim(p_notes), ''), 'none', 'scheduled', 'leadflow', now(), now()
  ) RETURNING id INTO v_id;

  INSERT INTO public.chat_messages (tenant_id, channel, sender, text, created_at)
  VALUES (
    v_tenant, 'general', '🔔 System',
    '📅 New appointment booked online: **' || btrim(p_client_name) || '** on ' || p_date ||
      ' at ' || p_time ||
      ' (' || COALESCE(NULLIF(btrim(p_event_type), ''), 'Consultation Call') || ').',
    now()
  );

  RETURN v_id;
END;
$func$;

CREATE OR REPLACE FUNCTION public.leadflow_cancel_appointment(
  p_appointment_id text,
  p_reason         text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $func$
DECLARE
  v_id text;
  v_tenant uuid;
BEGIN
  IF NULLIF(btrim(p_appointment_id), '') IS NULL THEN
    RAISE EXCEPTION 'p_appointment_id is required';
  END IF;

  SELECT t.id INTO v_tenant
  FROM public.tenants t
  WHERE t.tenant_code = 'TRC-001'
    AND lower(coalesce(t.status,'')) IN ('active','trial')
  LIMIT 1;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'LeadFlow tenant is unavailable';
  END IF;

  UPDATE public.calevents c
  SET status = 'canceled',
      notes = CASE
                WHEN NULLIF(btrim(p_reason), '') IS NULL THEN c.notes
                WHEN NULLIF(btrim(c.notes), '') IS NULL THEN 'LeadFlow cancellation: ' || btrim(p_reason)
                ELSE c.notes || E'\nLeadFlow cancellation: ' || btrim(p_reason)
              END,
      updated_at = now()
  WHERE c.id = btrim(p_appointment_id)
    AND c.tenant_id = v_tenant
    AND coalesce(lower(c.status), '') <> 'canceled'
  RETURNING c.id INTO v_id;

  IF v_id IS NULL THEN
    SELECT c.id INTO v_id
    FROM public.calevents c
    WHERE c.id = btrim(p_appointment_id)
      AND c.tenant_id = v_tenant
      AND lower(coalesce(c.status,'')) = 'canceled'
    LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Appointment not found';
  END IF;

  RETURN v_id;
END;
$func$;

REVOKE EXECUTE ON FUNCTION public.leadflow_upsert_lead(
  text,text,text,text,text,text,text,text,text,text,numeric,text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leadflow_upsert_lead(
  text,text,text,text,text,text,text,text,text,text,numeric,text
) TO service_role;

REVOKE EXECUTE ON FUNCTION public.leadflow_upsert_unpaid_lead(
  text,text,text,text,text,text,text,text,text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leadflow_upsert_unpaid_lead(
  text,text,text,text,text,text,text,text,text
) TO service_role;

REVOKE EXECUTE ON FUNCTION public.leadflow_create_case(
  text,text,text,text,text,text,text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leadflow_create_case(
  text,text,text,text,text,text,text
) TO service_role;

REVOKE EXECUTE ON FUNCTION public.leadflow_book_appointment(
  text,text,text,text,text,text,text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leadflow_book_appointment(
  text,text,text,text,text,text,text
) TO service_role;

REVOKE EXECUTE ON FUNCTION public.leadflow_cancel_appointment(
  text,text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leadflow_cancel_appointment(
  text,text
) TO service_role;
