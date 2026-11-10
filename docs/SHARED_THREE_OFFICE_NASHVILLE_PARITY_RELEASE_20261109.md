# TCR / TaxRes / Centurion — coordinated Nashville parity candidate

**Status:** Application sandbox CI green. SQL migration staged, **not applied**. Deployment prohibited until an authorized, independently green database sandbox test and explicit user authorization.

## Source references
- Nashville PR #577, merged but initially described as WIP. Adapt only functionality actually present in the updated Nashville app.
- Nashville PR #578 for Recent Clients, browser-local only.
- Initial shared CRM PR #8400, branch `sandbox/three-office-nashville-parity-20261109`; production main advanced and requires a current-main successor.

## Shared production baseline (read-only audit, before modifications)
- Project: `mpxgxfqdbquzkrvvejkh` (TaxResolution-CRM), TaxRes ADMIN, TCR TRC-001, Centurion TRC-004.
- Clients: **10**, documents: **21**, employees: **14** at time of initial audit. No client_document_folders table yet.
- Existing access combinations include Super Admin, Admin, Manager, Sales Manager, Staff, CPA, Tax Associate and Tax Advisor. No existing role assignments were changed.
- Clients RLS: tenant-scoped; read needs perm_clients>=1, edit needs >=2.
- Documents RLS: tenant-scoped; read needs perm_documents>=1, insert/update >=2, delete >=3.
- Existing employee UI had silent unknown-column retry and no synchronous duplicate-save latch. Current implementation displays concrete DB errors, awaits reload and checks confirmations.

## Implementation
1. **Recent Clients**: last 10 opened via client detail navigation, not newly added list entries; search and direct links in navigation; key includes tenant plus normalized employee email. Updates same browser immediately via custom event and storage listener. No cross-device sync. The shared CRM stores the client number in `custnum` and v3.1.87 requires the exact empty state `No recently viewed clients`. Dashboard card untouched.
2. **Tax Preparer**: new access preset in employee form and AppContext. Default perm_clients=2, perm_documents=2, perm_irs=2, perm_schedule=1, perm_comms=1 (view only), perm_leads/billing/reports/hr/settings=0. The email blast action additionally checks Communications Edit; the pre-existing send-email backend independently requires perm_comms>=2. Super Admin and Tax Advisor untouched. New restrictive RLS policies scope Tax Preparer to assigned client and linked document rows; these require database testing before migration.
3. **IRS Contacts**: dedicated Revenue Officer and Taxpayer Advocate sections under IRS / Case Info, each editable with name, department, manager, phone, fax, email, address and notes. Save updates the target `clients` row by tenant+ID, fetches the newly saved fields and updates UI state.
4. **Nested folders**: new `client_document_folders` linked to client and tenant, with parent tree and sibling names unique case-insensitively, restricted cycles, referential integrity and RLS. Documents reference exact folder ID while retaining their original `docType` and storage fields. UI allows create/subfolder, select, upload, rename, and delete only empty folders via in-app dialog. Protects against stale folder-query responses when switching clients.
5. **Employee save**: guards concurrent save clicks, duplicates by office/email, fails closed if tenant unresolved, validates insert/update returns, shows errors, refreshes list. Any column-tolerance retries cannot strip tenant, role or perm_ fields.

## Database work staged, not executed
- `supabase/migrations/20261109180500_shared_three_office_contacts_and_nested_folders.sql`
- `supabase/verification/three_office_parity_post_migration.sql`
- Additive migration only: adds 2 JSONB contact columns, creates tenant/client folder table, adds optional documents folder FK; no backfill or deletion of old documents, no wholesale Nashville schema replacement.
- No Supabase development branch exists on the shared project. Creating one can incur extra cost, so one was **not** created without user consent.
- Before any deployment: test migration on a genuinely isolated, approved database environment; verify policy denies cross-tenant/cross-client access and delete of nonempty folders; verify existing document counts, archived documents, original storage paths, and employee role assignments before and after.

## Testing and deployment gates
- GitHub CI on release PR includes `npm run check-three-office-nashville-parity`, existing three-office Auth guards, UI quick actions, build and version gates.
- Previously passed run **42718304745** was before the v3.1.87 updates. A new candidate CI run must pass independently.
- Read-only production security advisors had no findings specifically naming the existing clients/documents/employees tables. This is not a security certification of new, unapplied folder schema.
- Signed-in, tenant-isolated browser QA remains: verify all three office logins/branding, Contacts save and reload, restricted Tax Preparer user, client history, nested folder desktop/tablet/mobile, folder uploads and permission failures, employee creation and list refresh.
- **Do not merge the open consolidated PR or deploy to Cloudflare; do not apply migration to the live shared Supabase project until the database and UI release are jointly green and explicitly authorized.**
