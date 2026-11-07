# Centurion Payments — independent Nashville v3.1.83 parity audit

**Office/version candidate:** Centurion Firm, v3.2.77.
**UI source:** `src/pages/Payments.jsx` in shared TaxRes/TCR frontend.
**Shared SaaS configuration:** Centurion is TRC-004 in the same TaxResolution-CRM Supabase project (`mpxgxfqdbquzkrvvejkh`) as TaxRes and TCR. The former dedicated Centurion project is retired. Centurion has its own staff, tenant-scoped settings and RLS-protected Payments records within this shared project. Live Cloudflare environment verification remains a separate release gate.

## Already working
Client/invoice search, existing status and payment-method selectors, sortable payments with receipts, payment recording/editor/deletion and invoice link/reversal, all summary tiles, collection-by-method display, Autopay and processor-dependent actions are already implemented in the shared code.

## Actual gaps
The prior Centurion Payments component had no date range state or report date selection; summary values were calculated from all payments, regardless of what was shown in the list; Excel export was absent; desktop filter toolbar could squeeze/wrap and did not separate search/dates from status/method/export controls. The client data and provider configurations are not part of this UI gap.

## Staged corrections in prerequisite #8381
Inclusive business `date` filtering, with `created_at` fallback; consistent date scope for list, Total Collected, Pending, count, failed count, collected by method. Original client/invoice search, method and status filters remain active. Sorted, filtered rows export using the pre-existing `exportReportXlsx` helper (real SheetJS .xlsx with numeric amounts, column widths, header and Excel autofilter). Date controls use own labels above fields; export appears on filter row two. Only Payments is changed.

## Testing and blockers
- Scripted tests: inclusive date boundaries, same-date filter, missing date fallback, combined date/search/status/method, amount sorting, no mutation, XLSX ZIP magic, numeric type, headers, widths, Excel autofilter and formula-injection safety.
- Pending Centurion signed-in tests at phone 320/375/390/430px, tablet 768px, desktop 1024+; role restrictions, Autopay, payment-record operations and generated spreadsheet review.
- **Critical:** validate that Centurion's live Cloudflare deployment uses the active shared SaaS backend; its old dedicated-project authentication guard is being repaired separately. No database migration is required for this Payments change.

**Release protocol:** dependent draft, no merge or production deployment until explicit authorization. No Nashville changes.

## Source and build evidence
The shared implementation in PR #8381 passed GitHub build diagnostics on commit `cc0c9ba85928fcede60150231eca817519a271ed` (including native XLSX roundtrip). A passing source build does not substitute for office-authenticated responsive testing.

## Read-only Payments schema/RLS preflight
The existing `payments` table has `date` (text), `created_at` (timestamptz), `amount` (text), client/invoice and method/status fields. It does **not** have `checkNum` or `reference` columns in the inspected project. The export retains those optional columns as blank when source values do not exist; no data is invented and no database schema is modified. Payments RLS is enabled and its existing authorization rules are unchanged. The on-screen date now uses the same effective-date fallback as filters and Excel.

Final office-branch GitHub CI check runs against `main` before this draft returns to its stacked review base; no production deployment is authorized.

**Dependency:** Centurion's retired dedicated-project login check is corrected by PR #8385 before Payments PR #8381; both target the one shared Supabase SaaS backend.
