const fs = require('fs')

const files = [
  'src/pages/FormaCorp.jsx',
  'src/components/formacorp/FormaCorpLifecycle.jsx',
  'supabase/migrations/20260918192500_formacorp_taxres_family_compat.sql',
]
const content = files.map(p => fs.readFileSync(p,'utf8')).join('\n')
const failures = []
const assert = (ok,msg) => { if(!ok) failures.push(msg) }

assert(!/bizee/i.test(content), 'FormaCorp native workflow must not depend on Bizee')
assert(!/orders\.bizee\.com|bizee\.com/i.test(content), 'External Bizee URL detected')
assert(!/popup=yes|formacorp_bizee_pro|Open Bizee Secure Window/i.test(content), 'External Bizee popup workflow detected')
assert(!/<iframe[^>]+bizee/i.test(content), 'Bizee iframe workflow detected')
assert(!/zapier|make\.com|browserless|proxycurl/i.test(content), 'Paid middleware/add-on detected in FormaCorp scope')
assert(/Start Business Formation/.test(content), 'Native formation entry point is missing')
assert(/FormaCorp native filing workflow/.test(content), 'Native filing workflow card is missing')
assert(/Florida submission inside FormaCorp/.test(content), 'In-CRM Florida submission controls are missing')
assert(/submitFloridaFax/.test(content), 'Existing in-CRM Florida fax submission path is missing')
assert(/Record State Submission/.test(content), 'State submission tracking control is missing')
assert(/Record Approval/.test(content), 'State approval tracking control is missing')
assert(/Record Rejection/.test(content), 'State rejection tracking control is missing')
assert(/Operating Agreement/.test(content), 'Operating Agreement workflow is missing')
assert(/Bank Account Setup|Banking/.test(content), 'Banking workflow is missing')
assert(/Compliance/.test(content), 'Compliance workflow is missing')

if(failures.length){
  console.error('FormaCorp native invariant check FAILED:')
  for(const f of failures) console.error(' - '+f)
  process.exit(1)
}
console.log('FormaCorp native invariant check PASS')
