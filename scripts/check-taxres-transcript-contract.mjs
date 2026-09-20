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
  'supabase/config.toml',
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
  must(s.includes('client_id: poa.client_id || null'),'TranscriptPull must persist stable client identity')
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

if(failures.length){
  console.error('TaxRes transcript sandbox contract failed:')
  failures.forEach(x=>console.error(' - '+x))
  process.exit(1)
}
console.log('✅ TaxRes transcript sandbox contract passed')
