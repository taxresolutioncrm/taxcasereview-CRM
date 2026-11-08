# Centurion Payments SaaS final release audit

## Architecture verified
- Centurion is TRC-004 in active Supabase TaxResolution-CRM project `mpxgxfqdbquzkrvvejkh`. TaxRes ADMIN and TCR TRC-001 are in this same project; Nashville operates a separate project.
- Centurion had three active employee records with three matching shared Auth accounts, and its tenant-specific settings and login branding RPC resolved correctly.
- `payments` RLS was enabled in shared project, with a tenant-scoped authenticated policy. Neither RLS nor Auth records were edited.
- Cloudflare Centurion project screenshots showed GitHub `taxresolutioncrm/taxcasereview-CRM`, `main`, `npm run build`, `dist`, and shared Supabase URL. Key was partially obscured and its exact match remains unverified. User confirms Centurion login works.
- The old dedicated Centurion Supabase reference is **retired** and must not be configured again.

## Code changes (shared CRM; limited to three offices)
- Payments date-range From/To, inclusive dates with `created_at` fallback, Clear Dates, summary calculations by range, search/status/method filters preserved, sorting and real .xlsx export.
- `src/lib/paymentsView.js` provides pure filtering and export data; `reportExcelExport.js` already available with SheetJS. Numeric Amount cells, headers, widths, worksheet autofilter.
- Payments toolbar adapts to phones/tablets. Autopay, charge/processor workflows, invoices, permissions, and other pages remain unchanged.
- Centurion branded login validates the shared SaaS Supabase URL and preserves server-side employee/tenant membership. Nashville routing remains separate.
- Fixed stale manual describing a dedicated Centurion database.

## Versions (candidate, not live)
- TaxRes 3.2.87; TCR 3.2.75; Centurion 3.2.76. Existing main features preserved.
- `npm run check-centurion-saas-routing`, `npm run check-three-office-auth`, and `npm run check-payments-date-excel` included in prebuild. Prior combined branch test passed; this rebased current-main candidate requires its own CI.
- No production deployment performed. Signed-in payment browser tests and actual Cloudflare release SHA must be verified after explicit release approval.
