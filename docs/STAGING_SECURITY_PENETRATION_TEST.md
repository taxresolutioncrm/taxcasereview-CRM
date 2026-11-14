# Independent security test — synthetic staging only

This test is for the **shared TCR / TaxRes / Centurion architecture**. Nashville is a different backend and is outside scope.

## Current execution status

**NOT EXECUTED against a full staging environment as of 2026-11-14.** The connected shared project currently has no Supabase development branch. An existing Nashville sandbox is not an acceptable substitute. Do not run the legacy `scripts/certify-three-tenant-isolation.mjs` against production: it creates and deletes records and contains obsolete tenant IDs.

The test harness `scripts/staging-security-negative-tests.mjs` refuses known production project references and requires explicit synthetic-write authorization. It does not accept a service-role key and uses only authenticated test accounts and a public key.

## Required staging prerequisites

1. A **dedicated, isolated Supabase test project** containing the same migrations and security policies as the shared live CRM, with no taxpayer data. Creating a branch may incur additional costs; obtain approval before creation.
2. Three distinct synthetic tenants labelled `tcr`, `taxres`, `centurion`; one active employee test account for each, and one restricted read-only employee test account in one of those tenants.
3. Each account has a synthetic client row in its own tenant. Each client name must start with `STAGING_PENTEST_`. Never use real clients, signing documents, payment methods or Stripe production credentials.
4. Set CI secrets `STAGING_SECURITY_SUPABASE_URL`, `STAGING_SECURITY_ANON_KEY`, `STAGING_SECURITY_TEST_ACCOUNTS_JSON`, not in Git or issue bodies. Account JSON objects contain `role` (`tcr`, `taxres`, `centurion`, `readonly`), `email`, `password`, `tenantId`, `ownClientId`, `expectedName`. Prefer unique credentials per account.
5. Workflow must be started explicitly from Actions; it never runs on push and never deploys.

## Checks in the harness

- Each test user successfully logs in and resolves only their configured tenant.
- Each user sees their own synthetic client and none of the other two offices' synthetic clients.
- Cross-office updates return no changed rows or explicit policy failures.
- The read-only user cannot edit its own synthetic record.
- Anonymous direct calls to the legacy `esign_load` and `esign_mark_signed` RPCs are rejected at the privileges/API layer, **not merely because the record ID is absent**.
- Anonymous `stripe-set-autopay` POST returns 401/403 without modifying the synthetic client's settings.

The workflow uploads a JSON evidence artifact. Any failed assertion must be treated as a **FAIL**, not automatically retried, and reviewed before any production change. Additional signed-in e-signature, card setup, account deactivation, MFA and Cloudflare WAF behavior require separate authorized tests; the harness does **not** certify these.

## Security rules

- No use of production URLs, production accounts, payment instruments, or customer records.
- No service role key in this test process.
- Do not log test passwords or API keys.
- No stress testing, availability attacks, mass enumeration or brute force.
- A passing automated suite is supplementary evidence; a professional independently authorized penetration test remains outstanding.
