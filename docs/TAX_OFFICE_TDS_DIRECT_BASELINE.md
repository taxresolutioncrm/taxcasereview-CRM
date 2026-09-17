# IRS TDS direct-pull baseline for Tax Res CRM offices

This repository is the canonical baseline for TCR and future tax-office clones.

## Required behavior

- The preferred direct-pull UX is practitioner sign-in to IRS e-Services from the CRM, matching the current documented Canopy pattern: ID.me/2FA, organization selection, IRS ISP authorization/grant, then a short-lived practitioner session.
- Manual IRS e-Services/TDS download remains available only as the fallback path.
- Direct mode must never appear connected unless the current signed-in practitioner has a live IRS-authorized session.
- The browser never receives or stores IRS passwords, MFA codes, cookies, or the short-lived IRS access token.
- Short-lived IRS session tokens are stored only server-side, encrypted at rest by the Edge Function, and expire no later than one hour.
- Client SSN/EIN, office CAF, POA/TIA state, requested tax years, and transcript types are resolved server-side and tenant-scoped.
- A signed-in employee must have IRS write permission (`perm_irs >= 2`) for direct submit/status operations.
- The POA/TIA must be `On File`, and every requested tax year must be inside the recorded POA/TIA year scope before a request is sent to the IRS.
- The CRM pull-request row is persisted before IRS submission. If submission fails or the IRS session expires, the same row stays available for retry; never create an untracked/orphan IRS transaction.
- Direct requests are tracked on `transcript_pull_requests` with provider transaction/status fields.
- Delivered PDFs are stored in the private `documents` bucket and keyed by SHA-256 result hashes so the same transcript cannot be filed twice.
- Multiple delivered PDFs are supported for one request. Outstanding direct requests resume after the IRS Portal is reopened and poll at 30-second intervals while work remains.
- Each delivered PDF is parsed, filed under the client, attached to the pull request, and counted only toward that request's coverage.
- Direct completion requires the requested year/transcript-type coverage for that pull request; unrelated older client transcripts do not satisfy the request.
- Manual watched-folder import remains available as the fallback path.

## Edge Functions

### `supabase/functions/transcript-pull/index.ts`

This remains JWT-protected and handles authenticated CRM actions:

- `capabilities` — reports safe session/setup state; never returns IRS tokens or credentials.
- `begin-session` — creates a one-time state + PKCE verifier, stores the verifier encrypted server-side, and returns the IRS authorization URL.
- `end-session` — clears the practitioner's short-lived IRS token.
- `submit` — submits an already-persisted direct request after practitioner-session, permission, POA/TIA, tenant, client TIN, CAF, and year-scope validation.
- `status` — checks IRS delivery status, de-duplicates returned PDFs, stores them in the private `documents` bucket, and returns the next unfiled result to the CRM.

### `supabase/functions/transcript-pull-callback/index.ts`

This is the IRS authorization redirect endpoint. It must be deployed with JWT verification disabled because the IRS redirect does not carry the CRM's Supabase JWT. It is still protected by one-time random state, short state expiry, and PKCE. It exchanges the IRS authorization response for the short-lived practitioner token, encrypts that token server-side, and never returns the token to the browser.

## Database tracking

`supabase/migrations/20260917_tds_direct_adapter.sql` adds provider transaction/status fields plus arrays for delivered result hashes, stored file paths, and filed-result hashes.

`supabase/migrations/20260917_tds_isp_session.sql` adds service-role-only session storage for the practitioner IRS authorization state, encrypted PKCE verifier, encrypted short-lived token, organization name, and expiry.

## Server-side contract configuration

Populate these only from the actual IRS/ISP contract for the registered Tax Res application. Do not guess unpublished URLs, field paths, or authorization parameters.

Session/authorization contract:

- `IRS_TDS_CLIENT_ID`
- `IRS_TDS_ISP_AUTHORIZE_URL_TEMPLATE`
- `IRS_TDS_ISP_TOKEN_URL`
- `IRS_TDS_ISP_TOKEN_BODY_TEMPLATE`
- `IRS_TDS_REDIRECT_URI`
- `IRS_TDS_ISP_TOKEN_CONTENT_TYPE` (only if the default form content type is not correct)
- `IRS_TDS_ISP_TOKEN_HEADERS_JSON` (only if required)
- `IRS_TDS_ISP_ACCESS_TOKEN_PATH` (defaults to `access_token`)
- `IRS_TDS_ISP_EXPIRES_IN_PATH` (defaults to `expires_in`)
- `IRS_TDS_ISP_ORGANIZATION_PATH` (only if returned)

Transcript request/delivery contract:

- `IRS_TDS_REQUEST_URL`
- `IRS_TDS_REQUEST_TEMPLATE`
- `IRS_TDS_STATUS_URL_TEMPLATE`
- `IRS_TDS_REQUEST_METHOD` (defaults to `POST`)
- `IRS_TDS_RESPONSE_ID_PATH` (defaults to `transactionId`)
- `IRS_TDS_STATUS_METHOD` (defaults to `GET`)
- `IRS_TDS_STATUS_PATH` (defaults to `status`)
- `IRS_TDS_PDF_BASE64_PATH` (only if applicable)
- `IRS_TDS_DOWNLOAD_URL_PATH` (only if applicable)
- `IRS_TDS_SESSION_AUTH_HEADER` / `IRS_TDS_SESSION_AUTH_PREFIX` (only if the contract differs from `Authorization: Bearer`)
- `IRS_TDS_CLIENT_ID_HEADER` / `IRS_TDS_EXTRA_HEADERS_JSON` (only if required)

The firm PTIN, EFIN, CAF, client TIN, POA/TIA, and requested years/types remain CRM data. Do not duplicate those into Edge Function secrets.

## Current external prerequisite

The application still needs the actual IRS-issued ISP/API registration values and request/delivery contract for the registered software integration before a real IRS round-trip can be proven. That is configuration/authorization, not a different CRM architecture.

## Future-office rule

Every future Tax Res office inherits this same signed-session adapter, migrations, security model, saved-first submission flow, POA year-scope validation, result de-duplication, request-specific coverage logic, and manual fallback. Each practitioner signs in through IRS e-Services for their own short-lived session; offices must not store or share IRS passwords or MFA codes.
