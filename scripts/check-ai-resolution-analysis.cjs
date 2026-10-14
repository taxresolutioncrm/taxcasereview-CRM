const fs = require('fs')

const edge = fs.readFileSync('supabase/functions/document-intelligence/index.ts','utf8')
const ui = fs.readFileSync('src/pages/PreparedFile.jsx','utf8')
const migration = fs.readFileSync('supabase/migrations/20261014_ai_resolution_analysis.sql','utf8')
const failures = []
const assert = (ok,msg) => { if(!ok) failures.push(msg) }

const requiredPrograms = [
  'full_pay_short_term','guaranteed_ia','streamlined_ia','non_streamlined_ia','ppia','cnc_status_53',
  'oic_datc','oic_datl','oic_eta','penalty_fta','penalty_reasonable_cause','penalty_statutory_admin',
  'innocent_spouse_b','innocent_spouse_c','innocent_spouse_f','cdp_hearing','equivalent_hearing','cap_appeal',
  'levy_release_hardship','lien_withdrawal','lien_discharge','lien_subordination','lien_release',
  'audit_reconsideration','amended_refund_abatement','identity_theft_resolution','tas_hardship','tfrp_defense','payroll_tax_resolution','bankruptcy_irs_coordination'
]
for (const key of requiredPrograms) assert(edge.includes(`key:'${key}'`), `resolution catalog missing ${key}`)

assert(edge.includes("action || '').toLowerCase() === 'resolution_analysis'"), 'edge function must expose resolution_analysis action')
assert(edge.includes("sourceKey !== 'tcr'"), 'resolution analysis must remain central-TaxRes-only')
assert(edge.includes("client_financial_profiles"), 'resolution analysis must include the client Financial Profile')
assert(edge.includes("candidate_status") && edge.includes("strong_candidate") && edge.includes("insufficient_data"), 'resolution analysis must use bounded candidate statuses')
assert(edge.includes("The candidates array MUST contain one entry for every RESOLUTION_CATALOG key"), 'prompt must require complete program coverage')
assert(edge.includes("RESOLUTION_CATALOG.map((program,index)"), 'server must enforce complete catalog coverage even if AI omits entries')
assert(edge.includes("current rules/thresholds") || edge.includes("current-law"), 'analysis must require current-law practitioner verification')

for (const table of ['document_ai_resolution_runs','document_ai_resolution_candidates']) {
  assert(migration.includes('create table if not exists public.' + table), `${table} must be declared`)
  assert(migration.includes(`"${table}_tenant"`), `${table} must have a tenant RLS policy`)
}
assert(migration.includes('enable row level security'), 'resolution persistence must enable RLS')
assert(migration.includes('current_tenant_id()'), 'resolution persistence must stay tenant scoped')

assert(ui.includes("['resolution','Resolution Analysis']"), 'AI Intelligence must expose a Resolution Analysis tab')
assert(ui.includes('Analyze Resolution Options'), 'Resolution Analysis must expose an analyze action')
assert(ui.includes("action:'resolution_analysis'"), 'Resolution Analysis button must invoke the new backend action')
assert(ui.includes("document_ai_resolution_runs") && ui.includes("document_ai_resolution_candidates"), 'AI Intelligence must load persisted resolution analysis')
assert(ui.includes('Strong candidate') && ui.includes('Possible candidate') && ui.includes('Insufficient data'), 'UI must show practitioner candidate strength')
assert(ui.includes('Practitioner review:'), 'UI must surface the human-review caveat')
assert(ui.includes('PPIA') && ui.includes('innocent spouse'), 'empty-state copy must advertise broad IRS resolution coverage')

if (failures.length) {
  console.error('AI Resolution Analysis guard FAILED:')
  for (const f of failures) console.error(' - '+f)
  process.exit(1)
}
console.log('PASS  AI Resolution Analysis guardrails')
