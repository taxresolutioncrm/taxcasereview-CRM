const fs = require('fs')

const manual = fs.readFileSync('src/pages/Manual.jsx','utf8')
const sidebar = fs.readFileSync('src/components/layout/Sidebar.jsx','utf8')
const failures = []
const assert = (ok,msg) => { if(!ok) failures.push(msg) }

// The CRM Manual is a release artifact, not optional documentation.
// Any new sidebar workflow must be mapped to a maintained manual section here.
// When an existing workflow changes, update its manual section in the same release.
const routeToManual = {
  '/email':'email',
  '/email-blast':'email-blast',
  '/chat':'chat',
  '/calendar':'calendar',
  '/tasks':'tasks',
  '/dialer':'calling',
  '/ai-intelligence':'ai-intelligence',
  '/leads':'leads',
  '/clients':'clients',
  '/cases':'clients',
  '/deadlines':'deadlines',
  '/sms':'sms',
  '/fax':'fax',
  '/documents':'documents',
  '/esign':'esign',
  '/invoices':'invoices',
  '/payments':'payments',
  '/ar':'payments',
  '/transactions':'transactions',
  '/timeentry':'timebilling',
  '/books':'books',
  '/irsforms':'forms',
  '/stateforms':'stateforms',
  '/irsreference':'irsreference',
  '/irsportal':'transcripts',
  '/taxreturns':'taxreturns',
  '/formacorp':'formacorp',
  '/kiosk':'kiosk',
  '/employee':'empportal',
  '/timeclock':'timeclock',
  '/timeoff':'timeoff',
  '/payroll':'payroll',
  '/activity-report':'activityreport',
  '/employees':'roles',
  '/reports':'reports',
  '/workflows':'workflows',
  '/settings':'settings',
  '/training':'training',
  '/manual':'manual-about',
}

const routes = [...sidebar.matchAll(/\{\s*path:\s*'([^']+)'/g)]
  .map(m=>m[1])
  .filter(p=>p!=='/')

for (const route of routes) {
  const manualId = routeToManual[route]
  assert(!!manualId, `Sidebar route ${route} has no manual-sync mapping`)
  if (manualId) assert(new RegExp(`id:\\s*['"]${manualId}['"]`).test(manual), `Manual section ${manualId} required for ${route} is missing`)
}

const familyScopeSignals = [
  ['central TaxRes scope', /central TaxRes CRM experience|central TaxRes-family offices/],
  ['TCR scope', /Tax Case Review/],
  ['CloudCPA scope', /CloudCPA/],
  ['Demo scope', /Demo/],
]
for (const [name,re] of familyScopeSignals) assert(re.test(manual), `CRM Manual is missing central-family scope: ${name}`)
assert(!/Nashville/.test(manual), 'TCR Manual must not expose Nashville-only instructions')

const requiredWorkflowSignals = [
  ['employee CRM invitation', /Send the CRM invitation/],
  ['employee password setup/recovery', /same TaxRes family identity|same TaxRes family access flow|TaxRes family password/],
  ['email Spam/Junk folder', /Open Email → Spam/],
  ['provider Spam/Junk synchronization', /Gmail SPAM and other supported provider Junk\/Spam folders/],
  ['e-sign progress audit', /Last Viewed \/ Progress/],
  ['ID-authoritative document filing', /authoritative client ID/],
  ['Book Whip', /Book Whip is the monthly client\/associate\/para production review/],
  ['QuickBooks tenant connection', /QuickBooks Online connection/],
  ['FormaCorp embedded state-fee payment', /Pay Government Filing Amount/],
  ['FormaCorp Sunbiz submission', /Submit via Prepaid Sunbiz Fax/],
  ['FormaCorp EIN lifecycle', /Company Lifecycle → EIN/],
  ['manual release rule', /CRM Manual is part of the release scope/],
]
for (const [name,re] of requiredWorkflowSignals) assert(re.test(manual), `CRM Manual is missing current workflow documentation: ${name}`)

if (failures.length) {
  console.error('CRM manual synchronization check FAILED:')
  for (const f of failures) console.error(' - '+f)
  process.exit(1)
}
console.log('✓ TaxRes-family CRM manual synchronization check PASS')
