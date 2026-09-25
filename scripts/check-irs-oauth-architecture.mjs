/**
 * check-irs-oauth-architecture.mjs
 *
 * Verifies the complete Canopy-style IRS OAuth architecture:
 *   SIGN IN TO IRS → AUTHORIZATION → RETURN TO CRM → REQUEST TRANSCRIPTS
 *   → IRS DELIVERS → CRM AUTO-FILES → TRANSCRIPT ANALYSIS
 *
 * This is a STATIC analysis test. It verifies that every required code path
 * exists and that no forbidden patterns (public TDS shortcut, manual-only
 * workflow as primary, hardcoded TCR tenant data) are present.
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
const portal   = 'src/pages/IRSPortal.jsx'
const parser   = 'src/lib/irsTranscriptParser.js'
const config   = 'supabase/config.toml'

console.log('Checking Step 1: Sign In to IRS (rep\'s own login in a popup)…')
if (fs.existsSync(session)) failures.push(`${session}: must be removed (API-credential sign-in panel replaced by the IRS popup)`)
need(lib, "export const IRS_POPUP_NAME = 'taxres-irs-tds'", 'named IRS popup window')
need(lib, 'w.opener = null', 'popup cut off from the CRM window')
need(lib, '<meta name="referrer" content="no-referrer">', 'popup opens IRS with no referrer')
need(lib, 'freshPopups', 'only a freshly opened popup is closed on save failure')
need(portal, 'openIrsPopup(IRS_TDS_URL)', 'IRS Portal opens the real IRS TDS page in the popup')
for (const f of [lib, pullUi, portal]) {
  forbid(f, 'begin-test-session', 'synthetic CRM live-test route')
  forbid(f, 'Run CRM Live Test', 'synthetic CRM live-test button')
  forbid(f, 'IRS_TDS_STUB_MODE', 'stub mode')
}
forbid(pullUi, 'API credentials', 'API-credentials message in the transcript UI')
forbid(pullUi, '<TDSSessionPresence', 'old API sign-in panel')
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

console.log('Checking Step 3: Helper returns transcripts to the CRM…')
need(pullUi, 'event.source !== window || event.origin !== window.location.origin', 'helper messages accepted only from this page and origin')
need(pullUi, 'data.source !== HELPER_SOURCE', 'helper messages filtered by source')
need(pullUi, "'%PDF-'", 'returned files must be real PDFs')
need(pullUi, '/taxres-irs-helper.zip', 'helper download link')
need('public/taxres-irs-helper.zip', 'crm-bridge.js', 'helper zip published')
need('extensions/taxres-irs-helper/mailbox.js', "sendBtn.addEventListener('click', sendAll)", 'Secure Mailbox sends only on click')

console.log('Checking Step 4: Request Transcripts in CRM…')
need(pullUi, 'submitCanopyStyleRequest', 'Canopy-style request submission function present')
need(pullUi, 'provider: BROWSER_PROVIDER_ID', 'browser-assisted IRS TDS request provider')
need(pullUi, 'client_id: client.id', 'client_id included in request payload')
need(pullUi, 'poa_record_id', 'POA record referenced in request')
need(pullUi, 'tax_years', 'tax years included in request')
need(pullUi, 'transcript_types', 'transcript types included in request')
need(pullUi, 'openIrsPopup(', 'Request Transcripts opens the IRS TDS popup')
need(pullUi, 'types: []', 'no transcript types pre-selected')
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
forbid(pullUi, 'Save Transcript Request', 'legacy manual save CTA must not be primary')
forbid(pullUi, 'Watched TDS Download Folder', 'legacy download folder reference must be gone')
forbid(pullUi, 'providers.map(p =>', 'legacy provider map must be gone')
forbid(callback, "const CRM_ORIGIN = 'https://taxrescrm.app'", 'TCR CRM origin hardcoded in callback')

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

console.log('\n✅ IRS transcript architecture check passed.')
console.log('  Primary flow: rep signs in to the real IRS site in a popup with their own login, requests')
console.log('  transcripts there, and the free TaxRes IRS Helper returns the PDFs to the CRM for matching,')
console.log('  filing and Transcript Analysis. The server-side OAuth code paths above remain dormant.')
