# RomyLabs Tax CRM Family — Mandatory Audit & Certification Protocol

Scope: TCR, TaxRes, Centurion, CloudCPA and other applicable offices served by this repository. Nashville is explicitly excluded and is certified through its separate repository.

## Release gate
- NO-GO unless each mandatory lifecycle and adverse-path test below is backed by reproducible evidence for the exact SHA; compilation or static checks alone are insufficient.
- No live office or paying-client write tests. Use isolated sandbox tenants, synthetic client fixtures, role-specific test accounts and cleanup.
- For every applicable module: create, save, DB readback, close/reopen, edit, resave, browser refresh, sign-out/sign-in, and final DB readback.
- Run against existing synthetic fixtures and newly created synthetic rows; verify tenant IDs, role-scoped access, and preservation of untouched fields.
- Test error paths: rejected DB writes, unknown columns, timed-out requests, stale data, duplicate names, concurrent edits, partial API responses, and expired sessions.
- Record feature, environment, office, role, expected result, actual result, status (PASS/FAIL/UNTESTED/BLOCKED), and artifact (CI log, screenshot, DB query output).
- A confirmed defect requires a reproducer that fails before the fix and passes afterward, enforced by sandbox CI.
- A green Cloudflare preview and correct independent semantic version are necessary but not sufficient. Production merge only on explicit deploy; post-deploy smoke checks must use the exact deployed commit.

## Current certification matrix — baseline

| Workflow | Environment | Roles | Expected | Actual evidence | Status |
| --- | --- | --- | --- | --- | --- |
| Client create returns correct unique ID when names match | Sandbox | Owner/Admin/Associate | Exact inserted row reopened | Static regression source check added; browser and DB readback absent | UNTESTED |
| Client edit preserves ZIP/address, leading zeros, phone, EIN, DOB, financials/custom fields | Sandbox | All authorized roles | Every untouched column preserved across login/refresh | Code guard added; full browser DB verification absent | UNTESTED |
| Masked SSNs and spouse SSNs preserved when not edited | Sandbox | Authorized client editors | No erasure | Source guard added; synthetic DB readback absent | UNTESTED |
| Blank/zero/formatted values and validation failures | Sandbox | Authorized client editors | No false success or unrelated data loss | No DB-backed evidence | UNTESTED |
| Concurrent edits and stale forms | Sandbox | 2 authorized users | Detect conflicts or preserve unrelated changes | No concurrency proof | UNTESTED |
| Tenant isolation / all supported roles | Sandbox | Owner/Admin/Associate/Para/Sales | Correct allowed/denied read/write | No multi-office browser/RLS evidence | UNTESTED |
| All other modules full lifecycle + adverse paths | Sandbox | Per module | Persist reliably after reload/login | Not executed | UNTESTED |
| Cloudflare preview, exact SHA and build | Sandbox | CI | Green on exact SHA | Awaiting check completion | UNTESTED |
| Production smoke / deployed SHA | Production | Authorized test roles | Exact version and workflows verified | No deployment authorized | BLOCKED |

**Verdict: NO-GO for full CRM certification.** This matrix must be updated with actual evidence before declaring readiness.
