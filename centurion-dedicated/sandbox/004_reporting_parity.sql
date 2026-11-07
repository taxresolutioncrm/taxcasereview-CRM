-- Centurion DEDICATED project only (rkniemzmivnuhpdwkduc).
-- Never apply to the shared TCR/TaxRes database or Nashville.
-- Stage and run authenticated role/RLS checks before production.
-- Explicit active-employee JWT checks guard the existing Centurion resolver,
-- which currently returns a fixed office UUID.
CREATE OR REPLACE FUNCTION public.tcr_transaction_summary(
  p_tenant uuid,
  p_search text DEFAULT NULL,
  p_associate text DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
WITH verified_caller AS (
  SELECT e.tenant_id
  FROM public.employees e
  WHERE auth.uid() IS NOT NULL
    AND (auth.jwt()->>'is_anonymous') IS DISTINCT FROM 'true'
    AND lower(e.email) = lower(auth.jwt()->>'email')
    AND lower(coalesce(e.status,'')) = 'active'
    AND e.tenant_id = p_tenant
    AND e.tenant_id = public.current_tenant_id()
  GROUP BY e.tenant_id
  HAVING count(*) = 1
), scoped AS (
  SELECT t.status, t.amount
  FROM public.payment_transactions t
  JOIN verified_caller vc ON vc.tenant_id = t.tenant_id
  WHERE (p_search IS NULL OR p_search = '' OR
    t.client_name ILIKE '%' || replace(replace(p_search, '%', '\%'), '_', '\_') || '%' ESCAPE '\')
    AND (p_associate IS NULL OR p_associate = '' OR t.associate = p_associate)
    AND (p_from IS NULL OR t.payment_date >= p_from)
    AND (p_to IS NULL OR t.payment_date <= p_to)
)
SELECT jsonb_build_object(
  'totalRecords', count(*),
  'collectedCount', count(*) FILTER (WHERE status IN ('Posted','Cleared') AND amount > 0),
  'collectedAmount', COALESCE(sum(amount) FILTER (WHERE status IN ('Posted','Cleared') AND amount > 0),0),
  'returnedCount', count(*) FILTER (WHERE status IN ('Refunded','Chk Returned','Chargeback')),
  'disputedCount', count(*) FILTER (WHERE status = 'Disputed'),
  'failedCount', count(*) FILTER (WHERE status = 'FAIL')
) FROM scoped;
$$;
REVOKE ALL ON FUNCTION public.tcr_transaction_summary(uuid,text,text,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.tcr_transaction_summary(uuid,text,text,date,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.billing_productivity_report(start_on date, end_on date)
RETURNS TABLE(work_date date, staff_name text, entries bigint, hours numeric, recorded numeric, billed numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
WITH current_staff AS (
  SELECT e.name,e.email,e.access,e.team,e.perm_billing,e.tenant_id
  FROM public.employees e
  WHERE auth.uid() IS NOT NULL
    AND (auth.jwt()->>'is_anonymous') IS DISTINCT FROM 'true'
    AND e.tenant_id = public.current_tenant_id()
    AND lower(e.email) = lower(auth.jwt()->>'email')
    AND lower(coalesce(e.status,'')) = 'active'
),
caller AS (
  SELECT * FROM current_staff
  WHERE (SELECT count(*) FROM current_staff) = 1
),
allowed_staff AS (
  SELECT e.name,e.tenant_id
  FROM public.employees e
  JOIN caller c ON c.tenant_id = e.tenant_id
  WHERE lower(coalesce(e.status,'')) = 'active'
    AND (
      lower(e.email) = lower(c.email)
      OR (coalesce(c.perm_billing,0) >= 1 AND
        (c.access IN ('Admin','Super Admin')
         OR (c.access IN ('Manager','Sales Manager')
             AND nullif(btrim(c.team),'') IS NOT NULL AND e.team = c.team)))
    )
  GROUP BY e.name,e.tenant_id HAVING count(*) = 1
)
SELECT b.date::date,b.employee_name,count(*),
       coalesce(sum(b.hours),0),coalesce(sum(b.amount),0),
       coalesce(sum(CASE WHEN b.billed THEN b.amount ELSE 0 END),0)
FROM public.billing_time_entries b
JOIN allowed_staff a ON a.tenant_id = b.tenant_id AND a.name = b.employee_name
WHERE start_on IS NOT NULL AND end_on IS NOT NULL
  AND end_on >= start_on AND end_on <= start_on + 366
  AND b.date BETWEEN start_on AND end_on
GROUP BY b.date,b.employee_name
ORDER BY b.date DESC,b.employee_name;
$$;
REVOKE ALL ON FUNCTION public.billing_productivity_report(date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.billing_productivity_report(date,date) TO authenticated;
CREATE INDEX IF NOT EXISTS idx_centurion_billing_tenant_date_employee
  ON public.billing_time_entries(tenant_id,date DESC,employee_name);
