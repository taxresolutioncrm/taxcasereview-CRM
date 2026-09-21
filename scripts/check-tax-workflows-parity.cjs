const fs = require('fs')
const failures = []
const read = p => fs.readFileSync(p,'utf8')
const need = (p,n,label=n) => {
  if (!fs.existsSync(p)) { failures.push(p + ': missing'); return }
  if (!read(p).includes(n)) failures.push(p + ': missing ' + label)
}

const transcript = 'src/components/TranscriptPull.jsx'
for (const n of ['IRS Transcript Delivery','Request Transcripts','Add a tax year…','selectedYears.has(year)','selectedYears.size','poaYears.has(y)','Manual PDF fallback',"provider: 'irs_a2a'",'client_id: client.id']) need(transcript,n)
const t = read(transcript)
for (const bad of ['selectedYears.includes(','selectedYears.length','selectedYears.every(','poaYears.includes(','poaYears.length']) {
  if (t.includes(bad)) failures.push('TranscriptPull contains Set-unsafe year handling: '+bad)
}

const returns = 'src/pages/TaxReturns.jsx'
for (const n of ['Ready to File','submit-to-irs','Accepted','Rejected','EFIN','efileStatus','TAX_RETURN_DB_MAP','toDbReturnPayload','fromDbReturn','payload.data']) need(returns,n)
need('supabase/migrations/20260921231000_tax_returns_data_payload.sql','add column if not exists data jsonb','Tax Returns extended-data migration')
const r = read(returns)
if (/create table if not exists tax_returns|create policy\s+["']anon_all/i.test(r)) failures.push('TaxReturns must not ship browser-facing SQL or anon_all setup instructions')

const forma = 'src/pages/FormaCorp.jsx'
for (const n of ['Start Business Formation','Florida submission inside FormaCorp','submitFloridaFax','isFloridaCorporation','fl_authorized_shares','fl_incorporator_signature','Pay Government Filing Amount','state_fee_payment_status','state_fee_remitted_at','Record State Submission','Record Approval','Record Rejection','FormaCorpLifecycle','FormaCorpStateFeeModal']) need(forma,n)
for (const n of ['buildFlFaxPacket','Articles of Incorporation']) need('src/lib/flArticlesPdf.js',n)
for (const n of ['buildCorporateBylawsPdf','Corporate Bylaws','Operating Agreement','Banking','Compliance']) need('src/components/formacorp/FormaCorpLifecycle.jsx',n)
for (const n of ['formacorp-state-fee-intent','formacorp-state-fee-confirm']) need('src/components/formacorp/FormaCorpStateFeeModal.jsx',n)
for (const n of ['buildOperatingAgreementPdf','buildCorporateBylawsPdf','buildBankingResolutionPdf']) need('src/lib/formacorpDocs.js',n)

const manual='src/pages/Manual.jsx'
for (const n of ['Pulling transcripts inside the CRM','Add a tax year dropdown','Documents → Transcripts','A-to-Z business formation','Pay Government Filing Amount','Company Lifecycle → EIN']) need(manual,n)

if (failures.length) {
  console.error('Tax workflow parity check FAILED:')
  failures.forEach(f => console.error(' - ' + f))
  process.exit(1)
}
console.log('Tax workflow parity check PASS')
