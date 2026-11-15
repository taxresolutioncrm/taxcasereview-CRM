# Shared Tax CRM — Security Baseline and External Reviewer Handoff

**Scope:** TCR / TaxRes / Centurion, shared Supabase project `mpxgxfqdbquzkrvvejkh`. Nashville operates independently and was not changed.

**Assessment date:** 2026-11-15 (latest evidence below; original audit retained). This document records verified controls and remaining review work; it is **not a penetration-test certificate** and must not be used to assert that any system is "100% bulletproof".

## November 15, 2026 — Current verified security state (supersedes older outstanding flags below)

**Production backend/source:** v3.2.132, merged commit `a47fcb363796d5d9b36b56bc509d6a420632807a`. Changes are scoped to the shared TCR/TaxRes/Centurion project; no Nashville project changes.

### Confirmed deployed fixes

- **v3.2.129**, PR #8447: 60-day default expiry and explicit revocation timestamps for new financial-intake and tax-organizer links; 90-day compatibility grace on existing records; all six public load/save/submit RPCs enforce expiry and revocation server-side. Existing draft answers preserved during link reissue.
- **v3.2.130**, PR #8449: failed PIN logins now persist rate-limit counters (instead of rolling them back on exception) for employee portal, time-clock kiosk and client portal. Three synthetic negative checks passed in a rollback-only transaction; no test counters left behind.
- **v3.2.131**, PR #8450: four database triggers immediately revoke opaque sessions on employee deactivation/PIN change, client/lead deletion or credential change, and office suspension.
- **v3.2.132**, PR #8451: revocation also covers changes to employee email/role/individual permission levels and client/lead email. Clears expired and invalid-identity opaque sessions; after production application, **0 employee portal sessions and 0 client portal sessions remained**, and the four triggers were enabled. This does **not** revoke unrelated Supabase Auth refresh tokens; core RLS tenant resolution independently checks employee active status.
- Prior **v3.2.121 / v3.2.123 / v3.2.128** address the anonymous e-sign bypass, autopay unauthorized mutation, and legacy URL-only document-upload bypass. **v3.2.126** cleared 13 mutable search-path warnings.

### Live non-destructive authorization evidence

- In a single rollback-only transaction, the database simulated the `authenticated` PostgreSQL role with claims from a real active non-owner staff identity in each of the **three** offices. The RLS tenant resolver matched each expected office and yielded **zero cross-tenant visible rows** in each of seven tables: clients, leads, cases, documents, esigns, tax_organizer_responses, financial_intake_responses. **21 cross-tenant read checks PASS.** This validates key database RLS logic, **not** real end-to-end sign-in/session behavior or write-denial under live staff JWTs. No names, emails, records or answers were returned.
- Storage audit: `documents`, `romylabs-esign`, `office-agreements`, `training-recordings`, `chat-attachments`, `chat-emojis`, and `voicemails` are private buckets; `avatars` and `firm-assets` are intentionally public. The documents policies enforce tenant context and employee document permissions.
- Live public frontend probe at v3.2.129: TCR/TaxRes shared login, Centurion login and shared password route each returned HTTP 200 and the matching release marker. Later v3.2.132 frontend publication has not been independently proven; v3.2.132 database migrations **are** verified.
- Latest Supabase Advisor: **0 mutable-search-path warnings**, **57 anonymous** and **165 authenticated privileged-function advisories** (not equivalent to 222 exploits), **26 no-policy-RLS INFO** tables, **1 pg_net extension-in-public WARN**. The `client_sensitive_fields` table is RLS-enabled with no direct anon/authenticated SELECT/INSERT. Do not invent deny-all policies just to suppress INFO.
- Database Auth `mfa_factors` currently reports **0 verified factors**, meaning mandatory MFA cannot be truthfully claimed active.

### Required final hardening before unrestricted security sign-off

1. **Replace SSN-last-four client PIN authentication** with independently verifiable email one-time codes or strong unique credentials, and validate actual message delivery, rate limits and migration for existing users. Do not silently lock out customers by removing the only live method before replacement acceptance.
2. **TOTP MFA enrollment, verification and server-side AAL2 authorization** for staff/admins. A factor belongs to each person's authenticator device; no operator can enroll it for them. Enrollment and locked-out-account recovery must be tested before mandating it for the entire workforce.
3. Migrate **long-lived stored signed document URLs** to path-based on-demand short-lived download URLs with proper client/staff authorization, preserving historical document previews/attachments and signed certificates.
4. Complete the **independent authorized penetration test** with actual signed-in multi-office users, denied writes, session invalidation, backup restore and incident response; in-production read-only JWT simulations do not replace it.
5. Assess each remaining privileged-function warning and dependency, including `pg_net`; a blanket revoke or extension relocation can break production workflows.

**Verdict: VERIFIED HARDENED; NOT YET INDEPENDENTLY CERTIFIED.** Do not report `PASS` for the above unresolved activities or imply that every Supabase Advisor warning is exploitable.

---

## November 14 — Production security correction v3.2.128

- **Legacy client-portal upload RPC:** Fixed live by PR #8445 and migration `20261114203000_portal_legacy_upload_rpc_lockdown.sql`. Anonymous and authenticated EXECUTE privileges are revoked on `public.portal_action_upload_document(text,text,text,text,bigint)`, service-role access retained. PostgreSQL role-grant catalog was rechecked after migration.
- **Existing supported upload path:** `portal-action` validates the portal session, accepted MIME types and size, creates its own tenant/client-specific storage key, uploads the bytes to storage and inserts the document record. The frontend uses this path and does not invoke the retired RPC. Source regression and frontend/browser CI passed.
- **Live Security Advisor as of this check:** 57 anon-callable privileged-function warnings, 165 authenticated-callable privileged-function warnings, 26 RLS-without-policy informational notices, 1 extension-in-public warning and **0** mutable function search-path warnings. These are not all demonstrated exploitable vulnerabilities; each privileged RPC must be assessed according to its intended access model.
- **Public organizer and financial-intake bearer links:** remain UUID-only. Current live counts, queried in aggregate without disclosing client data: one open organizer older than 90 days, five open financial intakes (three older than 90 days). A blind 90-day cutoff would break real open forms. Safe expiry, revocation, regeneration and rate controls require migration plus workflow-compatible tests; **NOT certified completed**.
- **Authenticated pentest / true cross-office negative access:** **NOT executed** with signed-in synthetic accounts. The existing staging-only test harness is CI-certified, but a dedicated three-office test environment or equivalent non-production test accounts were not available. Do not represent static code certification as a completed penetration test.
- **Live Cloudflare delivery:** exact deployed hashes for each of the three frontends were not independently available, and therefore deployment parity remains **UNVERIFIED**; a green GitHub build alone does not establish that the sites are serving the release.

## Confirmed remediation and evidence

| Risk | Status | Evidence / check |
| --- | --- | --- |
| Legacy anonymous ID-only e-sign RPCs | Fixed live | v3.2.121 PR #8436; migration `20261114014500_esign_legacy_rpc_public_execute_lockdown.sql`; PostgreSQL `has_function_privilege` returned false for `anon` and `authenticated` on `esign_load`, `esign_mark_signed`, `esign_track_event`, `esign_finalize`; `service_role` retained EXECUTE. |
| Unauthenticated client autopay | Fixed live | v3.2.123 PR #8438; deployed `stripe-set-autopay` Edge Function v43. Live source matched GitHub exactly. Portal session requires same client and tenant, non-lead, unexpired token; staff requires tenant context and billing edit permission. |
| Missing portal-session headers in autopay frontend | Source fixed, frontend deployment unverified | v3.2.123 PR #8438; ClientPortal enable/cancel requests and PortalAutopaySetup send `x-portal-token`. Browser certification passed on PR build. |
| Three employee-portal definer functions lacked `pg_temp` in search path | Fixed live | v3.2.124 PR #8439; `emp_clients(text)`, `emp_cases(text)`, `emp_sms_threads(text)` have `search_path=public, pg_temp`; bodies and grants were not rewritten. |
| Eight internal privileged functions cited in Claude H-3 | Already compliant live | PostgreSQL catalog checked eight exact names, all `search_path=public, pg_temp` (including ticket and LinkedIn functions). |
| Untimestamped legacy migration with grants to anon | Archived | Historical `esign_rpc_conversion.sql` removed from active `supabase/migrations`; preserved in `supabase/quarantine/legacy_esign_rpc_conversion_DO_NOT_RUN.sql`. Never execute archive in production. |
| Mutable SQL function search paths (13 warnings) | Fixed live | v3.2.126 PR #8441 and `20261114062000_search_path_advisor_closure.sql` pin `pg_catalog, public, pg_temp` on thirteen SECURITY INVOKER functions without changes to code bodies or grants; Supabase Security Advisor warning cleared (13 → 0). |

## Security architecture to validate during independent review

- Supabase tenant isolation uses table RLS and tenant-scoped policy functions; department selection is a **UI preference**, not data authorization.
- Sensitive SSN/TIN values are handled by `client-sensitive`, with server-side authorization checks and restricted database access.
- Public e-signature client uses `esign-archive-upload`, which checks ID and signer token and invokes privileged finalization with the server-side service role.
- A public Edge Function with `verify_jwt=false` must enforce its own authorization or validated webhook signature. Turning JWT verification off does **not** itself make a function secure.
- No production secrets, full taxpayer records, or Stripe credentials should be supplied to external reviewers. Use a sanitized test tenant, scoped read-only repository access, and synthetic data. Review any cross-border access to taxpayer records with qualified counsel before authorization.

## Outstanding items — do not represent as passed

1. Complete authorization/abuse-case review of remaining Supabase Advisor privileged-function warnings. Latest verified after v3.2.128: 57 anon-callable and 165 authenticated-callable privileged functions, **warnings, not automatically exploitable vulnerabilities**. Some are trigger-only and not callable as normal RPC endpoints.
2. Validate or replace UUID-only public organizer/financial-intake links where necessary; establish appropriate rate limits, expiration/revocation and abuse monitoring. Live database checks confirm public organizer/intake save functions accept a record UUID as their only capability but reject edits after submission; there is no separate expiry/revocation credential field in those form tables. Cloudflare Pages rules do not automatically protect a separate Supabase REST endpoint hostname.
3. Obtain a real authenticated smoke test for enabling/disabling autopay, as well as denied anonymous, expired, cross-tenant, and read-only-employee attempts, without using real payment changes.
4. Verify all three production frontends serve the latest shared release and test authenticated Home/Reports/Payments/department restrictions.
5. Independent, authorized staging penetration test; MFA/session revocation, disaster recovery restore test, incident response tabletop, software dependency review and WISP/FTC applicability review.
6. Supabase Advisor also reports 26 RLS-enabled tables without policies (often deliberately inaccessible) and one `pg_net` extension in `public`. Confirm their intended design and avoid blind schema moves. Search-path mutation warnings are now zero.

## External reviewer minimum evidence pack

Provide the exact production source commit; DB migration ledger and role grants (excluding secret values); security advisor export; RLS/role matrix; Cloudflare deployment IDs; anonymous-denial screenshots/logs; Edge Function version and checksums; signed-off browser regression reports; and documented residual risks with owners and retest status.

**Status:** Critical defects reported by Claude have been remediated and independently checked in the live backend. Final independent review and full operational sign-off **remain pending**.

## November 14 — Staging pen-test readiness and live read-only verification

- **Automation delivered:** v3.2.127, PR #8443, adds a manual-only, production-blocked synthetic isolation harness and `docs/STAGING_SECURITY_PENETRATION_TEST.md`. Static safety/build and browser certification passed. **No authenticated staging penetration test has run**, because the connected shared Supabase project currently has no development branch or configured synthetic multi-office users; the existing Nashville sandbox is a separate backend and cannot prove this shared platform's isolation.
- **Live read-only RLS check:** `clients`, `leads`, `cases`, `documents`, `esigns`, `client_notes`, `tenant_department_config`, `client_work_sessions`, `portal_sessions`, and `client_sensitive_fields` all have RLS enabled. RLS enablement alone is not a proof that each policy is correct.
- **Quarantine policy audit:** All **103** `central_legacy_nashville_quarantine` policies are **RESTRICTIVE**, meaning they cannot independently grant access to other tenants. No policy change was made. A preliminary review that omitted the `permissive` catalog column was corrected after full PostgreSQL verification.
- **Live security advisor:** 0 mutable-search-path warnings, 58 anonymous-callable privileged-function warnings, 166 authenticated-callable privileged-function warnings, 26 no-policy RLS informational notices, and 1 extension-in-public warning. These are distinct from verified exploitable findings.
- **External-review verdict:** Verified backend remediation is substantial, but the independent staging attack simulation, authenticated negative testing and Cloudflare production parity are **NOT CERTIFIED**. Do not claim PASS for those items until executed with evidence.
