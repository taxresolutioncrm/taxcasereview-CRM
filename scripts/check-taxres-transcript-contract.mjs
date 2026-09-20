import fs from 'node:fs'

const failures=[]
const read=p=>fs.readFileSync(p,'utf8')
const must=(ok,msg)=>{if(!ok)failures.push(msg)}

for(const file of [
  'supabase/functions/transcript-pull/index.ts',
  'supabase/functions/transcript-pull-callback/index.ts',
  'src/lib/transcriptPull.js',
  'src/components/TranscriptPull.jsx',
  'src/components/TDSSessionPresence.jsx',
  'src/components/TranscriptReports.jsx',
  'src/lib/irsTranscriptParser.js',
  'src/pages/IRSPortal.jsx',
  'supabase/config.toml',
  'supabase/migrations/20260920030000_taxres_transcript_family_hardening.sql',
]){
  must(fs.existsSync(file), file+': missing')
}

if(fs.existsSync('supabase/functions/transcript-pull/index.ts')){
  const s=read('supabase/functions/transcript-pull/index.ts')
  for(const needle of [
    "rpc('current_tenant_id')",
    ".eq('tenant_id', tenantId)",
    "perm_irs",
    "IRS_TDS_CLIENT_ID",
    "IRS_TDS_JWT_KID",
    "IRS_TDS_JWT_PRIVATE_KEY_PEM",
    "IRS_TDS_REDIRECT_URI",
    "u.searchParams.set('redirect_uri'",
    "requireActiveSession",
    "session_expires_at",
    "poa.status !== 'On File'",
    "poa.client_id",
    "stableClientId",
    "IRS_TDS_REQUEST_URL",
    "IRS_TDS_STATUS_URL_TEMPLATE",
    "provider_result_keys",
    "storage.from('documents')",
    "upsert: false",
    "return_origin: returnOrigin",
    "IRS_TDS_ALLOWED_ORIGINS",
  ]) must(s.includes(needle), 'transcript-pull missing '+needle)
  must(!/canopytax\.com/i.test(s),'transcript-pull must not depend on Canopy private APIs')
  must(!/irs[_ -]?(password|2fa|two.?factor)[_ -]?(secret|code)?/i.test(s),'transcript-pull must never handle IRS password/2FA secrets')
}

if(fs.existsSync('supabase/functions/transcript-pull-callback/index.ts')){
  const s=read('supabase/functions/transcript-pull-callback/index.ts')
  for(const needle of [
    "grant_type: 'authorization_code'",
    "redirect_uri: env('IRS_TDS_REDIRECT_URI')",
    "client_assertion",
    ".eq('state', state)",
    ".update({ state: null",
    "Content-Security-Policy",
    "window.opener&&window.opener.postMessage",
    "IRS_TDS_CRM_ORIGIN",
    "https://taxrescrm.app",
    "type: 'taxres-irs-tds-oauth'",
    "session.return_origin",
    "IRS_TDS_ALLOWED_ORIGINS",
  ]) must(s.includes(needle), 'transcript callback missing '+needle)
}

if(fs.existsSync('src/lib/transcriptPull.js')){
  const s=read('src/lib/transcriptPull.js')
  for(const needle of [
    "action: 'capabilities'",
    "action: 'submit'",
    "action: 'status'",
    "startDirectPolling",
    "requestCoverageSatisfied",
    "provider_filed_keys",
    "provider_result_keys",
    "parseTranscriptFile",
    "storeTranscriptAnalysis",
  ]) must(s.includes(needle),'transcriptPull.js missing '+needle)
}

if(fs.existsSync('src/components/TranscriptPull.jsx')){
  const s=read('src/components/TranscriptPull.jsx')
  must(s.includes('<TDSSessionPresence onSessionChange={refreshProviders} />'),'TranscriptPull must refresh provider capability after IRS sign-in')
  must(s.includes('client_id: form.clientId || poa.client_id || null'),'TranscriptPull must persist stable client identity')
  must(s.includes("clients = []"),'TranscriptPull must receive stable client records')
  must(s.includes("assignClientId"),'TranscriptPull manual assignment must preserve stable client identity')
  must(s.includes('Retry Direct'),'TranscriptPull must support provider retry')
}

if(fs.existsSync('src/components/TDSSessionPresence.jsx')){
  const s=read('src/components/TDSSessionPresence.jsx')
  for(const needle of [
    "action: 'begin-session'",
    "action: 'end-session'",
    "https://mpxgxfqdbquzkrvvejkh.supabase.co",
    "onSessionChange",
  ]) must(s.includes(needle),'TDSSessionPresence missing '+needle)
}

if(fs.existsSync('supabase/config.toml')){
  const s=read('supabase/config.toml')
  const pull=s.slice(s.indexOf('[functions.transcript-pull]'),s.indexOf('[functions.transcript-pull-callback]'))
  const cb=s.slice(s.indexOf('[functions.transcript-pull-callback]'))
  must(/verify_jwt\s*=\s*true/.test(pull),'transcript-pull must require JWT')
  must(/verify_jwt\s*=\s*false/.test(cb),'transcript callback must allow IRS redirect')
}

if(fs.existsSync('supabase/migrations/20260920030000_taxres_transcript_family_hardening.sql')){
  const m=read('supabase/migrations/20260920030000_taxres_transcript_family_hardening.sql')
  for(const needle of [
    'add column if not exists client_id text',
    "current_employee_permission('perm_irs')>=1",
    "current_employee_permission('perm_irs')>=2",
    "current_employee_permission('perm_irs')>=3",
    'revoke all on table public.irs_tds_sessions from anon, authenticated',
    'add column if not exists return_origin text',
    'provider_result_keys text[]',
    'provider_filed_keys text[]',
  ]) must(m.includes(needle),'transcript migration missing '+needle)
}

if(fs.existsSync('src/components/TranscriptReports.jsx')){
  const r=read('src/components/TranscriptReports.jsx')
  for(const label of ['Account Overview','CSED Calculations','Penalties and Interest','Payment History','Bankruptcy','Account Transactions','Assessment Overview','Documents']){
    must(r.includes(label),'TranscriptReports missing '+label)
  }
  must(r.includes('a.principal_tax'),'TranscriptReports must use parsed principal tax rather than balance as principal tax')
}
if(fs.existsSync('src/lib/irsTranscriptParser.js')){
  const p=read('src/lib/irsTranscriptParser.js')
  for(const needle of ['principal_tax: principalTax','payments_credits: paymentCreditTotal','refunds: refundTotal']){
    must(p.includes(needle),'IRS parser missing '+needle)
  }
}
if(fs.existsSync('src/pages/IRSPortal.jsx')){
  const p=read('src/pages/IRSPortal.jsx')
  must(p.includes("import TranscriptReports from '../components/TranscriptReports'"),'IRS Portal must import transcript reports')
  must(p.includes('<TranscriptReports rows={rows} money={money} openTranscriptFile={openTranscriptFile} />'),'IRS Portal must render transcript reports')
  must(p.includes("select('id,name')"),'IRS Portal must load stable client IDs')
  must(p.includes("client_id: poaForm.clientId || null"),'POA records must persist stable client identity')
  must(p.includes("clients={clients}"),'IRS Portal must pass stable client records into transcript pulls')
  must(!p.includes('restricted TDS pull'),'IRS Portal contains obsolete restricted-TDS copy')
}

if(failures.length){
  console.error('TaxRes transcript sandbox contract failed:')
  failures.forEach(x=>console.error(' - '+x))
  process.exit(1)
}
console.log('✅ TaxRes transcript sandbox contract passed')
