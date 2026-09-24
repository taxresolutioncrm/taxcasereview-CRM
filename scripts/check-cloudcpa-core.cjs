const fs = require('fs')

const leads = fs.readFileSync('src/pages/Leads.jsx', 'utf8')
const clients = fs.readFileSync('src/pages/Clients.jsx', 'utf8')
const failures = []

const calendar = fs.readFileSync('src/pages/Calendar.jsx', 'utf8')
const employees = fs.readFileSync('src/pages/Employees.jsx', 'utf8')
const settings = fs.readFileSync('src/pages/Settings.jsx', 'utf8')
const payments = fs.readFileSync('src/pages/Payments.jsx', 'utf8')
const invoices = fs.readFileSync('src/pages/Invoices.jsx', 'utf8')
const estimates = fs.readFileSync('src/pages/Estimates.jsx', 'utf8')
const documents = fs.readFileSync('src/pages/Documents.jsx', 'utf8')
const cases = fs.readFileSync('src/pages/Cases.jsx', 'utf8')
const invoiceSync = fs.readFileSync('src/lib/invoiceSync.js', 'utf8')
const idMigration = fs.readFileSync('supabase/migrations/20260924212500_collision_proof_text_ids.sql', 'utf8')
const numberMigration = fs.readFileSync('supabase/migrations/20260924214000_atomic_case_invoice_numbers.sql', 'utf8')
const schemaMigration = fs.readFileSync('supabase/migrations/20260924215000_operational_schema_alignment.sql', 'utf8')
const settingsMigration = fs.readFileSync('supabase/migrations/20260924221500_settings_integration_alignment.sql', 'utf8')
const conversionMigration = fs.readFileSync('supabase/migrations/20260924211000_lead_conversion_integrity.sql', 'utf8')
const invoiceAdjustMigration = fs.readFileSync('supabase/migrations/20260924220000_atomic_invoice_payment_adjustments.sql', 'utf8')

function need(src, text, msg) {
  if (!src.includes(text)) failures.push(msg)
}
function forbid(src, text, msg) {
  if (src.includes(text)) failures.push(msg)
}

// Client form: handlers must be local to ClientFormModal, not leaked from Clients().
need(clients, 'function ClientFormModal', 'ClientFormModal missing')
need(clients, 'function fmtPhoneInput', 'Client modal local phone formatter missing')
need(clients, 'function fmtSsnInput', 'Client modal local SSN formatter missing')
need(clients, 'function fmtEinInput', 'Client modal local EIN formatter missing')
need(clients, 'function handleZipInput', 'Client modal local ZIP handler missing')
need(clients, 'function toggleBusinessAddressSame', 'Client modal business-address helper missing')
need(clients, 'function setPersonalAddressField', 'Client modal personal/business address sync missing')
need(clients, "pipelineStage: pipelineStage || DEFAULT_PIPELINE_STAGE", 'Client pipeline stage not persisted')
need(clients, 'tenant_id, deleted_at, archived, dnd, biz_same_as_personal,', 'UI-only client address flag not excluded from payload')
need(clients, "triggerWorkflow('client_sms_sent'", 'Client SMS action is wired to the wrong workflow event')
forbid(clients, 'const skipped = []\n    for (let attempt = 0; attempt < 12; attempt++) {\n      ;({error} = await supabase.from(\'clients\')', 'Client save still silently strips fields')

// Lead form/conversion.
need(leads, "if (status === 'Converted to Client') {\n      await convertToClient(l)", 'Converted status must route through conversion')
need(leads, "STATUSES.filter(s=>s!=='Converted to Client')", 'Generic lead editor still offers fake conversion')
need(leads, "id, created_at, tenant_id, archived, deleted_at, biz_same_as_personal,", 'Lead UI/internal fields not excluded from payload')
need(leads, 'function setLeadPersonalAddressField', 'Lead same-as-personal sync helper missing')
need(leads, "if (Array.isArray(l.services)) return l.services", 'Lead services are not normalized for client array column')
need(leads, "navigate('/clients/' + newClient.id)", 'Conversion does not navigate to new client')
need(leads, "{['All',...STATUSES].map(s => (", 'Converted leads are not inspectable from status filters')
need(leads, "l.status!=='Converted to Client').length", 'Total Leads stat must match the default working lead list')
forbid(leads, 'const skipped = []\n    for (let attempt = 0; attempt < 12; attempt++) {', 'Lead save still silently strips fields')
need(leads, 'function buildLeadPayload', 'Lead save payload hardening helper missing')
need(leads, "taxYears: JSON.stringify(toArray(source.taxYears))", 'Lead tax years are not normalized before persistence')
need(leads, "services: JSON.stringify(toArray(source.services))", 'Lead services are not normalized before persistence')

if (failures.length) {
  console.error('CloudCPA core CRM invariant check FAILED:')
  failures.forEach(f => console.error(' - ' + f))
  process.exit(1)
}
console.log('CloudCPA core CRM invariant check PASS')


// Cross-CRM persistence and schema invariants.
forbid(calendar, 'for (let attempt = 0; attempt < 12; attempt++)', 'Calendar save still silently strips rejected columns')
forbid(employees, 'for (let attempt = 0; attempt < 12; attempt++)', 'Employee save still silently strips rejected columns')
forbid(settings, 'for (let attempt = 0; attempt < 12; attempt++)', 'Settings save still silently strips rejected columns')
need(calendar, "const payload = {\n      title: form.title", 'Calendar must use an explicit schema-safe payload')
need(payments, 'function isSettledPaymentStatus', 'Payment-to-invoice sync must distinguish settled from pending payments')
need(payments, 'let insertedPaymentId = null', 'Payment rollback must target the exact inserted row')
need(invoiceSync, "supabase.rpc('invoice_adjust_paid'", 'Invoice balance writes must use the atomic database RPC')
need(invoices, "import { applyPaymentToInvoice } from '../lib/invoiceSync'", 'Invoice manual payments must share atomic invoice sync')
need(estimates, ".select('id,invNum').single()", 'Estimate conversion must read the database-assigned invoice number')
need(documents, "Document upload rollback failed", 'Document metadata failures must roll back the uploaded storage object')
need(employees, "storage_path: path", 'Employee document metadata must keep the private storage path')
need(cases, 'Case number is assigned atomically by the database per tenant.', 'Cases must not generate case numbers in the browser')
need(invoices, 'Invoice number is assigned atomically by the database per tenant.', 'Invoices must not generate invoice numbers in the browser')
need(idMigration, "gen_random_uuid()", 'Operational text IDs must use collision-proof UUID-backed defaults')
need(numberMigration, 'pg_advisory_xact_lock', 'Case/invoice numbering must be serialized in PostgreSQL')
need(schemaMigration, 'add column if not exists "checkNum" text', 'Payments schema must support the fields exposed by the UI')
need(schemaMigration, 'add column if not exists updated_at timestamptz', 'Operational tables must support updated_at writes')
need(schemaMigration, 'assign_estimate_number', 'Estimate numbering must be tenant-scoped and atomic')
need(settingsMigration, 'otter_api_key', 'Settings schema must persist the Otter credential exposed in the UI')
need(conversionMigration, 'trg_lead_conversion_integrity', 'Database must reject orphaned Converted-to-Client statuses')
need(invoiceAdjustMigration, 'for update', 'Invoice payment adjustment RPC must row-lock the invoice')
