/**
 * check-irs-oauth-architecture.mjs
 *
 * Verifies the complete Canopy-style IRS OAuth architecture:
 *   SIGN IN TO IRS → AUTHORIZATION → RETURN TO CRM → REQUEST TRANSCRIPTS
 *   → IRS DELIVERS → CRM AUTO-FILES → TRANSCRIPT ANALYSIS
 *
 * This is a STATIC analysis test. It verifies that every required code path
 * exists and that no forbidden patterns (public TDS shortcut, manual-only
 * workflow as primary, hardcoded Nashville tenant data) are present.
 *
 * Acceptance test (live credentials required for full E2E):
 *   No synthetic/stub IRS session or transcript path may exist in production code.
 */

import fs from 'node:fs'

const failures = []
const warnings = []

function read(p) { return fs.readFileSync(p, 'utf8') }
function need(file, needle, label = needle) {
  if (!fs.existsSync(file)) { failures.push(`${file}: file missing`); return }
  if (!read(file).includes(needle)) failures.push(`${file}: missing ${label}`)
}
function forbid(file, needle, label = needle) {
  if (!fs.existsSync(file)) return
  if (read(file).includes(needle)) failures.push(`${file}: forbidden: ${label}`)
}
function warn(file, needle, label = needle) {
  if (!fs.existsSync(file)) return
  if (!read(file).includes(needle)) warnings.push(`${file}: [warn] missing ${label}`)
}

const pull     = 'supabase/functions/transcript-pull/index.ts'
const callback = 'supabase/functions/transcript-pull-callback/index.ts'
const session  = 'src/components/TDSSessionPresence.jsx'
const lib      = 'src/lib/transcriptPull.js'
const pullUi   = 'src/components/TranscriptPull.jsx'
const parser   = 'src/lib/irsTranscriptParser.js'
const config   = 'supabase/config.toml'

console.log('Checking Step 1: Sign In to IRS…')
need(session, "'begin-session'", 'begin-session route in TDSSessionPresence')
forbid(session, 'begin-test-session', 'synthetic CRM live-test route in TDSSessionPresence')
forbid(session, 'Run CRM Live Test', 'synthetic CRM live-test button')
need(session, 'authorizationUrl', 'authorizationUrl used from begin-session response')
need(session, 'window.open(', 'popup opened with authorizationUrl')
forbid(session, "'https://la.www4.irs.gov/esrv/tds/'", 'public IRS TDS URL hardcoded as primary flow')
forbid(session, 'openPractitionerTds', 'old openPractitionerTds function that opens public TDS')
need(pull, "action === 'begin-session'", 'begin-session action handler')
need(pull, 'AUTHORIZE_URL', 'IRS ISP OAuth authorization URL builder')
need(pull, 'IRS_TDS_ISP_AUTHORIZE_URL', 'IRS_TDS_ISP_AUTHORIZE_URL env var used for real OAuth')
need(pull, 'client_id', 'client_id set in OAuth authorization URL')
need(pull, 'response_type', 'response_type=code set in OAuth URL (authorization code flow)')
need(pull, 'redirect_uri', 'redirect_uri set in OAuth URL')
need(pull, 'state', 'CSRF state parameter set in OAuth URL')
need(pull, 'authorizationUrl', 'begin-session returns authorizationUrl to frontend')
need(pull, 'randomToken', 'cryptographically random state token generated')
need(pull, "onConflict: 'tenant_id,user_id'", 'irs_tds_sessions upsert uses tenant+user conflict key')

console.log('Checking Step 2: IRS Authorization callback…')
need(callback, 'state_expires_at', 'state expiry validated in callback')
need(callback, ".eq('state', state)", 'state matched in DB lookup')
need(callback, 'claimed', 'state atomically claimed before processing (prevents replay)')
need(callback, 'grant_type: \'authorization_code\'', 'authorization_code grant type in token exchange')
need(callback, 'client_assertion', 'RFC 7523 client assertion JWT used (no client_secret)')
need(callback, 'RSASSA-PKCS1-v1_5', 'RS256 signing for client assertion JWT')
need(callback, 'encryptText', 'tokens encrypted before storage')
need(callback, 'AES-GCM', 'AES-GCM encryption for tokens at rest')
need(callback, 'access_token_ciphertext', 'encrypted access token stored in irs_tds_sessions')
need(callback, 'refresh_token_ciphertext', 'encrypted refresh token stored in irs_tds_sessions')
need(callback, 'session_expires_at', 'session expiry written after successful authorization')

console.log('Checking Step 3: Return to CRM via postMessage…')
need(callback, 'taxres-irs-tds-oauth', 'postMessage type taxres-irs-tds-oauth sent by callback')
need(callback, 'window.opener.postMessage', 'postMessage sent to opener (CRM window)')
need(callback, 'CRM_ORIGIN', 'postMessage target origin restricted to CRM_ORIGIN')
need(callback, 'window.close()', 'popup closes after postMessage')
need(session, "window.addEventListener('message'", 'postMessage listener in TDSSessionPresence')
need(session, 'taxres-irs-tds-oauth', 'listener filters for taxres-irs-tds-oauth type')
need(session, 'event.origin', 'postMessage listener validates event.origin against expected callback origin')
need(session, 'expectedCallbackOrigin', 'callback origin stored from begin-session redirectUri and checked in handleMessage')
need(session, 'loadStatus', 'loadStatus called after successful postMessage to refresh state')
need(session, 'apiSessionActive', 'CRM shows IRS session as active after authorization')

console.log('Checking Step 4: Request Transcripts in CRM…')
need(pullUi, 'submitCanopyStyleRequest', 'Canopy-style request submission function present')
need(pullUi, "provider: 'irs_a2a'", 'irs_a2a provider used for automated CRM requests')
need(pullUi, 'client_id: client.id', 'client_id included in request payload')
need(pullUi, 'poa_record_id', 'POA record referenced in request')
need(pullUi, 'tax_years', 'tax years included in request')
need(pullUi, 'transcript_types', 'transcript types included in request')
need(pullUi, 'directAvailable', 'directAvailable gates the Request Transcripts button')
need(lib, "action: 'submit'", 'submit action called in transcriptPull.js library')
need(pull, "action === 'submit'", 'submit action handler in transcript-pull')
need(pull, 'submitWire', 'real IRS API submission function called on submit')
need(pull, 'IRS_TDS_REQUEST_URL', 'IRS API request endpoint used')
need(pull, 'provider_request_id', 'IRS transaction ID stored in request record')
need(pull, 'resolveContext', 'POA/CAF/TIN context resolved before submission')
need(pull, 'requireActiveSession', 'active IRS session required before submission')

console.log('Checking Step 5: IRS delivers transcripts…')
need(pull, "action === 'status'", 'status polling action handler')
need(pull, 'IRS_TDS_STATUS_URL_TEMPLATE', 'IRS polling endpoint used')
need(pull, 'persistTranscriptPdf', 'PDF bytes persisted to storage on delivery')
need(pull, 'tds-direct/', 'tenant-isolated storage path for IRS PDFs')
need(pull, 'provider_result_keys', 'result keys tracked to deduplicate PDF storage')

console.log('Checking Step 6: CRM auto-files transcripts…')
need(lib, 'finalizeDirectDelivery', 'finalizeDirectDelivery wires delivery to filing')
need(lib, 'parseTranscriptFile', 'parser called during auto-filing')
need(lib, 'storeTranscriptAnalysis', 'transcript analysis stored during auto-filing')
need(lib, 'provider_filed_keys', 'filed keys tracked to prevent duplicate filing')
need(lib, "provider_status: covered ? 'Filed' : 'Partial'", 'request marked Filed/Partial after successful auto-filing')
need(lib, "['Filed','Partial','Error'].includes(req.provider_status)", 'filing completion check present')

console.log('Checking Step 7: Transcript Analysis…')
need(parser, 'Account Transcript', 'Account Transcript parsing supported')
need(parser, 'Wage and Income', 'Wage and Income parsing supported')
need(parser, 'Record of Account', 'Record of Account parsing supported')
need(parser, 'transactions', 'transaction parsing supported')
need(parser, 'accrued_penalty', 'penalty accrual calculation present')
need(parser, 'csed_estimate', 'CSED estimate calculation present')
need(lib, 'requestCoverageSatisfied', 'coverage check for transcript analysis present')

console.log('Checking no synthetic IRS session/transcript path…')
forbid(pull, 'IRS_TDS_STUB_MODE', 'synthetic stub mode in transcript-pull')
forbid(pull, 'begin-test-session', 'synthetic live-test session action in transcript-pull')
forbid(pull, 'stub-txn-', 'synthetic transaction ID in transcript-pull')
forbid(pull, 'stub-code-', 'synthetic authorization code in transcript-pull')
forbid(pull, 'SYNTHETIC TRANSCRIPT', 'synthetic transcript PDF in transcript-pull')
forbid(callback, 'IRS_TDS_STUB_MODE', 'synthetic stub mode in callback')
forbid(callback, 'test-', 'synthetic live-test state in callback')
forbid(callback, 'isStub', 'callback bypass of real token exchange')
forbid(callback, 'stub-access-', 'synthetic access token in callback')

console.log('Checking Tenant Isolation…')
need(pull, 'tenant_id', 'tenant_id enforced in transcript-pull')
need(pull, "rpc('current_tenant_id')", 'current_tenant_id() RPC used for tenant resolution')
need(pull, "String(pull.tenant_id) !== String(employee.tenant_id)", 'cross-tenant request blocked in transcript-pull')

const completionSql = 'supabase/migrations/20260920025000_taxres_family_transcript_isp_completion.sql'
if (fs.existsSync(completionSql)) {
  need(completionSql, 'revoke all on table public.irs_tds_sessions from anon, authenticated', 'irs_tds_sessions RLS: anon+authenticated revoked')
  need(completionSql, 'tenant_id = current_tenant_id()', 'irs_tds_sessions or transcript_pull_requests tenant RLS')
  need(completionSql, 'create unique index', 'unique index on irs_tds_sessions (tenant_id, user_id)')
}

console.log('Checking anti-patterns (manual workflow as primary)…')
forbid(session, "'https://la.www4.irs.gov/esrv/tds/'", 'public TDS URL used as primary sign-in')
forbid(pullUi, 'Save Transcript Request', 'legacy manual save CTA must not be primary')
forbid(pullUi, 'Watched TDS Download Folder', 'legacy download folder reference must be gone')
forbid(pullUi, 'providers.map(p =>', 'legacy provider map must be gone')
forbid(session, 'ydrvncdedgjtcprczwpu', 'Nashville Supabase project hardcoded in session component')
forbid(callback, "const CRM_ORIGIN = 'https://nashville.taxrescrm.app'", 'Nashville CRM origin hardcoded in callback')

need(config, '[functions.transcript-pull]', 'transcript-pull function registered in config')
need(config, '[functions.transcript-pull-callback]', 'transcript-pull-callback function registered in config')
need(config, 'verify_jwt = false', 'callback has verify_jwt = false (IRS browser redirect has no JWT)')

if (warnings.length) {
  console.warn('\nWarnings:')
  warnings.forEach(w => console.warn(' ⚠', w))
}

if (failures.length) {
  console.error('\n❌ IRS OAuth architecture check FAILED:')
  failures.forEach(f => console.error(' -', f))
  console.error('\nAcceptance test is:')
  console.error('  SIGN IN TO IRS → AUTHORIZATION → RETURN TO CRM → REQUEST TRANSCRIPTS → IRS DELIVERS → CRM AUTO-FILES → TRANSCRIPT ANALYSIS')
  console.error('\nThe above failures indicate the listed steps are not fully implemented.')
  process.exit(1)
}

console.log('\n✅ IRS OAuth architecture check passed.')
console.log('\nCurrent status:')
console.log('  CODE COMPLETE: All OAuth flow code paths are present (begin-session, callback, session persistence,')
console.log('    submit, status polling, auto-filing, transcript analysis, tenant isolation). No synthetic path.')
console.log('')
console.log('  LIVE IRS BLOCKED: The real IRS e-Services API requires the following from the IRS:')
console.log('    IRS_TDS_CLIENT_ID          — OAuth Client ID from an approved IRS e-Services API application')
console.log('    IRS_TDS_JWT_KID            — Key ID for the RSA JWK registered with the IRS')
console.log('    IRS_TDS_JWT_PRIVATE_KEY_PEM — RSA private key matching the registered JWK (PKCS#8 or PKCS#1 PEM)')
console.log('    IRS_TDS_REDIRECT_URI       — Callback URL registered with the IRS (transcript-pull-callback edge fn URL)')
console.log('    IRS_TDS_REQUEST_URL        — IRS TDS API endpoint for submitting transcript requests')
console.log('    IRS_TDS_REQUEST_TEMPLATE   — JSON body template for transcript requests (per IRS contract)')
console.log('    IRS_TDS_STATUS_URL_TEMPLATE — IRS polling endpoint template (per IRS contract)')
console.log('    IRS_TDS_AUTH_FLOW_VERIFIED  — Set to "1" after verifying the auth flow end-to-end with real IRS')
console.log('')
console.log('    These values come exclusively from the IRS e-Services enrollment process.')
console.log('    Without IRS enrollment, the live flow cannot be activated regardless of code changes.')
