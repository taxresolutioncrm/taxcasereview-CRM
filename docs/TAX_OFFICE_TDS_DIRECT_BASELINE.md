# Direct IRS TDS baseline for Tax Res CRM offices

This repository is the canonical baseline for TCR and future tax-office clones.

## Required behavior

- Direct IRS TDS is the preferred provider when an office has an approved IRS e-Services API Client ID and the official TDS/SOR product contract is configured.
- Manual IRS e-Services/TDS download remains available only as the fallback path.
- Direct mode must never appear connected unless the server-side IRS wire configuration is actually present.
- The browser never receives or stores IRS API secrets, IRS usernames/passwords, MFA codes, cookies, or session tokens.
- Client SSN/EIN, office CAF, POA/TIA state, requested tax years, and transcript types are resolved server-side and tenant-scoped.
- A signed-in employee must have IRS write permission (`perm_irs >= 2`) for direct submit/status operations.
- The POA/TIA must be `On File`, and every requested tax year must be inside the recorded POA/TIA year scope before a request is sent to the IRS.
- The CRM pull-request row is persisted before IRS submission. If submission fails, the same row stays available for retry; never create an untracked/orphan IRS transaction by submitting before persistence.
- Direct requests are tracked on `transcript_pull_requests` with provider transaction/status fields.
- Delivered PDFs are stored in the private `documents` bucket and keyed by SHA-256 result hashes so the same transcript cannot be filed twice.
- Multiple delivered PDFs are supported for one request. Outstanding direct requests resume after the IRS Portal is reopened and poll at 30-second intervals while work remains.
- Each delivered PDF is parsed, filed under the client, attached to the pull request, and counted only toward that request's coverage.
- Direct completion requires the requested year/transcript-type coverage for that pull request; unrelated older client transcripts do not satisfy the request.
- Manual watched-folder import remains available as the fallback path.

## Edge Function

`supabase/functions/transcript-pull/index.ts`

Supported actions:

- `capabilities` — reports whether the IRS wire contract is configured; never returns secrets.
- `submit` — submits an already-persisted direct request after authorization, POA/TIA, tenant, client TIN, CAF, and year-scope validation.
- `status` — checks IRS delivery status, de-duplicates returned PDFs, stores them in the private `documents` bucket, and returns the next unfiled result to the CRM.

## Database tracking

`supabase/migrations/20260917_tds_direct_adapter.sql` adds provider transaction/status fields plus arrays for delivered result hashes, stored file paths, and filed-result hashes. This supports retries, multiple results, reload recovery, and duplicate prevention.

## Required server-side configuration

Populate these only from the official IRS TDS/SOR product guide. Do not guess or hard-code unpublished endpoints/contracts.

Required:

- `IRS_TDS_WIRE_VERSION`
- `IRS_TDS_CLIENT_ID`
- `IRS_TDS_REQUEST_URL`
- `IRS_TDS_REQUEST_TEMPLATE`
- `IRS_TDS_STATUS_URL_TEMPLATE`

Authentication/response settings are configured as required by the official guide:

- `IRS_TDS_AUTH_MODE`
- `IRS_TDS_CLIENT_ID_HEADER`
- `IRS_TDS_EXTRA_HEADERS_JSON`
- `IRS_TDS_BEARER_TOKEN`
- `IRS_TDS_TOKEN_URL`
- `IRS_TDS_CLIENT_SECRET`
- `IRS_TDS_OAUTH_SCOPE`
- `IRS_TDS_REQUEST_METHOD`
- `IRS_TDS_RESPONSE_ID_PATH`
- `IRS_TDS_STATUS_METHOD`
- `IRS_TDS_STATUS_PATH`
- `IRS_TDS_PDF_BASE64_PATH`
- `IRS_TDS_DOWNLOAD_URL_PATH`

Only settings actually required by the official IRS product contract should be populated.

## IRS prerequisite

An IRS-issued e-Services API Client ID and the official TDS/SOR product guide/authorization are external prerequisites for a real IRS round-trip test. Direct mode must remain unavailable until those are issued and configured.

## Future-office rule

Every future tax office must inherit this adapter, migration, security model, saved-first submission flow, POA year-scope validation, result de-duplication, direct request-specific coverage logic, and manual fallback. Do not fork an office-specific TDS implementation unless the official IRS contract requires a real difference.
