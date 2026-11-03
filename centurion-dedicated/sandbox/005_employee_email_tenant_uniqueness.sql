-- Dedicated Centurion project only. Run before creating the second office.
-- Original schema wrongly requires employee emails to be globally unique.
-- One staff member can legitimately belong to more than one Centurion office.
DO $$
BEGIN
 IF EXISTS (
   SELECT 1 FROM public.employees
   WHERE email IS NOT NULL
   GROUP BY tenant_id,lower(trim(email))
   HAVING count(*)>1
 ) THEN RAISE EXCEPTION 'Duplicate employee email within office: reconcile first'; END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS employees_tenant_email_ci_unique
 ON public.employees(tenant_id,lower(trim(email)))
 WHERE email IS NOT NULL;
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_email_key;
