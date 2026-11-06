# Client Document Folders — TaxRes / TCR / Centurion sandbox certification

Source reference: Nashville PRs #551 and #552 (do not copy Nashville tenant ID).

## Destinations (never run migration against wrong project)

- TaxRes + TCR (shared schema, separate tenants): `mpxgxfqdbquzkrvvejkh`
  - Migration: `supabase/migrations/20261106160000_taxres_tcr_client_document_folder_management.sql`
- Centurion (dedicated project): `rkniemzmivnuhpdwkduc`
  - Migration: `centurion-dedicated/migrations/20261106160000_centurion_client_document_folder_management.sql`
- **No connected destination sandbox project is currently provisioned.** The Nashville E2E sandbox is not a substitute. Do not run either migration against production without explicit per-CRM approval.

## SQL preflight in the correct destination sandbox

```sql
select
  exists (select 1 from information_schema.tables where table_schema='public' and table_name='clients') as clients,
  exists (select 1 from information_schema.tables where table_schema='public' and table_name='documents') as documents,
  exists (select 1 from information_schema.tables where table_schema='public' and table_name='employees') as employees,
  exists (select 1 from pg_proc where oid='public.current_tenant_id()'::regprocedure) as tenant_rpc;
select table_name,column_name,data_type from information_schema.columns
  where table_schema='public' and table_name in ('clients','documents','employees')
    and column_name in ('id','name','tenant_id','client','clientname','client_id','docType','access','perm_documents','status','email')
  order by table_name,column_name;
```

After applying reviewed migration to **sandbox only**, verify:
```sql
select c.relname,c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname in ('client_document_folders','client_document_folder_audit');
select p.proname,pg_get_function_identity_arguments(p.oid) args
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in
 ('create_client_document_folder','rename_client_document_folder','delete_empty_client_document_folder');
select tgname,tgenabled from pg_trigger
 where tgrelid='public.documents'::regclass and not tgisinternal
   and tgname='client_folder_document_write_lock';
```

## Required E2E accounts and cases

For **both** TaxRes and TCR (same DB but separate tenants), and **independently for Centurion**:

1. Two active document-edit employees: create `test`; rename to `Tax Documents`; cancel rename; confirm client folder selection, upload, preview, download, fax, AI Analyze.
2. Negative permissions: active read-only employee must be able to view permitted folders but must NOT create/rename/delete by calling RPC directly. Inactive users, unauthenticated users and another office's users must be denied even with an explicit foreign folder ID.
3. Duplicate names, casefold collision, built-in names, empty/control-character/over-80 names must fail.
4. Imported categories sharing a prospective custom name must block creation/rename (not take over imported documents).
5. Rename with canonical documents must change label of **all** linked documents atomically; no document/storage object removed. Legacy name-only documents must block rename until reconciled.
6. Delete a nonempty folder must fail; in-app confirmation must permit deletion of empty custom folders only. Built-in/imported folders have no management controls.
7. Concurrency: simultaneous upload to a custom folder and rename/delete must serialize safely; test two logged-in sessions. Change client tabs while a request is pending; folders must not bleed into the next client's view.
8. Verify custom folders survive refresh/relogin and are visible to a second authorized employee. Verify small-screen horizontal workspace behavior.
9. Verify the existing Documents upload, preview, download, fax, AI and navigation workflows; no blank screens or regressions.

## Rollback policy

Because migrations create a separate folder metadata table and add an upload-write lock trigger, rollback must be staged:

1. Stop any new folder writes. Record a count of custom folder rows and audit events.
2. Before deleting any schema object, confirm affected custom folders and document labels will remain navigable (the documents and storage objects must stay untouched).
3. Drop only the new document-write trigger, its trigger function, new folder RPCs, private validators, and folder-specific RLS/policies.
4. Drop the custom-folder and folder-audit tables **only if empty and explicitly approved**. Otherwise retain data for remediation and disable the feature in the frontend.
5. Never run `DELETE FROM public.documents` or delete storage objects as part of folder rollback. Do not drop other office data.

No migration has been applied to any destination database as part of this sandbox PR.
