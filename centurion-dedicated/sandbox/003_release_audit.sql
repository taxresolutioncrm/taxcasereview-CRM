-- Centurion dedicated backend: READ-ONLY PRE-DEPLOY AUDIT.
-- Run with execute_sql against dedicated Centurion project only.
-- No data or schema is modified.
SELECT 'all_public_rls' AS check_name,
  count(*) FILTER (WHERE NOT c.relrowsecurity) AS violations
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r';

-- Tenant-bearing operational tables must all have RLS enabled and a policy.
SELECT c.table_name,
  COALESCE(cl.relrowsecurity,false) AS rls_enabled,
  (SELECT count(*) FROM pg_policies p
   WHERE p.schemaname='public' AND p.tablename=c.table_name) AS policies
FROM information_schema.columns c
JOIN pg_class cl ON cl.relname=c.table_name
JOIN pg_namespace n ON n.oid=cl.relnamespace AND n.nspname='public'
WHERE c.table_schema='public' AND c.column_name='tenant_id'
  AND (NOT cl.relrowsecurity OR NOT EXISTS(
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname='public' AND p.tablename=c.table_name))
ORDER BY c.table_name;

-- Storage tenant boundaries: document paths must begin with tenant UUID.
SELECT policyname,cmd,qual,with_check FROM pg_policies
WHERE schemaname='storage' AND tablename='objects'
  AND policyname LIKE 'centurion_documents%'
ORDER BY policyname;

-- Pre-cutover continuity without listing personal data.
SELECT
 (SELECT count(*) FROM public.employees
  WHERE lower(coalesce(status,''))='active') AS active_employee_rows,
 (SELECT count(*) FROM auth.users) AS auth_identities,
 (SELECT count(*) FROM auth.users a JOIN public.employees e
  ON lower(trim(a.email))=lower(trim(e.email))
  WHERE lower(coalesce(e.status,''))='active') AS matched_logins;

-- After migrating memberships (on disposable isolated preview only):
-- Verify each existing active authenticated user has exactly one current office.
-- Verify absent membership => current_tenant_id() IS NULL.
-- Verify A-user cannot SELECT/INSERT/UPDATE/DELETE B-tenant clients/documents.
-- Verify document download/upload fails when first folder segment is B UUID.
-- Verify select_office(B) fails for A-only user and succeeds for B member.
-- Verify active user password reset and employee invite flow end-to-end.
