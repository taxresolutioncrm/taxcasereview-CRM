-- Candidate ONLY. Apply in the shared TaxRes/TCR sandbox after policy review.
-- Do not copy Nashville's app_private functions or change tenant RLS.
CREATE OR REPLACE FUNCTION public.billing_productivity_report(start_on date, end_on date)
RETURNS TABLE(work_date date, staff_name text, entries bigint, hours numeric, recorded numeric, billed numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
WITH current_staff AS (
  SELECT e.name, e.email, e.access, e.team, e.perm_billing
  FROM public.employees e
  WHERE auth.uid() IS NOT NULL
    AND e.tenant_id = (SELECT public.current_tenant_id())
    AND lower(e.email) = lower(auth.jwt()->>'email')
    AND e.status = 'Active'
    AND (auth.jwt()->>'is_anonymous') IS DISTINCT FROM 'true'
),
caller AS (
  SELECT * FROM current_staff WHERE (SELECT count(*) FROM current_staff) = 1
),
allowed_staff AS (
  SELECT e.name
  FROM public.employees e CROSS JOIN caller c
  WHERE e.tenant_id = (SELECT public.current_tenant_id())
    AND e.status = 'Active'
    AND (
      lower(e.email) = lower(c.email)
      OR (
        COALESCE(c.perm_billing,0) >= 1
        AND (
          c.access IN ('Admin','Super Admin')
          OR (c.access IN ('Manager','Sales Manager')
              AND NULLIF(btrim(c.team),'') IS NOT NULL AND e.team = c.team)
        )
      )
    )
  GROUP BY e.name
  HAVING count(*) = 1
)
SELECT b.date::date, b.employee_name, count(*) AS entries,
       COALESCE(sum(b.hours),0) AS hours,
       COALESCE(sum(b.amount),0) AS recorded,
       COALESCE(sum(CASE WHEN b.billed THEN b.amount ELSE 0 END),0) AS billed
FROM public.billing_time_entries b
WHERE start_on IS NOT NULL AND end_on IS NOT NULL
  AND end_on >= start_on AND end_on <= start_on + 366
  AND b.date BETWEEN start_on AND end_on
  AND b.tenant_id = (SELECT public.current_tenant_id())
  AND b.employee_name IN (SELECT name FROM allowed_staff)
GROUP BY b.date,b.employee_name
ORDER BY b.date DESC,b.employee_name;
$$;
REVOKE ALL ON FUNCTION public.billing_productivity_report(date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.billing_productivity_report(date,date) TO authenticated;
CREATE INDEX IF NOT EXISTS idx_tcr_billing_tenant_date_employee
  ON public.billing_time_entries(tenant_id,date DESC,employee_name);
