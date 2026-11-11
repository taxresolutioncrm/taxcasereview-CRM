-- Read-only verification: run after applying the staged shared-project migration in an isolated sandbox.
-- No INSERT/UPDATE/DELETE; should be 0 mismatches before approving the coordinated release.
SELECT
  (SELECT count(*) FROM public.clients) AS clients_remaining,
  (SELECT count(*) FROM public.documents) AS documents_remaining,
  (SELECT count(*) FROM public.employees) AS employees_remaining,
  (SELECT count(*) FROM public.client_document_folders) AS custom_folders,
  (SELECT count(*) FROM public.client_document_folders f
     JOIN public.clients c ON c.id=f.client_id
     WHERE c.tenant_id IS DISTINCT FROM f.tenant_id) AS folder_client_tenant_mismatches,
  (SELECT count(*) FROM public.client_document_folders f
     LEFT JOIN public.client_document_folders p ON p.id=f.parent_folder_id
     WHERE f.parent_folder_id IS NOT NULL AND (p.id IS NULL
       OR p.tenant_id IS DISTINCT FROM f.tenant_id OR p.client_id IS DISTINCT FROM f.client_id))
    AS parent_mismatches,
  (SELECT count(*) FROM public.documents d
     JOIN public.client_document_folders f ON f.id=d.client_document_folder_id
     WHERE d.tenant_id IS DISTINCT FROM f.tenant_id OR d.client_id IS DISTINCT FROM f.client_id)
    AS document_folder_mismatches;

SELECT tenant_id, access,role,count(*) AS existing_role_assignments
FROM public.employees
WHERE tenant_id IN (
  'a0000000-0000-0000-0000-000000000001',
  '61a89aef-0e7e-4ea2-b222-44ab2024655a',
  '8fd9a2ac-95df-4bf0-99e9-cda4b20eae4a')
GROUP BY tenant_id,access,role ORDER BY tenant_id,access,role;

SELECT tablename,policyname,cmd,roles,qual,with_check
FROM pg_policies WHERE schemaname='public'
  AND tablename IN ('client_document_folders','clients','documents')
ORDER BY tablename,policyname;

SELECT relname,relrowsecurity,relforcerowsecurity
FROM pg_class WHERE oid='public.client_document_folders'::regclass;

SELECT
  EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='clients' AND column_name='revenueOfficerContact') AS revenue_contact_column,
  EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='clients' AND column_name='taxpayerAdvocateContact') AS advocate_contact_column,
  EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='documents' AND column_name='client_document_folder_id') AS document_folder_column;

-- Security test scenarios requiring authenticated test sessions in a private sandbox:
-- 1. Tenant A cannot SELECT/INSERT/UPDATE/DELETE Tenant B folders.
-- 2. perm_documents < 1 cannot read; perm_documents < 2 cannot create/rename/delete.
-- 3. Parent folder from another tenant/client is rejected by trigger.
-- 4. Cyclic hierarchy is rejected; same-name siblings fail unique index.
-- 5. Nonempty folder and folder with any subfolders cannot be deleted.
-- 6. A document cannot reference a folder from another client or tenant.
-- 7. Existing documents remain accessible with their original docType/storage_path.
-- 8. Authorized edits of Revenue Officer and Taxpayer Advocate fields survive reload.
-- 9. Tax Preparer cannot administer HR, billing, settings or bulk email.
