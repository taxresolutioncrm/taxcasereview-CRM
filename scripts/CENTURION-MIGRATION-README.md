# Centurion CRM — guarded migration launcher

**Status:** sandbox tool only, NOT a completed migration.

## Purpose
Avoid per-function manual deployment while preventing accidental changes to Nashville, central TaxRes, or unrelated projects. The default Audit mode is read-only and requires neither Docker nor a database connection.

## Prerequisites
- Windows PowerShell, Node.js, Supabase CLI, and a checkout of this GitHub repository.
- Login to Supabase CLI for deployment only (`npx supabase login`).
- No service-role keys or DB passwords pasted into scripts.

## First run: inventory, no writes
From repository root:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\centurion-migrate.ps1
```
The script writes two files under `scripts/audit-output/`:
- `all-source-functions.txt`
- `review-candidates-not-approved.txt`

Candidate status does NOT mean safe to deploy. Inspect every function for required SQL schema, Storage, auth, secrets, provider integrations, and other offices' dependencies. Existing Centurion functions must be reconciled.

## Only after reviewed and sandbox-tested
Create an approved plain-text file with ONE function name per line. The script only deploys names in that file. Command:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\centurion-migrate.ps1 -Mode DeployApprovedFunctions -ApprovedFile .\approved-centurion-functions.txt -IUnderstandThisChangesCenturion
```
The CLI deploys each allowed function specifically to project `rkniemzmivnuhpdwkduc`. A second typed confirmation is required. **Do not create an approved list by copying the candidate list verbatim.**

## Not included
- No database dump or restore.
- No `db push`: existing Centurion tenant and three employee records must be protected.
- No Storage or Auth user migration.
- No central mail-relay secret provisioning.
- No claim of feature parity or ready-to-deploy status.

The existing sandbox branch `sandbox/centurion-password-branding-20261022` contains draft onboarding and mail relay work that has NOT passed end-to-end testing. Reconcile and test separately.
