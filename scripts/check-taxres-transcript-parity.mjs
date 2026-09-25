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
const documentsStorageSql='supabase/migrations/20260924134500_add_documents_storage_path_for_tds.sql'
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

// The old IRS API sign-in panel (Client ID / RSA key / "API credentials required") must stay gone.
// Sign-in is the rep's own IRS / ID.me login in a controlled popup on irs.gov.
if(fs.existsSync(session)) failures.push(session+': old IRS API sign-in panel must not return (browser popup sign-in replaces it)')
for(const f of [pullUi, portal]) {
  if(!fs.existsSync(f)) continue
  const s=read(f)
  for(const bad of ['API credentials','Client ID','RSA key','RSA private','<TDSSessionPresence','begin-test-session','Run CRM Live Test','IRS_TDS_STUB_MODE']) {
    if(s.includes(bad)) failures.push(f+': must not show IRS API credential / test-session UI: '+bad)
  }
}

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
  "<TranscriptPull clientNames={clientNames} clients={clients}",
  "openIrsPopup(IRS_TDS_URL)",
  'IRS_POPUP_BLOCKED'
]) need(portal,n)

for(const n of [
  'IRS Transcript Delivery',
  'Use the IRS-hosted TDS sign-in for practitioner access.',
  'Request Transcripts',
  'Returned PDFs attach to the selected client file automatically.',
  'Manual PDF fallback',
  'const formClient = resolveClient(form)',
  'const client = resolveClient(nextForm)',
  'client_id: client.id',
  'submitCanopyStyleRequest',
  // Browser-assisted IRS TDS: pending request first, normal IRS page, returned PDFs filed to that request
  'provider: BROWSER_PROVIDER_ID',
  "IRS_POPUP_BLOCKED + ' No transcript request was saved.'",
  'openIrsPopup(',
  'Sign in to IRS',
  'Secure Mailbox',
  'types: []',
  // TaxRes IRS Helper bridge: same-page messages only, PDFs only
  "event.source !== window || event.origin !== window.location.origin",
  'data.source !== HELPER_SOURCE',
  "'%PDF-'",
  "'/taxres-irs-helper.zip'",
  'data-testid="irs-helper-status"',
  'data-testid="transcript-needs-client"',
  'addReturnedFiles',
  'fileBrowserTranscripts',
  'matchBrowserRequest',
]) need(pullUi,n)

for(const n of [
  "export const IRS_TDS_URL = 'https://la.www4.irs.gov/esrv/tds/'",
  "export const IRS_POPUP_NAME = 'taxres-irs-tds'",
  'w.opener = null',
  '<meta name="referrer" content="no-referrer">',
  'freshPopups',
  'browserMatchProblem',
  'file_sha256',
  'browserFilingQueue',
  'requestCoverageSatisfied(req, rows || [])',
  'export async function startBrowserTdsRequest',
  'no readable taxpayer SSN/EIN on this PDF',
  'client has no SSN/EIN on file to match against',
]) need(lib,n)

if(fs.existsSync(pullUi) && fs.existsSync(lib)){
  const ui=read(pullUi), l=read(lib)
  // The IRS tab may only be sent to IRS after the pending request is saved
  const submit=ui.slice(ui.indexOf('async function submitCanopyStyleRequest'), ui.indexOf('// Derive the single most-actionable reason'))
  if(submit.includes('openIrsTds(') || !submit.includes('openPendingIrsTab()') || !submit.includes('startBrowserTdsRequest(row, irsTab, withHelperPairing(IRS_TDS_URL, pairing))')) failures.push('TranscriptPull: Request Transcripts must save the pending request before navigating to IRS TDS')
  if(ui.includes('routeAnalysis(')) failures.push('TranscriptPull: watched folder must not auto-file by name without a positive TIN match')
  if(ui.includes('<TDSSessionPresence')) failures.push('TranscriptPull: IRS API OAuth sign-in must not gate the browser TDS workflow')
  if(/canRequest = Boolean\([^)]*(sessionActive|direct\?\.available)/.test(ui)) failures.push('TranscriptPull: Request Transcripts must not require an IRS API session')
  // The CRM must never read or relay IRS/ID.me browser credentials
  for(const bad of ['document.cookie','localStorage','sessionStorage','access_token','Authorization:']) {
    if(ui.includes(bad)) failures.push('TranscriptPull: must not touch browser credentials: '+bad)
    if(l.slice(l.indexOf('// ── Browser-assisted IRS TDS')).includes(bad)) failures.push('transcriptPull browser section: must not touch browser credentials: '+bad)
  }
}

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

need(documentsStorageSql,'add column if not exists storage_path text','documents.storage_path required for TDS PDF filing')

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
  // No synthetic IRS session/transcript path may ship in the production function
  for(const bad of ['IRS_TDS_STUB_MODE','begin-test-session','stub-txn-','stub-code-','SYNTHETIC TRANSCRIPT']) if(s.includes(bad)) failures.push('transcript-pull: synthetic path present: '+bad)
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
  // Callback must always perform the real token exchange — no synthetic session path
  for(const bad of ['IRS_TDS_STUB_MODE','stub-access-','isStub',"startsWith('test-')"]) if(s.includes(bad)) failures.push('transcript-pull-callback: synthetic path present: '+bad)
  // TCR origin must not be hardcoded
  if(s.includes("const CRM_ORIGIN = 'https://taxrescrm.app'")) failures.push('transcript-pull-callback: TCR CRM origin is hardcoded')
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
  for(const bad of ['begin-test-session','Run CRM Live Test','testSessionActive']) if(s.includes(bad)) failures.push('TDSSessionPresence: synthetic live-test path present: '+bad)
  // Must have a postMessage listener wired to receive the taxres-irs-tds-oauth callback
  if(!s.includes("window.addEventListener('message'") && !s.includes('window.addEventListener("message"')) failures.push('TDSSessionPresence: missing postMessage listener for taxres-irs-tds-oauth callback')
  // TCR tenant must not be hardcoded
  if(s.includes('mpxgxfqdbquzkrvvejkh')) failures.push('TDSSessionPresence: TCR Supabase project is hardcoded')
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


// TaxRes IRS Helper (free Chrome extension): may only move transcript PDFs, never IRS / ID.me sign-in data.
const extDir='extensions/taxres-irs-helper'
const extManifest=extDir+'/manifest.json'
if(!fs.existsSync(extManifest)) failures.push(extManifest+': missing')
else {
  const m=JSON.parse(read(extManifest))
  const allowedPerms=new Set(['downloads','storage'])
  for(const perm of [...(m.permissions||[]), ...(m.optional_permissions||[])]) if(!allowedPerms.has(perm)) failures.push('TaxRes IRS Helper: permission not allowed: '+perm)
  for(const h of [...(m.host_permissions||[]), ...(m.optional_host_permissions||[])]) if(h!=='https://*.irs.gov/*') failures.push('TaxRes IRS Helper: host permission not allowed: '+h)
  // IRS pages: any irs.gov page EXCEPT the sign-in host and sign-in/auth addresses (the real mailbox layout/paths are not assumed).
  const signInExcluded=cs=>(cs.exclude_matches||[]).includes('https://sa.www4.irs.gov/*') && ['*login*','*signin*','*/auth/*','*oauth*','*saml*','*logout*'].every(g=>(cs.exclude_globs||[]).includes(g))
  const okMatch=(u,cs)=>/^https:\/\/\*\.irs\.gov\/(semail|esrv)\/\*$/.test(u) || (u==='https://*.irs.gov/*' && signInExcluded(cs)) || u==='https://taxrescrm.app/*' || u==='https://*.taxrescrm.app/*'
  for(const cs of m.content_scripts||[]) for(const u of cs.matches||[]) if(!okMatch(u,cs)) failures.push('TaxRes IRS Helper: content script may not run on '+u+(u==='https://*.irs.gov/*'?' without excluding the IRS sign-in pages':''))
  if(m.externally_connectable) failures.push('TaxRes IRS Helper: externally_connectable is not allowed')
  if(m.web_accessible_resources) failures.push('TaxRes IRS Helper: web_accessible_resources is not allowed')
  for(const f of ['background.js','mailbox.js','crm-bridge.js']) {
    const p=extDir+'/'+f
    if(!fs.existsSync(p)) { failures.push(p+': missing'); continue }
    // The only allowed mentions of "password" are the ones that make the helper stay AWAY from sign-in forms.
    const code=read(p).replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'').replace(/\s\/\/ .*$/gm,'')
      .split('input[type="password" i]').join('').split("'file', 'password']").join("'file']").split('|password|').join('|')
    for(const bad of [/document\.cookie/,/chrome\.cookies/,/\bcookies\s*:/i,/localStorage/,/sessionStorage/,/Authorization/i,/[Bb]earer/,/webRequest/,/chrome\.debugger/,/password/i,/id\.me/i,/access_token|refresh_token/i,/eval\(|new Function\(/,/chrome\.tabs\.executeScript|chrome\.scripting/]) {
      if(bad.test(code)) failures.push(p+': forbidden in helper code: '+bad)
    }
  }
  const bridge=fs.existsSync(extDir+'/crm-bridge.js')?read(extDir+'/crm-bridge.js'):''
  if(!bridge.includes('event.source !== window || event.origin !== window.location.origin')) failures.push('TaxRes IRS Helper: CRM bridge must only accept messages from its own page')
  const mailbox=fs.existsSync(extDir+'/mailbox.js')?read(extDir+'/mailbox.js'):''
  if(!mailbox.includes("sendBtn.addEventListener('click', () => sendAll(false))")) failures.push('TaxRes IRS Helper: mailbox sending must start only from the rep clicking')
  if(!mailbox.includes("credentials: 'same-origin'") || !mailbox.includes("u.protocol === 'https:' && u.origin === location.origin ? u : null")) failures.push('TaxRes IRS Helper: files may only be opened from the same IRS page origin')
}
const zipPath='public/taxres-irs-helper.zip'
if(!fs.existsSync(zipPath)) failures.push(zipPath+': missing (zip extensions/taxres-irs-helper so reps can download it)')
else {
  const z=fs.readFileSync(zipPath).toString('latin1')
  for(const f of ['manifest.json','background.js','mailbox.js','crm-bridge.js']) if(!z.includes('taxres-irs-helper/'+f)) failures.push(zipPath+': missing '+f)
}

if(failures.length){
  console.error('TaxRes-family transcript parity check failed:')
  failures.forEach(x=>console.error(' - '+x))
  process.exit(1)
}
console.log('✅ TaxRes-family transcript ISP/parity contract passed')
