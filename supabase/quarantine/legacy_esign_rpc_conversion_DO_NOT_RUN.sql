-- HISTORICAL ONLY / DO NOT EXECUTE.
-- This unnumbered legacy migration included anonymous grants for ID-only e-sign RPCs.
-- Superseded in production by migration 20261114014500_esign_legacy_rpc_public_execute_lockdown.sql
-- and v3.2.121 service-role-only permissions. Kept here solely as audit evidence.
-- DO NOT MOVE BACK INTO THE ACTIVE MIGRATION FOLDER OR APPLY MANUALLY.

-- ============================================================
-- E-Sign RPC Conversion
-- Replaces SignPage.jsx's direct anon table access (esigns, leads,
-- tasks, lead_notes, client_notes, documents) with SECURITY DEFINER
-- RPCs, so those tables no longer need to stay open to anon.
-- Run this in: Supabase Dashboard → SQL Editor
-- ============================================================

-- ── 1. Load the signing document (replaces direct esigns SELECT) ──
CREATE OR REPLACE FUNCTION esign_load(p_id text)
RETURNS SETOF esigns
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM esigns WHERE id = p_id;
$$;

-- ── 2. Mark signed — the legally-binding write, kept isolated so it ──
-- ── always lands even if everything downstream fails ──────────────
CREATE OR REPLACE FUNCTION esign_mark_signed(
  p_id text,
  p_signed_name text,
  p_signer_full_name text,
  p_signer_ip text,
  p_signed_user_agent text
)
RETURNS SETOF esigns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  RETURN QUERY
  UPDATE esigns SET
    status             = 'Signed',
    signed_at          = v_now,
    signed_name        = p_signed_name,
    signer_full_name   = p_signer_full_name,
    signer_ip          = p_signer_ip,
    signed_timestamp   = v_now,
    signed_user_agent  = p_signed_user_agent
  WHERE id = p_id
  RETURNING *;
END;
$$;

-- ── 3. Everything downstream of the signature — workflow trigger, ──
-- ── pipeline advance, notes, document records. Best-effort: each ──
-- ── section is wrapped so one failure doesn't block the rest, ──────
-- ── matching the original client-side .catch(()=>{}) behavior. ─────
CREATE OR REPLACE FUNCTION esign_finalize(
  p_id text,
  p_client_name text,
  p_doc_type text,
  p_signed_by text,
  p_signer_ip text,
  p_signed_at timestamptz,
  p_saved_doc_type text,
  p_cert_url text DEFAULT NULL,
  p_attachments jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entity_type   text;
  v_lead_id       text;
  v_lead_status   text;
  v_lead_assigned text;
  v_target_status text;
  v_note_text     text;
  v_due_date      text := to_char(now() + interval '1 day', 'YYYY-MM-DD');
  v_assignee2     text;
  v_att           jsonb;
BEGIN
  -- Does a lead with this name exist? Determines entity_type + drives
  -- the pipeline-advance / fee-check logic below.
  SELECT id, status, "assignedTo" INTO v_lead_id, v_lead_status, v_lead_assigned
  FROM leads WHERE name = p_client_name LIMIT 1;

  v_entity_type := CASE WHEN v_lead_id IS NOT NULL THEN 'lead' ELSE 'client' END;

  -- ── Workflow trigger: fire any active 'esign_signed' template ──────
  BEGIN
    INSERT INTO tasks (title, "clientName", "assignedTo", priority, "dueDate", done, notes, section_title, created_at)
    SELECT
      ws.title, p_client_name, 'System', 'Normal',
      to_char(now() + make_interval(days => COALESCE(ws.due_in_days, 1)), 'YYYY-MM-DD'),
      false, COALESCE(ws.notes, ''), ws.section_title, now()
    FROM workflow_templates wt
    JOIN workflow_steps ws ON ws.template_id = wt.id
    WHERE wt.active = true
      AND wt.entity_type = v_entity_type
      AND wt.trigger_event = 'esign_signed'
      AND (wt.trigger_value IS NULL OR wt.trigger_value = p_doc_type);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- ── Pipeline advance (forward-only) ─────────────────────────────────
  BEGIN
    v_target_status := CASE p_doc_type
      WHEN 'Full Investigation Package' THEN 'Tax Inv Agreement Signed'
      WHEN 'Service Addendum'           THEN 'Addendum Signed'
      WHEN 'Tax Service Agreement'      THEN 'Tax Inv Agreement Signed'
      WHEN 'Service Agreement'          THEN 'Tax Inv Agreement Signed'
      ELSE NULL
    END;

    IF v_target_status IS NOT NULL AND v_lead_id IS NOT NULL THEN
      -- forward-only: STATUS_ORDER index comparison via a fixed CASE map
      PERFORM 1 FROM (
        SELECT array_position(ARRAY[
          'New Lead','Contacted','Consultation Scheduled','Consultation Completed',
          'Tax Inv Agreement Sent','Tax Inv Agreement Signed','Tax Inv Fee Paid',
          'Tax Investigation Active','IRS Facts Received','Addendum Sent','Addendum Signed',
          'Resolution Fee Paid','Converted to Client'
        ], v_lead_status) AS cur_idx,
        array_position(ARRAY[
          'New Lead','Contacted','Consultation Scheduled','Consultation Completed',
          'Tax Inv Agreement Sent','Tax Inv Agreement Signed','Tax Inv Fee Paid',
          'Tax Investigation Active','IRS Facts Received','Addendum Sent','Addendum Signed',
          'Resolution Fee Paid','Converted to Client'
        ], v_target_status) AS target_idx
      ) idx
      WHERE COALESCE(idx.cur_idx, 0) < idx.target_idx;

      IF FOUND THEN
        UPDATE leads SET status = v_target_status WHERE id = v_lead_id;
        v_lead_status := v_target_status;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- ── Fee-already-paid combo case ──────────────────────────────────────
  BEGIN
    IF v_target_status = 'Tax Inv Agreement Signed' AND v_lead_id IS NOT NULL AND v_lead_status = 'Tax Inv Fee Paid' THEN
      UPDATE leads SET status = 'Tax Investigation Active' WHERE id = v_lead_id;
      v_assignee2 := COALESCE(v_lead_assigned, 'Unassigned');

      INSERT INTO tasks (title, "clientName", priority, "dueDate", done, "assignedTo", notes, created_at)
      VALUES
        ('📞 Call IRS — gather tax investigation info for ' || p_client_name, p_client_name, 'High', v_due_date, false, v_assignee2,
         'Call IRS with POA to pull transcripts, balances, lien info, assessment dates, and filing history. Enter results into the Compliance tab on this lead.', now()),
        ('🧾 Review financial intake — build resolution plan for ' || p_client_name, p_client_name, 'High', v_due_date, false, v_assignee2,
         'Review the Financial Profile (I&E, Assets & Equity tabs) populated from the client''s intake submission. Cross-reference with IRS results to determine the best resolution path (OIC, IA, CNC, etc.).', now());

      INSERT INTO lead_notes (lead_id, lead_name, text, type, author, created_at)
      VALUES (v_lead_id, p_client_name,
        '✍️ Agreement signed — fee already paid, auto-advanced to Tax Investigation Active. 2 tasks created for ' || v_assignee2 || '.',
        'System', 'System (E-Sign)', now());
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- ── Log note on lead or client file ──────────────────────────────────
  BEGIN
    v_note_text := '✅ ' || p_doc_type || ' signed — by: ' || p_signed_by || ' | IP: ' || COALESCE(p_signer_ip, '') || ' | ' || p_signed_at::text;
    IF v_lead_id IS NOT NULL THEN
      INSERT INTO lead_notes (lead_id, lead_name, text, type, author, created_at)
      VALUES (v_lead_id, p_client_name, v_note_text, 'E-Sign', 'System', p_signed_at);
    ELSE
      INSERT INTO client_notes (clientname, text, author, visible_to_client, created_at)
      VALUES (p_client_name, v_note_text, 'System', false, p_signed_at);
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- ── Generic signature-record document entry ──────────────────────────
  BEGIN
    INSERT INTO documents (client, name, "docType", notes, created_at)
    VALUES (p_client_name, 'Signed ' || p_doc_type || ' — ' || p_client_name, p_saved_doc_type,
      'Signed by: ' || p_signed_by || E'\nIP: ' || COALESCE(p_signer_ip,'') || E'\nDate: ' || p_signed_at::text,
      p_signed_at);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- ── Certificate of Completion document entry ─────────────────────────
  BEGIN
    IF p_cert_url IS NOT NULL THEN
      INSERT INTO documents (client, name, "docType", file_url, file_name, notes, source, uploaded_by, created_at)
      VALUES (p_client_name, 'Certificate of Completion — ' || p_doc_type || ' — ' || p_client_name, p_saved_doc_type,
        p_cert_url, 'certificate_completion.pdf',
        'Signed by: ' || p_signed_by || ' | IP: ' || COALESCE(p_signer_ip,'') || ' | ' || p_signed_at::text,
        'E-Signature', 'System', p_signed_at);
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- ── Per-attachment signed-PDF document entries ───────────────────────
  BEGIN
    FOR v_att IN SELECT * FROM jsonb_array_elements(p_attachments)
    LOOP
      INSERT INTO documents (client, name, "docType", file_url, file_name, file_size, notes, source, uploaded_by, created_at)
      VALUES (
        p_client_name,
        'Signed ' || split_part(v_att->>'label', ' — ', 1) || ' — ' || p_client_name,
        p_saved_doc_type,
        v_att->>'url',
        (v_att->>'formType') || '_signed.pdf',
        (v_att->>'fileSize')::bigint,
        'Signed by: ' || p_signed_by || E'\nIP: ' || COALESCE(p_signer_ip,'') || E'\nDate: ' || p_signed_at::text || E'\n✅ Certificate of completion appended',
        'E-Signature', 'System', p_signed_at
      );
    END LOOP;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- ── Save signed_attachments back onto the esigns row ─────────────────
  BEGIN
    IF jsonb_array_length(p_attachments) > 0 THEN
      UPDATE esigns SET signed_attachments = p_attachments WHERE id = p_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('entity_type', v_entity_type, 'lead_id', v_lead_id);
END;
$$;

-- ── Grants — anon must be able to call these (unauthenticated signer) ──
GRANT EXECUTE ON FUNCTION esign_load(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION esign_mark_signed(text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION esign_finalize(text, text, text, text, text, timestamptz, text, text, jsonb) TO anon, authenticated;

SELECT 'E-Sign RPC conversion complete' AS status;
