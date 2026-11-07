> **RETIRED / DO NOT DEPLOY** — Historical planning artifacts only. Centurion operates as `TRC-004` in the shared TaxResolution-CRM Supabase SaaS project (`mpxgxfqdbquzkrvvejkh`), together with TaxRes and TCR. Nashville is separately deployed. The former dedicated Centurion Supabase project is not an active environment. Do not execute the migrations, tenant resolver, or Edge Functions in this folder. This folder is retained only as a historical audit trail.

# Centurion dedicated SaaS tenant cutover

## Separation contract
- Dedicated Centurion Supabase project is authoritative for operational users, clients, cases, documents and communications.
- TCR's TRC-004 tenant remains a control-plane record; no cross-project record copying or silent dual writes.
- Nashville and TCR production tenant logic are out of scope.
- All new offices share the Centurion project, not its existing TRC-004 tenant ID.

## Verified blockers (2026-11-01)
1. Dedicated project current_tenant_id() returns a constant Centurion office UUID.
2. Dedicated invite-employee Edge Function uses a fixed TENANT_ID and fixed brand.
3. Dedicated project lists send-email, send-sms, send-fax and invite-employee; provision-tenant is absent.
4. Dedicated project has one existing office and 103 public tables with RLS; policies on clients, documents and employees rely on current_tenant_id().

## Mandatory dependency order (do not skip)
1. Build explicit auth-user-to-tenant memberships and a per-user selected tenant; default deny without a verified active membership.
2. Backfill and verify all existing Centurion users against their real auth identities *before* replacing the old resolver. Avoid client-editable user metadata.
3. Replace current_tenant_id() with a membership-checked resolver, and run authenticated positive/negative access checks.
4. Make all dedicated-project Edge Functions require the selected office, enforce permissions and derive branding/provider configuration per office.
5. Add a server-verified native office provisioner: create tenant, settings, admin membership, invitation, brand and audit event transactionally/idempotently; never create a new Supabase project by default.
6. Verify storage prefix policies, private document downloads, invites, SMS/email/fax, tenant switching, callbacks, billing, audit logs and office suspension.
7. Verify TCR's administrative Centurion entry does not cause operational dual-writes.
8. Test with a sandbox second tenant and two test identities; prove client/doc/employee/email access denies across offices in both directions; restore baseline.
9. Run security/performance advisors and release checks; only then seek explicit deploy.

## Release guard
Do not run the staged SQL on production, merge a migration into the shared TCR deployment pipeline, or create a customer office until the cross-office denial tests are green.
