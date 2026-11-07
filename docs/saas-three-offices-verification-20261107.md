# SaaS architecture verification — TaxRes, TCR, Centurion

Audit date: 2026-11-07. Scope: shared TaxResolution-CRM project and shared frontend only; Nashville remains on separately deployed Nashville TaxCRM. The previous dedicated Centurion project is retired; do not use or provision it.

## Live database evidence (read-only SQL)
Central Supabase project `mpxgxfqdbquzkrvvejkh` is ACTIVE_HEALTHY.
- TaxRes admin tenant `a0000000-0000-0000-0000-000000000001`: active, 6 active employee records, 1 settings record, 4 payment records; 3 active employee emails have current shared Auth accounts and 3 do not. Those remaining invites/accounts are a separate personnel administration issue and have not been altered.
- Tax Case Review `61a89aef-0e7e-4ea2-b222-44ab2024655a`: active, 4 active employees with shared Auth accounts, 1 settings record, 0 payment records at audit time.
- Centurion Firm `8fd9a2ac-95df-4bf0-99e9-cda4b20eae4a`: trial, 3 active employee records, 3 corresponding shared Auth accounts, 1 settings record, 0 payment records at audit time.
- Across these office tenants, no active employee email maps to multiple tenant IDs.
- `get_branding_by_email_domain('centurionfirm.com')` resolves to the correct Centurion tenant and branding.
- `payments` has RLS enabled with authenticated tenant-scoped access via `current_tenant_id()`; anonymous SELECT is not granted. Other shared tenant tables have corresponding tenant policies.
- `current_tenant_id()` resolves a valid active/trial tenant using active employee membership and a separately authorized platform-admin override. The retired fixed-UUID Centurion resolver is not part of this central project.
- The Nashville production project is listed separately from the shared central project. No Nashville code or database was modified.

## Actual source defects corrected
1. `Login.jsx` still contained a host guard demanding `rkniemzmivnuhpdwkduc.supabase.co` (retired dedicated project), so Centurion on the correct shared backend would be blocked before login/password reset.
2. `scripts/check-three-office-auth.cjs` incorrectly required that obsolete backend and could reject a correct shared-SaaS fix.
3. Active product manual and release notes stated Centurion used a dedicated database; old staged cutover README did not warn against deployment.
4. Centurion Payments audit and older mobile audit claimed the wrong database topology; updated to current architecture.

## Fixed
- New isolated `src/lib/sharedSaasRouting.js` verifies that the Centurion branded host uses the active shared Supabase backend; a wrong/retired/malformed endpoint fails closed.
- `Login.jsx` uses the shared client for normal login and password reset. Existing Centurion branded login redirect, Nashville redirection, recovery logic and employee role authorization remain.
- Updated source-level and functional tests, release notes, active manual and retirement warning on stale cutover plans.
- No database SQL mutations, new paid services, Auth user creation/deletion, or tenant-policy changes.

## Still not certified by this audit
- Actual deployed Cloudflare VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for `centurionfirm.taxrescrm.app` and live authenticated sign-in/reset. Those require provider/deployment access.
- Authenticated cross-tenant browser/RLS tests with independent accounts, including platform-owner impersonation, still require sandbox login sessions.
- Other stale historical Centurion-dedicated planning files are intentionally retained only as archival context.
- Shared-auth candidate version overlaps open Payments parity PR #8381; reconcile release manifests before merge. Do not merge conflicting candidates unreviewed.

Production unaffected until an explicitly approved merge/release and verified Cloudflare production SHA.
