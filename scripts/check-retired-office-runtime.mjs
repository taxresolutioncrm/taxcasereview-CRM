import fs from 'node:fs'
import assert from 'node:assert/strict'
const read=path=>fs.readFileSync(path,'utf8')
const retired='CloudCPA'
const id='ecd3d3ce-016a-4bb4-800e-f090f51e4cae'
const activeFiles=[
  'src/pages/Email.jsx',
  'src/pages/AdminPortal.jsx',
  'src/pages/Clients.jsx',
  'supabase/functions/send-email/index.ts',
  'supabase/functions/send-fax/index.ts',
  'supabase/functions/send-sms/index.ts',
  'supabase/functions/start-outbound-call/index.ts',
  'supabase/functions/platform-metrics/index.ts',
  'supabase/functions/metrics-signal/index.ts',
  'supabase/functions/invite-employee/index.ts',
  'supabase/functions/daily-briefing/index.ts',
  'src/context/AppContext.jsx',
  'src/lib/firmBranding.js',
  'src/pages/TaxOfficeEsign.jsx'
]
for(const path of activeFiles){
  const s=read(path)
  for(const token of [retired,'cloudcpa','TRC-003',id,'thecloudcpa.net']){
    assert(!s.toLowerCase().includes(token.toLowerCase()),path+' contains retired office reference '+token)
  }
}
const sendEmail=read('supabase/functions/send-email/index.ts')
const sendSms=read('supabase/functions/send-sms/index.ts')
const sendFax=read('supabase/functions/send-fax/index.ts')
assert(sendEmail.includes("tenant_code || '') === 'TRC-004'"),'Centurion relay must remain explicit')
assert(sendEmail.includes("const relayFrom = 'info@taxrescrm.net'"),'Centurion sender identity remains TaxRes')
assert(sendSms.includes("['TRC-004','ADMIN']"),'Centurion and admin SMS relay must remain intact')
assert(sendFax.includes("tenant_code || '') === 'ADMIN'"),'Admin fax relay must remain available')
assert(read('src/pages/AdminPortal.jsx').includes("t.status !== 'deleted'"),'Retired offices must remain filtered')
for(const path of ['scripts/certify-cloudcpa-readiness.mjs','scripts/check-cloudcpa-contact-branding.cjs','scripts/check-cloudcpa-document-branding.cjs','.github/workflows/cloudcpa-branding-cert.yml']){
  assert(!fs.existsSync(path),'Retired readiness artifact still exists: '+path)
}
const packageJSON=JSON.parse(read('package.json'))
assert(!Object.keys(packageJSON.scripts).some(x=>x.toLowerCase().includes('cloudcpa')),'Retired scripts must not be runnable')
console.log('PASS: retired office not in active runtime; preserved Centurion and Admin relays')
