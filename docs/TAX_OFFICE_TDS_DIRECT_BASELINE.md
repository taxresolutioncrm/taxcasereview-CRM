# IRS TDS direct-pull baseline for Tax Res CRM offices

This repository is the canonical baseline for TCR and future tax-office clones.

## Required behavior

- The preferred direct-pull UX is practitioner sign-in to IRS e-Services from the CRM: IRS login/consent, authorization code redirect, then a short-lived practitioner session.
- Manual IRS e-Services/TDS download remains available only as the fallback path.
- Direct mode must never appear connected unless the current signed-in practitioner has a live IRS-authorized session.
- The browser never receives or stores IRS passwords, MFA codes, cookies, private signing keys, access tokens, or refresh tokens.
- IRS access/refresh tokens are stored only server-side, encrypted at rest by the Edge Function.
- The IRS authorization guide documents 15-minute access tokens and a refresh-token window that ends after one hour; after that the practitioner signs in again.
- Client SSN/EIN, office CAF, POA/TIA state, requested tax years, and transcript types are resolved server-side and tenant-scoped.
- A signed-in employee must have IRS write permission (`perm_irs >= 2`) for direct submit/status operations.
- The POA/TIA must be `On File`, and every requested tax year must be inside the recorded POA/TIA year scope before a request is sent to the IRS.
- The CRM pull-request row is persisted before IRS submission. If submission fails or the IRS session expires, the same row stays available for retry.
- Delivered PDFs are stored in the private `documents` bucket and keyed by SHA-256 result hashes so the same transcript cannot be filed twice.
- Direct completion requires the requested year/transcript-type coverage for that pull request; unrelated older client transcripts do not satisfy the request.

## IRS ISP authorization model

The IRS e-Services API Authorization User Guide documents ISP authorization as OAuth 2.0 Authorization Code flow plus a Client Credentials JWT signed with the registered application's RSA private key.

Production authorization endpoint:

`https://api.www4.irs.gov/auth/oauth/v2/authorize`

Production token endpoint:

`https://api.www4.irs.gov/auth/oauth/v2/token`

The Client Credentials JWT uses:

- `iss` = IRS API Client ID
- `sub` = IRS API Client ID
- `aud` = IRS token endpoint
- `iat` = issued-at time
- `exp` = no more than 15 minutes
- `jti` = unique JWT ID
- JWT header `alg` = `RS256`
- JWT header `kid` = key ID registered in the JWK set

Authorization-code token exchange sends:

- `grant_type=authorization_code`
- `code=<IRS authorization code>`
- `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`
- `client_assertion=<signed Client Credentials JWT>`

Refresh sends:

- `grant_type=refresh_token`
- `refresh_token=<IRS refresh token>`
- the same `client_assertion_type`
- a newly signed `client_assertion`

Protected e-Services API calls use `Authorization: Bearer <access token>`.

## Edge Functions

### `supabase/functions/transcript-pull/index.ts`

JWT-protected CRM actions:

- `capabilities` — returns safe session/setup metadata only.
- `begin-session` — creates a one-time random state and returns the IRS authorization URL.
- `end-session` — clears the practitioner's server-side IRS session.
- `submit` — submits an already-persisted request after session, permission, POA/TIA, tenant, TIN, CAF, and year-scope validation.
- `status` — refreshes a 15-minute access token when needed, checks IRS delivery state, de-duplicates PDFs, stores delivered documents, and returns the next unfiled result.

### `supabase/functions/transcript-pull-callback/index.ts`

IRS redirect endpoint. Deploy with Supabase JWT verification disabled because the IRS redirect does not carry a CRM JWT. Security is provided by the one-time random state, 10-minute authorization-code/state window, registered callback URI, and the IRS-required signed Client Credentials JWT. The callback exchanges the code for access/refresh tokens, encrypts them server-side, and never sends them to the browser.

## Database tracking

`supabase/migrations/20260917_tds_direct_adapter.sql` adds provider transaction/status fields plus arrays for delivered result hashes, stored file paths, and filed-result hashes.

`supabase/migrations/20260917_tds_isp_session.sql` stores service-role-only authorization state, encrypted access/refresh tokens, access-token expiry, and the one-hour practitioner-session expiry.

## Required registered-application configuration

Authorization values:

- `IRS_TDS_CLIENT_ID` — IRS-issued API Client ID
- `IRS_TDS_JWT_KID` — `kid` of the RSA JWK registered with IRS
- `IRS_TDS_JWT_PRIVATE_KEY_PEM` — matching PKCS#8 private key; server secret only
- `IRS_TDS_REDIRECT_URI` — callback URI registered in the IRS API Client ID application
- `IRS_TDS_ISP_AUTHORIZE_URL` — optional; defaults to the documented production authorization endpoint
- `IRS_TDS_ISP_TOKEN_URL` — optional; defaults to the documented production token endpoint

The public IRS authorization guide defines the authentication mechanics above. The product-specific TDS/SOR guide is still required for the exact transcript request/delivery resource contract:

- `IRS_TDS_REQUEST_URL`
- `IRS_TDS_REQUEST_TEMPLATE`
- `IRS_TDS_STATUS_URL_TEMPLATE`
- `IRS_TDS_REQUEST_METHOD` (defaults to `POST`)
- `IRS_TDS_RESPONSE_ID_PATH` (defaults to `transactionId`)
- `IRS_TDS_STATUS_METHOD` (defaults to `GET`)
- `IRS_TDS_STATUS_PATH` (defaults to `status`)
- `IRS_TDS_PDF_BASE64_PATH` (only if applicable)
- `IRS_TDS_DOWNLOAD_URL_PATH` (only if applicable)
- `IRS_TDS_EXTRA_HEADERS_JSON` (only if the product contract requires additional resource headers)

PTIN, EFIN, CAF, taxpayer TIN, POA/TIA, years, and transcript types remain CRM data. Do not duplicate them into Edge Function secrets.

## Future-office rule

Every future Tax Res office inherits this signed-session adapter, migrations, server-key security model, saved-first submission flow, POA year-scope validation, token refresh, result de-duplication, request-specific coverage logic, and manual fallback. IRS credentials and MFA are never stored in the CRM.
