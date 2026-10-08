const fs = require('fs')

const files = [
  'src/lib/docUtils.js',
  'src/lib/irsFormUtils.js',
  'src/lib/invoicePdf.js',
  'src/lib/taxReturnPdf.js',
  'src/lib/agreementPdf.js',
  'src/lib/emailTemplate.js',
  'src/lib/exportUtils.js',
  'src/pages/IrsForms.jsx',
  'src/pages/StateForms.jsx',
  'src/pages/Invoices.jsx',
  'src/pages/Estimates.jsx',
  'src/pages/Payroll.jsx',
  'src/pages/Payments.jsx',
  'src/pages/TimeEntry.jsx',
  'src/pages/Esign.jsx',
  'src/pages/SignPage.jsx',
  'src/pages/Clients.jsx',
  'src/pages/Leads.jsx',
  'src/components/IRSFormFiller.jsx',
  'src/components/OrganizerWizard.jsx',
  'src/components/SendPaymentLinkModal.jsx',
  'src/pages/EmployeePortal.jsx',
]

const failures = []
const stripComments = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter(line => !line.trim().startsWith('//'))
  .join('\n')

for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8')
  const src = stripComments(raw)
  const prohibited = [
    ['Tax Case Review', /Tax Case Review/i],
    ['legacy TCR toll-free', /\(888\)\s*334-5052/],
    ['legacy TCR fax', /\(561\)\s*420-(?:6626|6999)/],
    ['legacy TCR email/domain', /(?:info@)?taxcasereview\.org/i],
  ]
  for (const [label, re] of prohibited) {
    if (re.test(src)) failures.push(`${file}: contains ${label}`)
  }
}

const need = (file, needle, msg) => {
  const src = fs.readFileSync(file, 'utf8')
  if (!src.includes(needle)) failures.push(`${file}: ${msg}`)
}

// Every office-generated document family must consume live tenant branding.
need('src/lib/docUtils.js', 'FIRM.logoUrl', 'shared agreements/covers do not use tenant logo')
need('src/lib/irsFormUtils.js', 'FIRM.logoUrl', 'generated IRS/payment PDFs do not use tenant logo')
need('src/lib/invoicePdf.js', 'firm.logoUrl', 'invoice PDF does not use tenant logo')
need('src/lib/taxReturnPdf.js', 'FIRM.logoUrl', 'tax-return PDF does not use tenant logo')
need('src/lib/agreementPdf.js', 'firmLogoUrl', 'agreement PDF does not accept tenant logo')
need('src/pages/IrsForms.jsx', 'FIRM.logoUrl', 'IRS office documents do not use tenant logo')
need('src/pages/StateForms.jsx', 'FIRM.logoUrl', 'state office documents do not use tenant logo')
need('src/pages/Payroll.jsx', 'firm?.logourl', 'pay stubs do not use tenant logo')
need('src/pages/Payments.jsx', 'FIRM.logoUrl', 'payment receipts do not use tenant logo')
need('src/lib/exportUtils.js', 'FIRM.logoUrl', 'PDF exports do not use tenant logo')
need('src/lib/emailTemplate.js', 'FIRM.logoUrl', 'outgoing branded email wrapper does not use tenant logo')

const contactMigration = fs.readFileSync('supabase/migrations/20261008173500_cloudcpa_contact_branding_cleanup.sql','utf8')
if (!contactMigration.includes("logourl = '/cloudcpa-logo.png'")) failures.push('CloudCPA logo migration missing')
if (!contactMigration.includes("phone = '+15612039464'")) failures.push('CloudCPA company phone migration missing')
if (!contactMigration.includes("firm_fax_number = '+15613280029'")) failures.push('CloudCPA fax migration missing')

if (failures.length) {
  console.error('CloudCPA document branding check FAILED:')
  failures.forEach(f => console.error(' - ' + f))
  process.exit(1)
}
console.log('CloudCPA document branding check PASS')
