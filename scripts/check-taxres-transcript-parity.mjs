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
const sessionSql='supabase/migrations/20260917_tds_isp_session.sql'
const identitySql='supabase/migrations/20260918_transcript_pull_client_identity.sql'

for(const n of [
  'IRS_TDS_CLIENT_ID','IRS_TDS_JWT_KID','IRS_TDS_JWT_PRIVATE_KEY_PEM','IRS_TDS_REDIRECT_URI',
  "u.searchParams.set('redirect_uri', env('IRS_TDS_REDIRECT_URI'))",
  'IRS_TDS_SCOPE','IRS_TDS_AUTHORIZE_EXTRA_PARAMS_JSON',"client_id: env('IRS_TDS_CLIENT_ID')",
  'requireActiveSession','sessionWindowActive',
  'POA/TIA with status On File','Client SSN/EIN','Practitioner CAF number',"select('tenant_id,perm_irs,email,caf,caf_number')",
  'IRS_TDS_RESULTS_PATH','IRS_TDS_RESULT_PDF_BASE64_PATH','IRS_TDS_RESULT_DOWNLOAD_URL_PATH',
  'persistTranscriptPdf','provider_result_keys','provider_file_paths','createSignedUrl','IRS_TDS_TERMINAL_STATUSES','IRS_TDS_TERMINAL_ERROR_STATUSES'
]) need(pull,n)

for(const n of [
  "redirect_uri: env('IRS_TDS_REDIRECT_URI')",
  "grant_type: 'authorization_code'","client_id: env('IRS_TDS_CLIENT_ID')",'client_assertion','state_expires_at',
  '60 * 60 * 1000','IRS_TDS_CRM_ORIGIN','Content-Security-Policy'
]) need(callback,n)

for(const n of [
  'IRS TDS — ISP','one-hour ISP session','clientId: req.client_id || null',
  'client_id: clientId','provider_filed_keys','requestCoverageSatisfied','parseIrsTranscript',"provider_status: covered ? 'Filed' : 'Partial'","['Filed','Partial','Error'].includes(req.provider_status)"
]) need(lib,n)

for(const n of [
  'new URL(data.redirectUri).origin',
  'Sign in through IRS e-Services with ID.me and 2FA',
  'sessionActive'
]) need(session,n)

for(const n of [
  'Account Transcript','Record of Account','Return Transcript','Wage and Income',
  'Verification of Non-Filing','transactions','accrued_penalty','accrued_interest',
  'csed_estimate'
]) need(parser,n)

for(const n of [
  'Transcript Analysis','Pull Transcripts','POA / CAF Tracker',
  'Transaction History','Wage & Income Documents','Est. CSED',
  "client_id: clientRow.id",
  "storeTranscriptAnalysis(file, uploadClientRow.name, a, { clientId: uploadClientRow.id })",
  "<TranscriptPull clientNames={clientNames} clients={clients}"
]) need(portal,n)

for(const n of [
  'When IRS TDS ISP is connected',
  "storeTranscriptAnalysis(file, req.client_name, a, { clientId: req.client_id || null })",
  'Request Transcripts',
  'const formClient = uniqueClientForName(form.clientName)',
  'client_id: client.id'
]) need(pullUi,n)

for(const n of [
  'unique (tenant_id, user_id)',
  'revoke all on table public.irs_tds_sessions from anon, authenticated',
  'session_expires_at'
]) need(sessionSql,n)
need(identitySql,'client_id text')

if(fs.existsSync(pull)){
  const s=read(pull)
  if(/irs[_ -]?(password|2fa|two.?factor)[_ -]?(secret|code)?/i.test(s)){
    failures.push('transcript-pull: IRS password/2FA handling is forbidden')
  }
}
if(fs.existsSync(session)){
  const s=read(session)
  if(s.includes("const callbackOrigin = 'https://ydrvncdedgjtcprczwpu.supabase.co'")){
    failures.push('TDSSessionPresence: callback origin is Nashville-hardcoded')
  }
}
if(fs.existsSync(callback)){
  const s=read(callback)
  if(s.includes("const CRM_ORIGIN = 'https://nashville.taxrescrm.app'")){
    failures.push('transcript-pull-callback: CRM origin is Nashville-hardcoded')
  }
}

if(failures.length){
  console.error('TaxRes transcript parity check failed:')
  failures.forEach(x=>console.error(' - '+x))
  process.exit(1)
}
console.log('✅ TaxRes transcript ISP/parity contract passed')
