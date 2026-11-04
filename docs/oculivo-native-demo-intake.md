# Oculivo native demo requests → RomyLabs Admin Portal

This change adds a **separate** lead pipeline for Oculivo website contact requests (without creating fake calendar appointments), independent of the existing product-aware /book flow.

## Current release candidate (sandbox only)

- Website PR: https://github.com/taxresolutioncrm/oculivo-site/pull/16
- Admin Portal PR: https://github.com/taxresolutioncrm/taxcasereview-CRM/pull/8307
- PR #8299 was superseded and closed after newer Admin Portal code caused merge conflicts; **never merge that old PR**.
- Actual Admin Supabase project was checked read-only on 2026-11-03: `public.romylabs_demo_requests` is **absent**, `oculivo-demo-intake` is **not deployed**, while `public._is_platform_admin()` and `public.romylabs_stalwart_transport_for_product(text)` exist.
- The existing Stalwart RPC for `romylabs` is service-role-only and identifies `info@romylabs.com` as the authorized generic sender. Never display or use private personal addresses as senders.
- Website mock flow certifies downstream 2xx **and** JSON `ok:true`, 200 with `ok:false` rejection, malformed 200 responses, cross-origin rejection, idempotent retry, missing secret and 503 fallback.
- Admin mock runtime certifies bearer authorization, wrong product, invalid contact, durable insert, branded Stalwart submission, idempotent UUID, and recorded mail outage.
- Both repositories' sandbox build gates must be reconfirmed on their exact final SHAs before production deployment. CI previews are **not production**.

## Supabase/Deployment target
- Repo: `taxresolutioncrm/taxcasereview-CRM`
- Admin Supabase project: `mpxgxfqdbquzkrvvejkh`, distinct from Oculivo's CRM Supabase project `czejdbdwaumbdepiswcu`
- Migration: `supabase/migrations/20261103_oculivo_demo_requests.sql`
- Edge Function: `supabase/functions/oculivo-demo-intake/index.ts`, `verify_jwt=false` **with server-side bearer secret validation**
- Supabase function secret: `OCULIVO_LEAD_WEBHOOK_SECRET` (same value as the Cloudflare Worker secret, never committed).
- Oculivo site Worker defaults to `https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/oculivo-demo-intake`; optional `OCULIVO_LEAD_WEBHOOK_URL` overrides it only for authorized staging/migration. This public URL does not need a secret.
- Cloudflare `oculivo-site` Worker requires one private secret named `OCULIVO_LEAD_WEBHOOK_SECRET`; add the identical value in Admin Supabase Edge Function secrets. Wrangler now refuses deploy if the Worker secret is missing.
- Admin route: `/crm-admin/tasks` now displays `AdminOculivoDemoRequests` above existing scheduled booking alerts.
- Existing provider: Stalwart via `romylabs_stalwart_transport_for_product('romylabs')`; no new email provider.
- Admin audit: `notification_submission_id` means Stalwart accepted an email submission; it does **not** certify delivery to the inbox.

## No silent lead loss
- Submission is inserted in `romylabs_demo_requests` **before** Stalwart is called.
- A new Admin Portal follow-up task is created inherently by the row's default `followup_status='new'`, `assigned_to='RomyLabs Admin'` and `followup_due_at`.
- If mail submission fails, the lead remains in the table and `notification_last_error` records the failure for the Tasks UI.
- Retried requests carry the same UUID, preventing duplicates.
- Anonymous browser users have no direct table permissions; only the server endpoint inserts using its service role.
- Staff access is restricted to existing `_is_platform_admin()` policies. Never grant anon insert/select.
- Existing scheduled demo pipeline remains in `calevents` and `romylabs_booking_alerts` untouched.

## Release gate
- [ ] Admin main + Oculivo site main remain synchronized; test exact sandbox SHAs, no unrelated deployments.
- [ ] Apply this migration in **Admin Supabase project only**; verify table/index/RLS and admin-only access.
- [ ] Deploy `oculivo-demo-intake` in Admin Supabase with `verify_jwt=false`; set secret securely.
- [ ] Configure corresponding Cloudflare site Worker endpoint/secret without exposing credentials.
- [ ] Run `npm run check-oculivo-lead-intake` and Admin production build/test suite.
- [ ] End-to-end POST creates exactly one row; retry same `request_id` does not duplicate.
- [ ] New lead appears on Admin Portal Tasks, with owner/status/outcome and email-audit state.
- [ ] Confirm email submission via Stalwart plus a real inbox-delivery test. If mail fails, lead/task persists.
- [ ] Verify admin-only RLS and unauthorized webhook rejection, invalid product/source, and wrong secret.
- [ ] Existing `/book?product=oculivo` calendar bookings still create alerts and email.
- [ ] Validate Oculivo CRM/site ownership, tenant separation, provider secrets and branding.
- [ ] Do not claim production readiness, and do not merge/deploy until explicit authorization.

**Unverified:** Migration applied? No. Function deployed? No. Secret configured? No. Live email delivery and booking/lead runtime tests? Not yet. This document is an implementation/release contract, not a production certificate.
