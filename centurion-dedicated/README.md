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


## Current implementation in PR #8291 (sandbox only)
- `sandbox/001_memberships.sql`: verifies and backfills existing Auth employees before changing tenant resolver, grants scoped membership selection.
- `sandbox/005_employee_email_tenant_uniqueness.sql`: removes the blocking global employee-email unique constraint and replaces it with tenant-aware uniqueness.
- `sandbox/002_server_office_provision.sql`: service-only office transaction creates tenant, settings, owner/admin memberships AND local employee rows.
- `sandbox/004_users_directory_rls.sql`: closes the unrelated cross-office authenticated-all users directory policy (currently zero rows).
- `sandbox/provision-office/index.ts`: platform-owner-only invite-first provisioning handler; verified admin email mandatory before creation.
- `sandbox/invite-employee/index.ts`, `sandbox/send-email/index.ts`, `sandbox/send-sms/index.ts`, `sandbox/send-fax/index.ts`: dedicated-project Edge Function replacements.
- `src/pages/CenturionOffices.jsx`: native Add Office / Invite Administrator / Switch Office, loaded only against the dedicated Centurion project.
- `scripts/check-centurion-dedicated-saas.cjs`: required source-contract gate in the normal prebuild.

**Deployment MUST NOT rely on GitHub merge alone.** Files under `centurion-dedicated/sandbox/` are intentionally outside the shared TCR migrations/functions path. The dedicated Centurion project requires its own controlled Supabase deployment.

### Dedicated-project order (after isolated DB dry run and explicit deploy)
1. Before changing any live resolver, run exact-count, identity-match, duplicate email and staff/login verification. Make rollback plan.
2. Apply `001_memberships.sql` only after it passes on a disposable, isolated test database. This must not lock out the two existing signed-in Centurion identities.
3. Apply `005_employee_email_tenant_uniqueness.sql` before attempting to create a second office.
4. Apply `002_server_office_provision.sql`, then `004_users_directory_rls.sql` in the Centurion project only.
5. Deploy dedicated function slugs `centurion-provision-office`, `invite-employee`, `send-email`, `send-sms`, `send-fax` from the matching staged source. Do not change TCR/Nashville Edge Functions.
6. Validate existing login, invite recovery, office creation, same-identity multi-office selection, branded sender config, and complete signed-in RLS/storage negative tests for Office A vs B before accepting customers.
7. Verify Cloudflare Centurion runtime uses the **dedicated** Supabase URL and new CRM bundle. Publish exactly one approved release and check commit/function versions.

### Live readiness
As of this sandbox branch, **GitHub source checks are not live tenant-isolation certification**. No dedicated Supabase migration, Edge Function replacement, or two-office authenticated test has been reported complete. Do not mark production GO from a green GitHub build alone.
