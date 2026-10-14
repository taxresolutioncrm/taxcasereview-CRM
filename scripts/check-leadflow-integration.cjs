const fs = require('fs')

const sql = fs.readFileSync('sql/leadflow_final_integration.sql','utf8')
const failures = []
const assert = (ok,msg) => { if (!ok) failures.push(msg) }

const requiredFunctions = [
  'leadflow_upsert_lead',
  'leadflow_upsert_unpaid_lead',
  'leadflow_create_case',
  'leadflow_book_appointment',
  'leadflow_cancel_appointment',
]

for (const fn of requiredFunctions) {
  assert(sql.includes(`CREATE OR REPLACE FUNCTION public.${fn}(`), `missing function ${fn}`)
  assert(sql.includes(`REVOKE EXECUTE ON FUNCTION public.${fn}(`), `missing revoke for ${fn}`)
  assert(sql.includes(`GRANT EXECUTE ON FUNCTION public.${fn}(`), `missing service-role grant for ${fn}`)
}

assert((sql.match(/SECURITY DEFINER/g) || []).length === 5, 'all five LeadFlow RPCs must be SECURITY DEFINER')
assert((sql.match(/SET search_path = ''/g) || []).length === 5, 'all five LeadFlow RPCs must pin an empty search_path')
assert((sql.match(/tenant_code = 'TRC-001'/g) || []).length === 5, 'all five LeadFlow RPCs must resolve the Tax Case Review tenant explicitly')
assert((sql.match(/TO service_role/g) || []).length === 5, 'all five LeadFlow RPCs must be service_role-only')
assert((sql.match(/FROM PUBLIC, anon, authenticated/g) || []).length === 5, 'all five LeadFlow RPCs must revoke PUBLIC/anon/authenticated execution')

assert(sql.includes('CREATE OR REPLACE FUNCTION public.leadflow_upsert_unpaid_lead('), 'unpaid-lead upsert missing')
assert(sql.includes("'New Lead', 'TaxCase Review Web'"), 'unpaid-lead insert must remain unpaid/new')
assert(sql.includes('investigation_fee_paid, inv_fee_paid'), 'unpaid-lead insert must explicitly preserve unpaid flags')

assert(sql.includes('CREATE OR REPLACE FUNCTION public.leadflow_book_appointment('), 'appointment booking RPC missing')
assert(sql.includes('"assignedTo"'), 'booking must write assigned professional')
assert(sql.includes('"endTime"'), 'booking must write end time')
assert(sql.includes("'scheduled', 'leadflow'"), 'booking must write scheduled status and LeadFlow source')

assert(sql.includes('CREATE OR REPLACE FUNCTION public.leadflow_cancel_appointment('), 'appointment cancellation RPC missing')
assert(sql.includes("SET status = 'canceled'"), 'cancellation must set canceled status')
assert(sql.includes("RAISE EXCEPTION 'Appointment not found'"), 'cancellation must reject unknown appointment IDs')

assert(!sql.includes('"irsOrState"'), 'LeadFlow case insert must not reference removed cases.irsOrState column')
assert(sql.includes('RETURNS text'), 'LeadFlow RPCs must return text identifiers')
assert(sql.includes("p_appointment_id text"), 'cancellation appointment id parameter missing')
assert(sql.includes("p_reason         text DEFAULT NULL"), 'cancellation reason parameter missing')

if (failures.length) {
  console.error('LeadFlow integration guard FAILED:')
  for (const f of failures) console.error(' - ' + f)
  process.exit(1)
}

console.log('PASS LeadFlow final integration guardrails')
