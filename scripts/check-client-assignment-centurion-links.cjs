const fs=require('fs')
const read=p=>fs.readFileSync(p,'utf8')
const clients=read('src/pages/Clients.jsx')
const leads=read('src/pages/Leads.jsx')
const employees=read('src/pages/Employees.jsx')
const app=read('src/context/AppContext.jsx')
const organizer=read('src/components/OrganizerWizard.jsx')
const portal=read('src/pages/ClientPortal.jsx')
const sign=read('src/pages/SignPage.jsx')
const intake=read('src/components/FinancialIntakeWizard.jsx')
const migration=read('supabase/migrations/20261016190500_client_admin_assignment.sql')
const sendEmail=read('supabase/functions/send-email/index.ts')

const checks=[
  ['client schema has explicit Admin assignment',migration.includes('add column if not exists "clientAdmin" text')],
  ['client model carries Admin and Sales Rep',clients.includes("clientAdmin:'', salesRep:''")&&clients.includes('"clientAdmin","salesRep"')],
  ['client header exposes Associate Admin and Sales Rep dropdowns',clients.includes("['Associate','assignedTo',c.assignedTo]")&&clients.includes("['Admin','clientAdmin',c.clientAdmin]")&&clients.includes("['Sales Rep','salesRep',c.salesRep]")],
  ['client assignment writes are tenant scoped',clients.includes("if(!['assignedTo','clientAdmin','salesRep'].includes(field))")&&clients.includes(".eq('tenant_id',myTenantId).eq('id',c.id)")],
  ['client detail no longer presents Para as assignment',clients.includes('<DR label="Associate" val={c.assignedTo}/>')&&clients.includes('<DR label="Admin" val={c.clientAdmin}/>')&&clients.includes('<DR label="Sales Rep" val={c.salesRep}/>')],
  ['lead conversion always preserves a selling rep when known',leads.includes('salesRep: l.salesRep || l.assignedTo || null')],
  ['Sales Rep lead visibility is scoped like Tax Advisor',leads.includes("role === 'Tax Advisor' || role === 'Sales Rep'")],
  ['Sales Manager employee preset exists',employees.includes("'Sales Manager'")&&employees.includes("'Sales Manager': { perm_leads:3, perm_clients:1")],
  ['Sales Rep label is explicit',employees.includes("l.salesRepRole || 'Sales Rep'")],
  ['runtime supports Sales Rep and Sales Manager roles',app.includes("'Sales Rep':   { label: 'Sales Rep'")&&app.includes("'Sales Manager': { label: 'Sales Manager'")&&app.includes("'Sales Manager': {\n    canView: ['dashboard','leads','clients','cases'")],
  ['organizer creation writes tenant explicitly',clients.includes("tenant_id: FIRM.tenantId || undefined,\n        client_name: client.name")],
  ['public organizer resolves its tenant branding',organizer.includes('loadFirmBrandingPublic(data.tenant_id)')],
  ['public portal resolves branding from client tenant',portal.includes("booking_get_public_meta', { p_client_id: id }")],
  ['public e-sign resolves branding from signed document tenant',sign.includes('loadFirmBrandingPublic(data.tenant_id)')],
  ['public financial intake resolves branding from intake tenant',intake.includes('loadFirmBrandingPublic(rec?.tenant_id)')],
  ['client link emails stay tenant scoped',clients.includes("tenant_id: FIRM.tenantId || undefined")],
  ['Centurion client links have platform Stalwart fallback',sendEmail.includes("['TRC-003','TRC-004']")&&sendEmail.includes("relayTenant?.tenant_code === 'TRC-004' ? 'Centurion Firm'")&&sendEmail.includes("via:'taxres_platform_relay'")],
  ['lead e-sign receives current tenant + settings loader',leads.includes('function LeadInlineEsign({ lead, onClose, getSettings, tenantId })')&&leads.includes('tenantId={myTenantId} getSettings={getSettings}')],
  ['lead e-sign writes tenant and lead IDs explicitly',leads.includes('tenant_id:tenantId || FIRM.tenantId || undefined')&&leads.includes('lead_id:lead?.id || null')],
  ['lead e-sign email does not depend on SMS settings',!leads.includes('let smsSent=false,emailSent=false\n    const cfg = await getSettings()\n    if((sendVia')&&leads.includes("const cfg = typeof getSettings === 'function' ? await getSettings() : {}")],
]
let failed=0
for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'}  ${name}`);if(!ok)failed++}
if(failed){console.error(`Client assignment / Centurion link contract failed: ${failed} check(s)`);process.exit(1)}
console.log('PASS  Client assignment / Centurion link contract')
