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
  'IRS_TDS_CLIENT_ID','IRS_TDS_JWT_KID','IRS_TDS_JWT_PRIVATE_KEY_PEM','IRS_TDS_REDIRECT_URI',
  "u.searchParams.set('redirect_uri', env('IRS_TDS_REDIRECT_URI'))",
  'IRS_TDS_SCOPE','IRS_TDS_AUTHORIZE_EXTRA_PARAMS_JSON',"client_id: env('IRS_TDS_CLIENT_ID')",
  'requireActiveSession','sessionWindowActive',
  'POA/TIA with status On File','Client SSN/EIN','Practitioner or office CAF number',"select('tenant_id,perm_irs,email,caf,caf_number')","rpc('current_tenant_id')",".eq('tenant_id', tenantId)",".from('settings')",".select('caf_number')",
  'IRS_TDS_RESULTS_PATH','IRS_TDS_RESULT_PDF_BASE64_PATH','IRS_TDS_RESULT_DOWNLOAD_URL_PATH',
  'persistTranscriptPdf','provider_result_keys','provider_file_paths','createSignedUrl',
  'IRS_TDS_TERMINAL_STATUSES','IRS_TDS_TERMINAL_ERROR_STATUSES'
]) need(pull,n)

for(const n of [
  "redirect_uri: env('IRS_TDS_REDIRECT_URI')",
  "grant_type: 'authorization_code'","client_id: env('IRS_TDS_CLIENT_ID')",'client_assertion','state_expires_at',
  '60 * 60 * 1000','IRS_TDS_CRM_ORIGIN',"https://taxrescrm.app",'Content-Security-Policy'
]) need(callback,n)

for(const n of [
  'IRS TDS — ISP','one-hour ISP session','clientId: req.client_id || null',
  'client_id: clientId','provider_filed_keys','requestCoverageSatisfied','parseIrsTranscript',
  "provider_status: covered ? 'Filed' : 'Partial'","['Filed','Partial','Error'].includes(req.provider_status)"
]) need(lib,n)

for(const n of [
  'new URL(data.redirectUri).origin',
  'Authenticate with IRS e-Services / ID.me to open the one-hour transcript session.',
  'sessionActive'
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
  'Sign in once, choose the client, years and transcript types, then request.',
  'Request Transcripts',
  'Returned PDFs attach to the selected client file automatically.',
  'Manual PDF fallback',
  'onStatusChange={(st) =>',
  'directAvailable',
  'const formClient = uniqueClientForName(form.clientName)',
  'client_id: client.id',
  "provider: 'irs_a2a'"
]) need(pullUi,n)

if(fs.existsSync(pullUi)){
  const ui=read(pullUi)
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
}
if(fs.existsSync(session)){
  const s=read(session)
  if(s.includes('ydrvncdedgjtcprczwpu')) failures.push('TDSSessionPresence: Nashville Supabase project is hardcoded')
}
if(fs.existsSync(callback)){
  const s=read(callback)
  if(s.includes("const CRM_ORIGIN = 'https://nashville.taxrescrm.app'")) failures.push('transcript-pull-callback: Nashville CRM origin is hardcoded')
}

if(failures.length){
  console.error('TaxRes-family transcript parity check failed:')
  failures.forEach(x=>console.error(' - '+x))
  process.exit(1)
}
console.log('✅ TaxRes-family transcript ISP/parity contract passed')
