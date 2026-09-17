# Direct IRS TDS baseline for Tax Res CRM offices

This repository is the baseline for TCR and future tax-office clones.

## Required behavior

- Manual IRS e-Services/TDS download remains the fallback path.
- Direct IRS TDS activates only when the office/project has an approved IRS e-Services API Client ID and the official TDS/SOR product contract is configured.
- The browser never receives or stores IRS API secrets.
- The direct path resolves client SSN/EIN, office CAF, POA/TIA status, requested tax years, and transcript types server-side.
- Direct requests are tracked on `transcript_pull_requests` with provider transaction/status fields.
- The browser resumes outstanding direct requests when the IRS Portal loads, polls at 30-second intervals, securely downloads delivered PDFs, parses them, files them under the client, and updates request coverage/status.
- Manual watched-folder import stays available as fallback.

## Edge Function

`supabase/functions/transcript-pull/index.ts`

Supported actions:

- `capabilities` — reports whether the IRS wire contract is configured; never returns secrets.
- `submitDraft` — validates the CRM request and submits to IRS before the CRM row is inserted, returning the provider transaction id.
- `submit` — submits an already-saved direct request.
- `status` — checks IRS delivery status and stores the delivered PDF in the private `documents` bucket.

## Required server-side configuration

Populate these from the official IRS TDS/SOR product guide. Do not guess or hard-code unpublished endpoints/contracts.

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

Only the settings required by the IRS product guide should be populated.

## IRS prerequisites

The IRS requires an API Client ID for e-Services APIs including Transcript Delivery System (TDS) and Secure Object Repository (SOR). The TDS/SOR product user guide is obtained through the IRS e-Help Desk. Direct mode must remain unavailable until that approval/configuration exists.

## Future-office rule

A new tax office must inherit this adapter, migration, security model, and fallback behavior. Do not fork a separate office-specific TDS implementation unless an IRS contract requirement makes it necessary.
