# TaxRes Payments — independent Nashville v3.1.83 parity audit

**Office/version candidate:** TaxRes ADMIN, v3.2.87.
**Actual Payments implementation:** `src/pages/Payments.jsx`, shared source in `taxcasereview-CRM`, with the existing TaxRes office's RLS permissions.

## Already working
- Client and invoice search; status and method selectors; sortable payment rows, client links and receipts.
- Total Collected, Pending, Payments, Failed and By Method summary presentation.
- Autopay scheduling and batch/charge actions, payment entry, edit/delete, invoice updates and other business operations. These are not rewritten.

## Gaps and source root causes
- No payment-effective-date range selectors. Payment page had a separate date editor field but no reporting filter.
- Every summary computed from unfiltered `items`, so filtering the list did not constrain summary totals.
- No native .xlsx export; old toolbar grouped all fields together inside a narrow desktop grid.

## Implemented in shared prerequisite PR
- Inclusive From/To based on `date` falling back to `created_at`. Same date scope now powers all five KPI/method summary calculations and transaction list.
- Search, status, method and sort remain independent list controls; export uses exactly final `sorted` list, not an independent raw query.
- Existing reusable SheetJS `exportReportXlsx` produces native Excel with Client, Invoice #, Amount (numeric), Method, Check #, Date, Status, Reference. Formula text protected; worksheet widths, header and Excel autofilter included.
- Responsive first-row search/dates and second-row status/method/Clear Dates/export controls; no new styles outside Payments.
- No payment record mutation on export and no changes to Autopay or payment gateways.

## Automated and manual gates
Automated: `check-payments-date-excel.mjs` validates boundary dates, date fallback, search/status/method and sorting combinations, summary totals, workbook ZIP identity, numeric amounts, header labels, filter, column widths and injection safety.
Manual pending: signed-in office account, mobile 320/375/390/430px, tablet 768px, desktop 1024+, export opened with Excel/LibreOffice, Autopay and payment-processor smoke tests, Cloudflare preview and final production commit.
**Release:** independent stacked draft PR. No merge/deployment authorized.

## Source and build evidence
The shared implementation in PR #8381 passed GitHub build diagnostics on commit `cc0c9ba85928fcede60150231eca817519a271ed` (including native XLSX roundtrip). A passing source build does not substitute for office-authenticated responsive testing.

## Read-only Payments schema/RLS preflight
The existing `payments` table has `date` (text), `created_at` (timestamptz), `amount` (text), client/invoice and method/status fields. It does **not** have `checkNum` or `reference` columns in the inspected project. The export retains those optional columns as blank when source values do not exist; no data is invented and no database schema is modified. Payments RLS is enabled and its existing authorization rules are unchanged. The on-screen date now uses the same effective-date fallback as filters and Excel.

Final office-branch GitHub CI check runs against `main` before this draft returns to its stacked review base; no production deployment is authorized.

**Dependency:** Centurion shared-SaaS authentication PR #8385 precedes the Payments implementation PR #8381; the shared project remains authoritative for all three offices.
