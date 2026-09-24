const fs = require('fs')

const leads = fs.readFileSync('src/pages/Leads.jsx', 'utf8')
const clients = fs.readFileSync('src/pages/Clients.jsx', 'utf8')
const failures = []

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
forbid(clients, 'const skipped = []\n    for (let attempt = 0; attempt < 12; attempt++) {\n      ;({error} = await supabase.from(\'clients\')', 'Client save still silently strips fields')

// Lead form/conversion.
need(leads, "if (status === 'Converted to Client') {\n      await convertToClient(l)", 'Converted status must route through conversion')
need(leads, "STATUSES.filter(s=>s!=='Converted to Client')", 'Generic lead editor still offers fake conversion')
need(leads, "const { biz_same_as_personal, ...persistableForm } = form", 'Lead UI-only address flag not excluded')
need(leads, 'function setLeadPersonalAddressField', 'Lead same-as-personal sync helper missing')
need(leads, "if (Array.isArray(l.services)) return l.services", 'Lead services are not normalized for client array column')
need(leads, "navigate('/clients/' + newClient.id)", 'Conversion does not navigate to new client')
need(leads, "{['All',...STATUSES].map(s => (", 'Converted leads are not inspectable from status filters')
need(leads, "l.status!=='Converted to Client').length", 'Total Leads stat must match the default working lead list')
forbid(leads, 'const skipped = []\n    for (let attempt = 0; attempt < 12; attempt++) {', 'Lead save still silently strips fields')

if (failures.length) {
  console.error('CloudCPA core CRM invariant check FAILED:')
  failures.forEach(f => console.error(' - ' + f))
  process.exit(1)
}
console.log('CloudCPA core CRM invariant check PASS')
