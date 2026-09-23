import fs from 'node:fs'

const failures=[]
const read=p=>fs.readFileSync(p,'utf8')
const need=(file,needle,label=needle)=>{
  if(!fs.existsSync(file)){failures.push(file+': missing');return}
  const s=read(file)
  if(!s.includes(needle)) failures.push(file+': missing '+label)
}

const pull='supabase/functions/transcript-pull/index.ts'
const callback='supabase/functions/transcript-pull-callback/index.ts'
const lib='src/lib/transcriptPull.js'
const session='src/components/TDSSessionPresence.jsx'
const parser='src/lib/irsTranscriptParser.js'
const portal='src/pages/IRSPortal.jsx'
const pullUi='src/components/TranscriptPull.jsx'
const completionSql='supabase/migrations/20260920025000_taxres_family_transcript_isp_completion.sql'
const config='supabase/config.toml'

for(const n of [
  "id: 'irs_a2a'",
  "label: 'IRS TDS — Automated API'",
  'apiFlowVerified',
  'clientId: req.client_id || null',
  'client_id: clientId',
  'provider_filed_keys',
  'requestCoverageSatisfied',
  'parseIrsTranscript',
  "provider_status: covered ? 'Filed' : 'Partial'",
  "['Filed','Partial','Error'].includes(req.provider_status)"
]) need(lib,n)

// TDSSessionPresence must wire the real begin-session OAuth flow, not open the public TDS website.
for(const n of [
  "'begin-session'",
  "'begin-test-session'",
  'taxres-irs-tds-oauth',
  'addEventListener',
  'interactiveAvailable: true',
  'directAvailable',
  'apiFlowVerified',
  'apiSessionActive',
  'authorizationUrl',
  'Sign in to IRS',
]) need(session,n)

for(const n of [
  'Account Transcript','Record of Account','Return Transcript','Wage and Income',
  'Verification of Non-Filing','transactions','accrued_penalty','accrued_interest','csed_estimate'
]) need(parser,n)

for(const n of [
  'Transcript Analysis','Pull Transcripts','POA / CAF Tracker',
  'Account Overview','CSED Calculations','Penalties and Interest','Payment History','Bankruptcy','Account Transactions','Assessment Overview',
  'Wage & Income Documents','Est. CSED',
  "client_id: clientRow.id",
  "storeTranscriptAnalysis(file, uploadClientRow.name, a, { clientId: uploadClientRow.id })",
  "<TranscriptPull clientNames={clientNames} clients={clients}"
]) need(portal,n)

for(const n of [
  'IRS Transcript Delivery',
  'Use the IRS-hosted TDS sign-in for practitioner access.',
  'Request Transcripts',
  'Returned PDFs attach to the selected client file automatically.',
  'Manual PDF fallback',
  'onStatusChange={(st) =>',
  'directAvailable',
  'const formClient = resolveClient(form)',
  'const client = resolveClient(nextForm)',
  'client_id: client.id',
  "provider: 'irs_a2a'",
  'submitCanopyStyleRequest'
]) need(pullUi,n)

if(fs.existsSync(pullUi)){
  const ui=read(pullUi)
  if(ui.includes('selectedYears.includes(') || ui.includes('selectedYears.length') || ui.includes('selectedYears.every(') || ui.includes('poaYears.length') || ui.includes('poaYears.includes(')) {
    failures.push('TranscriptPull: parseYearSpec returns Set; array-only year methods would crash IRS Portal')
  }
  if(!ui.includes('selectedYears.has(year)') || !ui.includes('selectedYears.size') || !ui.includes('poaYears.size') || !ui.includes('poaYears.has(y)')) {
    failures.push('TranscriptPull: Set-safe tax-year handling contract is incomplete')
  }
  for(const old of ['Watched TDS Download Folder','providers.map(p =>','New Transcript Pull Request']){
    if(ui.includes(old)) failures.push('TranscriptPull: legacy primary UI still present: '+old)
  }
}

for(const n of [
  'create table if not exists public.transcript_pull_requests',
  'add column if not exists client_id text',
  'add column if not exists provider_result_keys',
  'add column if not exists provider_filed_keys',
  'create table if not exists public.irs_tds_sessions',
  'access_token_ciphertext text',
  'refresh_token_ciphertext text',
  'organization_name text',
  'revoke all on table public.irs_tds_sessions from anon, authenticated',
  'tenant_id = current_tenant_id()',
  'transcript_analyses_tenant_client_idx'
]) need(completionSql,n)

need(config,'[functions.transcript-pull]')
need(config,'[functions.transcript-pull-callback]')
need(config,'verify_jwt = true')
need(config,'verify_jwt = false')


if(fs.existsSync(pull)){
  const s=read(pull)
  if(/irs[_ -]?(password|2fa|two.?factor)[_ -]?(secret|code)?/i.test(s)){
    failures.push('transcript-pull: IRS password/2FA handling is forbidden')
  }
  // begin-session must generate a real OAuth authorization URL, not open the public TDS page
  if(!s.includes("action === 'begin-session'")) failures.push('transcript-pull: begin-session action is missing')
  if(!s.includes('IRS_TDS_ISP_AUTHORIZE_URL') && !s.includes('AUTHORIZE_URL')) failures.push('transcript-pull: begin-session must build OAuth authorization URL')
  if(!s.includes('authorizationUrl')) failures.push('transcript-pull: begin-session must return authorizationUrl')
  // Stub mode must exist for sandbox E2E testing
  if(!s.includes("IRS_TDS_STUB_MODE")) failures.push('transcript-pull: IRS_TDS_STUB_MODE sandbox stub mode is missing')
  if(!s.includes("stubMode()")) failures.push('transcript-pull: stubMode() helper is missing')
  // Tenant isolation: session must be scoped to tenant_id + user_id
  if(!s.includes('tenant_id,user_id')) failures.push('transcript-pull: irs_tds_sessions upsert missing tenant_id,user_id conflict key')
}

if(fs.existsSync(callback)){
  const s=read(callback)
  // Callback must validate and atomically claim state
  if(!s.includes('.eq(\'state\', state)')) failures.push('transcript-pull-callback: state validation missing')
  if(!s.includes('claimed')) failures.push('transcript-pull-callback: atomic state claim missing (race condition risk)')
  // Callback must send postMessage back to CRM origin
  if(!s.includes('taxres-irs-tds-oauth')) failures.push('transcript-pull-callback: postMessage type taxres-irs-tds-oauth is missing')
  if(!s.includes('window.opener.postMessage')) failures.push('transcript-pull-callback: postMessage to opener missing')
  // Stub mode must exist in callback too
  if(!s.includes('IRS_TDS_STUB_MODE')) failures.push('transcript-pull-callback: IRS_TDS_STUB_MODE stub mode is missing')
  if(!s.includes('stub-access-') && !s.includes('isStub')) failures.push('transcript-pull-callback: stub token path missing')
  // Nashville origin must not be hardcoded
  if(s.includes("const CRM_ORIGIN = 'https://nashville.taxrescrm.app'")) failures.push('transcript-pull-callback: Nashville CRM origin is hardcoded')
  // AES-GCM encryption of tokens at rest
  if(!s.includes('AES-GCM')) failures.push('transcript-pull-callback: tokens must be encrypted at rest with AES-GCM')
  if(!s.includes('encryptText')) failures.push('transcript-pull-callback: encryptText must be used for access and refresh tokens')
}
if(fs.existsSync(lib)){
  const s=read(lib)
  // irs_interactive is the always-available practitioner Web TDS path; it must be present and correct
  if(!s.includes("id: 'irs_interactive'")) failures.push('transcriptPull: irs_interactive practitioner provider must be defined')
  if(!s.includes("available: true") || !s.includes("id: 'irs_interactive'")) failures.push('transcriptPull: irs_interactive must always be available')
  // Prohibit old broken patterns that coupled practitioner login to the automated API
  for(const old of ["label: 'IRS TDS — Practitioner Login'","chip: 'Open IRS TDS'"]){
    if(s.includes(old)) failures.push('transcriptPull: legacy Web TDS label must not return: '+old)
  }
  // submitToProvider must handle irs_interactive without calling the IRS API
  if(!s.includes("providerId === 'manual' || providerId === 'irs_interactive'")) failures.push('transcriptPull: irs_interactive must short-circuit in submitToProvider without calling the API')
}
if(fs.existsSync(session)){
  const s=read(session)
  // TDSSessionPresence must NOT open the public IRS TDS practitioner website as the primary sign-in path.
  // It must call begin-session and open the returned OAuth authorization URL.
  if(s.includes("'https://la.www4.irs.gov/esrv/tds/'")) failures.push('TDSSessionPresence: must not open public IRS TDS website as primary flow — use begin-session OAuth')
  if(s.includes("window.open(IRS_TDS_URL")) failures.push('TDSSessionPresence: must not directly open the practitioner TDS website — use begin-session OAuth URL')
  // Must have a postMessage listener wired to receive the taxres-irs-tds-oauth callback
  if(!s.includes("window.addEventListener('message'") && !s.includes('window.addEventListener("message"')) failures.push('TDSSessionPresence: missing postMessage listener for taxres-irs-tds-oauth callback')
  // Nashville tenant must not be hardcoded
  if(s.includes('ydrvncdedgjtcprczwpu')) failures.push('TDSSessionPresence: Nashville Supabase project is hardcoded')
}
if(fs.existsSync(pullUi)){
  const s=read(pullUi)
  // irs_interactive is the UI intent for practitioner Web TDS requests (BLANK default + openNewRequest);
  // createRequest() must translate it to 'manual' before DB insert so the DB column stays clean.
  // submitCanopyStyleRequest always stores 'irs_a2a' — that path is unchanged.
  if(s.includes('Save Transcript Request')) failures.push('TranscriptPull: legacy manual request CTA must not be primary')
  if(!s.includes('data-testid="transcript-client-search"')) failures.push('TranscriptPull: ID-based client combobox input missing')
  if(!s.includes('data-testid="transcript-client-dropdown"')) failures.push('TranscriptPull: ID-based client dropdown missing')
  if(s.includes('list="irsportal-clients"')) failures.push('TranscriptPull: broken irsportal-clients datalist reference returned')
  // Ensure createRequest() does not write 'irs_interactive' to the DB — must use 'manual' for DB storage
  if(s.includes("provider: 'irs_interactive'") && !s.includes("dbProvider = form.provider === 'irs_interactive' ? 'manual' : form.provider")) {
    failures.push("TranscriptPull: createRequest() must translate irs_interactive to 'manual' before DB insert (use dbProvider)")
  }
}

if(failures.length){
  console.error('TaxRes-family transcript parity check failed:')
  failures.forEach(x=>console.error(' - '+x))
  process.exit(1)
}
console.log('✅ TaxRes-family transcript ISP/parity contract passed')
