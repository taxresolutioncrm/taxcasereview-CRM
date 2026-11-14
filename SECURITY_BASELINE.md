# Shared Tax CRM — Security Baseline and External Reviewer Handoff

**Scope:** TCR / TaxRes / Centurion, shared Supabase project `mpxgxfqdbquzkrvvejkh`. Nashville operates independently and was not changed.

**Assessment date:** 2026-11-14. This document records verified controls and remaining review work; it is **not a penetration-test certificate** and must not be used to assert that any system is "100% bulletproof".

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

1. Complete authorization/abuse-case review of remaining Supabase Advisor privileged-function warnings. Counts verified again after v3.2.126: 58 anon-callable and 166 authenticated-callable privileged functions, **warnings, not automatically exploitable vulnerabilities**. Some are trigger-only and not callable as normal RPC endpoints.
2. Validate or replace UUID-only public organizer/financial-intake links where necessary; establish appropriate rate limits, expiration/revocation and abuse monitoring. Live database checks confirm public organizer/intake save functions accept a record UUID as their only capability but reject edits after submission; there is no separate expiry/revocation credential field in those form tables. Cloudflare Pages rules do not automatically protect a separate Supabase REST endpoint hostname.
3. Obtain a real authenticated smoke test for enabling/disabling autopay, as well as denied anonymous, expired, cross-tenant, and read-only-employee attempts, without using real payment changes.
4. Verify all three production frontends serve the latest shared release and test authenticated Home/Reports/Payments/department restrictions.
5. Independent, authorized staging penetration test; MFA/session revocation, disaster recovery restore test, incident response tabletop, software dependency review and WISP/FTC applicability review.
6. Supabase Advisor also reports 26 RLS-enabled tables without policies (often deliberately inaccessible) and one `pg_net` extension in `public`. Confirm their intended design and avoid blind schema moves. Search-path mutation warnings are now zero.

## External reviewer minimum evidence pack

Provide the exact production source commit; DB migration ledger and role grants (excluding secret values); security advisor export; RLS/role matrix; Cloudflare deployment IDs; anonymous-denial screenshots/logs; Edge Function version and checksums; signed-off browser regression reports; and documented residual risks with owners and retest status.

**Status:** Critical defects reported by Claude have been remediated and independently checked in the live backend. Final independent review and full operational sign-off **remain pending**.
