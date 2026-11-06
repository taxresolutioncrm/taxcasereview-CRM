-- DRAFT ONLY: apply to isolated TaxRes/TCR sandbox and certify RLS before production.
-- Nashville v3.1.68 parity: tenant-authorized ledger aggregates without client-side page scans.
-- Intentionally SECURITY INVOKER; does not bypass the caller's RLS.
CREATE OR REPLACE FUNCTION public.tcr_transaction_summary(
  p_tenant uuid,
  p_search text DEFAULT NULL,
  p_associate text DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  WITH scoped AS (
    SELECT t.status, t.amount, t.associate
    FROM public.payment_transactions t
    WHERE auth.uid() IS NOT NULL
      AND p_tenant = public.current_tenant_id()
      AND t.tenant_id = p_tenant
      AND (p_search IS NULL OR p_search = '' OR t.client_name ILIKE '%' || replace(replace(p_search, '%', '\%'), '_', '\_') || '%' ESCAPE '\')
      AND (p_associate IS NULL OR p_associate = '' OR t.associate = p_associate)
      AND (p_from IS NULL OR t.payment_date >= p_from)
      AND (p_to IS NULL OR t.payment_date <= p_to)
  )
  SELECT jsonb_build_object(
    'totalRecords',count(*),
    'collectedCount',count(*) FILTER (WHERE status IN ('Posted','Cleared') AND amount > 0),
    'collectedAmount',COALESCE(sum(amount) FILTER (WHERE status IN ('Posted','Cleared') AND amount > 0),0),
    'returnedCount',count(*) FILTER (WHERE status IN ('Refunded','Chk Returned','Chargeback')),
    'disputedCount',count(*) FILTER (WHERE status = 'Disputed'),
    'failedCount',count(*) FILTER (WHERE status = 'FAIL')
  ) FROM scoped;
$$;
REVOKE ALL ON FUNCTION public.tcr_transaction_summary(uuid,text,text,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.tcr_transaction_summary(uuid,text,text,date,date) TO authenticated;
COMMENT ON FUNCTION public.tcr_transaction_summary(uuid,text,text,date,date)
IS 'Sandbox-only parity candidate; validate all status mappings, performance, and authenticated tenant isolation before release.';