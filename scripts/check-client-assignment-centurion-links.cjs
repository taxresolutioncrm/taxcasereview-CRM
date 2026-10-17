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
const docUtils=read('src/lib/docUtils.js')
const irsFiller=read('src/components/IRSFormFiller.jsx')
const stateForms=read('src/pages/StateForms.jsx')
const esignPage=read('src/pages/Esign.jsx')
const archiveFn=read('supabase/functions/esign-archive-upload/index.ts')

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
  ['organizer creation writes tenant explicitly',clients.includes("tenant_id: tenantId,\n        client_name: client.name")&&clients.includes(".eq('tenant_id', tenantId).eq('client_name', client.name)")],
  ['public organizer resolves its tenant branding',organizer.includes('loadFirmBrandingPublic(data.tenant_id)')],
  ['public portal resolves branding from client tenant',portal.includes("booking_get_public_meta', { p_client_id: id }")],
  ['public e-sign resolves branding from signed document tenant',sign.includes('loadFirmBrandingPublic(data.tenant_id)')],
  ['public financial intake resolves branding from intake tenant',intake.includes('loadFirmBrandingPublic(rec?.tenant_id)')],
  ['client link emails stay tenant scoped',clients.includes("function InlinePortalForm({ client, onClose, showToast, tenantId })")&&clients.includes("function InlineOrganizerForm({ client, onClose, showToast, tenantId })")&&clients.includes("body: { tenant_id: tenantId,")],
  ['Centurion client links have platform Stalwart fallback',sendEmail.includes("['TRC-003','TRC-004']")&&sendEmail.includes("relayTenant?.tenant_code === 'TRC-004' ? 'Centurion Firm'")&&sendEmail.includes("via:'taxres_platform_relay'")],
  ['Centurion SMS has explicit platform relay',read('supabase/functions/send-sms/index.ts').includes("['TRC-003','TRC-004','ADMIN']")],
  ['lead e-sign receives current tenant',leads.includes('function LeadInlineEsign({ lead, onClose, tenantId })')&&leads.includes('tenantId={myTenantId}')],
  ['lead e-sign writes tenant and lead IDs explicitly',leads.includes('tenant_id:tenantId')&&leads.includes('lead_id:lead?.id || null')],
  ['lead e-sign creates tokenized signing link and fails closed without token',leads.includes("window.location.origin+'/sign/'+data.id+'?token='+encodeURIComponent(data.signer_token)")&&leads.includes("Signing request token was not created")],
  ['full package contract storage is tenant-prefixed',docUtils.includes('`${tenantId}/docs/${safeName}/package/agreement.pdf`')&&docUtils.includes('`${tenantId}/docs/${safeName}/package/${formType}.pdf`')&&docUtils.includes('`${tenantId}/docs/${safeName}/package/state_poa_${clientState}${suffix}.pdf`')],
  ['service addendum storage is tenant-prefixed',docUtils.includes('`${tenantId}/docs/${safeName}/addendum/addendum_${Date.now()}.pdf`')],
  ['full package e-sign row writes tenant explicitly',docUtils.includes("tenant_id: tenantId,\n    sent_at: new Date().toISOString()")],
  ['lead custom e-sign uploads are tenant-prefixed',leads.includes("const path=`${officeTenant}/docs/${lead?.id || 'lead'}/esign-custom/${Date.now()}-${customFile.name}`")],
  ['lead contract SMS uses tenant-aware edge function',leads.includes("functions.invoke('send-sms'")&&!leads.includes("signalwire_backend+'/sms/send'")&&!leads.includes("signalwire_backend + '/sms/send'")],
  ['lead state POA storage is tenant-prefixed',leads.includes('`${myTenantId}/docs/${safeName}/state-poa/${formDef.state}_POA${suffix}_${stamp}.pdf`')],
  ['lead state POA e-sign row is tenant-scoped',leads.includes("priority:'Normal', status:'Awaiting', tenant_id:myTenantId")],
  ['client custom e-sign upload is tenant-prefixed',clients.includes("`${officeTenant}/docs/${client?.id || 'client'}/esign-custom/${Date.now()}-${customFile.name}`")],
  ['client state POA storage is tenant-prefixed',clients.includes('`${myTenantId}/docs/${safeName}/state-poa/${formDef.state}_POA_${Date.now()}.pdf`')],
  ['IRS form e-sign storage is tenant-prefixed',irsFiller.includes('`${myTenantId}/docs/${safeName}/irs-forms/${formType}_${Date.now()}.pdf`')],
  ['IRS form e-sign row and email use active tenant',irsFiller.includes('tenant_id: myTenantId')&&!irsFiller.includes("const path = `docs/${safeName}/irs-forms/")],
  ['State Forms e-sign storage is tenant-prefixed',stateForms.includes('`${myTenantId}/docs/${safeName}/state-poa/${form.state}_POA_${Date.now()}.pdf`')],
  ['State Forms e-sign row and email use active tenant',stateForms.includes('tenant_id: myTenantId')&&!stateForms.includes("const path = `docs/${safeName}/state-poa/")],
  ['central E-Sign creation writes active tenant',esignPage.includes('tenant_id: myTenantId')&&esignPage.includes("if (!myTenantId) { showToast('Could not resolve office tenant. Refresh and try again.'); return }")],
  ['central E-Sign email uses active tenant',esignPage.includes('tenant_id:myTenantId')],
  ['public signing page does not shadow firmName helper',!sign.includes("const [firmName, setFirmName]")&&sign.includes("const [firmDisplayName, setFirmDisplayName]")],
  ['public signing page renders resolved firm name',sign.includes("{firmDisplayName || FIRM.name || 'Firm'} has been notified.")&&sign.includes(">{firmDisplayName || FIRM.name || 'Firm'}</div>")],
  ['lead fax upload is tenant-prefixed',leads.includes('`${tenantId}/docs/${lead?.id || \'lead\'}/fax/${Date.now()}_')&&leads.includes('tenantId={myTenantId}')],
  ['client fax upload is tenant-prefixed',clients.includes('`${tenantId}/docs/${client?.id || \'client\'}/fax/${Date.now()}_')&&clients.includes('tenantId={myTenantId}')],
  ['signed e-sign archive is tenant-prefixed',archiveFn.includes('const prefix=`${e.tenant_id}/docs/${clean(e.client_name||\'client\')}/signed/${id}`')&&!archiveFn.includes('const prefix=`docs/${clean(e.client_name||\'client\')}/signed/${id}`')],
  ['signed archive refuses missing tenant',archiveFn.includes("if(!e.tenant_id)return json({error:'Signing request tenant is missing'},500)")],
  ['full package helper requires active tenant override',docUtils.includes("sendFullPackage(client, supabase, tenantIdOverride = '')")&&docUtils.includes('const tenantId = tenantIdOverride')&&!docUtils.includes('tenantIdOverride || FIRM.tenantId')],
  ['addendum helper requires active tenant override',docUtils.includes("sendAddendumForSignature(record, opts, supabase, sentBy, tenantIdOverride = '')")&&docUtils.includes('const tenantId = tenantIdOverride')],
  ['lead full package passes active tenant',leads.includes('sendFullPackage({...l, address:l.street, business_name:l.business_name||l.name}, supabase, myTenantId)')],
  ['lead addendum passes active tenant',leads.includes('sendAddendumForSignature(l, addForm, supabase, actor, myTenantId)')],
  ['client addendum passes active tenant',clients.includes('sendAddendumForSignature(c, addForm, supabase, actor, myTenantId)')&&clients.includes('sendAddendumForSignature(detail, plan, supabase, actor, myTenantId)')],
  ['package attachments persist storage paths',docUtils.includes("storage_path: agreementPath")&&docUtils.includes("storage_path: path")],
  ['lead signing attachments persist storage paths',leads.includes("storage_path:path")&&leads.includes("storage_path:path })")],
  ['lead custom e-sign fails closed on upload error',leads.includes("if(upErr) throw upErr")&&leads.includes("alert('Custom document upload failed: '")],
  ['e-sign attachment loader enforces tenant boundary',archiveFn.includes("Attachment tenant mismatch")&&archiveFn.includes("p.startsWith(String(e.tenant_id)+'/')")],
  ['package email does not promise payment when Stripe unavailable',leads.includes("subject: stripePayUrl ? `Action Required: Sign & Pay")&&leads.includes("Step ${stripePayUrl ? '3' : '2'} — Complete Your Financial Intake")],
  ['full package fails closed if agreement cannot be built',docUtils.includes('Failed to build Tax Service Agreement:')&&docUtils.includes("Tax Service Agreement is missing from the package")],
  ['full package validates every secure document link',docUtils.includes("Could not create secure agreement link")&&docUtils.includes("Could not create secure document link")&&docUtils.includes("Could not create secure State POA link")],
  ['full package intake is a real tenant record before delivery',leads.includes(".eq('tenant_id', myTenantId)")&&leads.includes("client_id: l.id || null")&&!leads.includes("`${window.location.origin}/financial-intake/${l.id}`")],
  ['full package does not advance workflow on delivery failure',leads.includes("action:'package_delivery_failed'")&&leads.includes("if(!sent.length)")&&leads.indexOf("if(!sent.length)")<leads.indexOf("advanceLeadStatus(supabase, l.name, 'Tax Inv Agreement Sent')")],
  ['lead State POA reports failed delivery accurately',leads.includes("State POA created but not delivered")&&leads.includes("deliveryErrors")],
  ['standalone State Forms reports failed delivery accurately',stateForms.includes("State POA created but not delivered")&&stateForms.includes("deliveryErrors")],
  ['IRS form delivery failure is visible',irsFiller.includes("Signing request created, but delivery failed")&&irsFiller.includes("deliveryErrors")],
  ['client addendum does not claim send when delivery fails',clients.includes("Service Addendum created but not delivered")&&clients.includes("deliveryErrors")],
  ['public financial intake mail uses validated server kinds',intake.includes("kind:'financial_intake_client_copy'")&&intake.includes("kind:'financial_intake_staff_notification'")&&!intake.includes("body: { tenant_id: FIRM.tenantId || undefined")],
  ['send-email validates submitted intake before public mail',sendEmail.includes("body.kind === 'financial_intake_client_copy' || body.kind === 'financial_intake_staff_notification'")&&sendEmail.includes("String(intake.status) !== 'Submitted'")&&sendEmail.includes("tenant_id = intake.tenant_id")],
  ['public intake recipients are server-derived',sendEmail.includes("to = intake.client_email")&&sendEmail.includes("to = employee.email")&&sendEmail.includes("skipped:'no_active_assignee_email'")],
  ['all financial intake lead paths are tenant scoped',leads.includes(".select('answers')\n        .eq('tenant_id', myTenantId)")&&leads.includes(".select('id').eq('tenant_id', myTenantId).eq('client_name', l.name)")&&leads.includes("tenant_id: myTenantId, client_id: l.id || null")],
  ['client document component receives and enforces active tenant',clients.includes("function ClientDocs({ clientId, clientName, tenantId, supabase")&&clients.includes("select('*').eq('tenant_id', tenantId)")&&clients.includes("tenant_id: tenantId,")&&clients.includes("tenantId={myTenantId}")],
  ['all signing creation paths fail closed on missing token',docUtils.includes("Signing request token was not created")&&leads.includes("Signing request token was not created")&&clients.includes("Signing request token was not created")&&irsFiller.includes("Signing request token was not created")&&stateForms.includes("Signing request token was not created")],
  ['central E-Sign lists are tenant scoped',esignPage.includes("from('esigns').select('*').eq('tenant_id', myTenantId)")&&esignPage.includes("from('clients').select('id,name,email,phone').eq('tenant_id', myTenantId)")],
  ['central E-Sign mutations are tenant scoped',esignPage.includes("update({ status: 'Awaiting', sent_at: new Date().toISOString() }).eq('tenant_id', myTenantId).eq('id', item.id)")&&esignPage.includes("update({ status }).eq('tenant_id', myTenantId).eq('id', id)")&&esignPage.includes("delete().eq('tenant_id', myTenantId).eq('id', id)")],
  ['central E-Sign resend fails closed without signer token',esignPage.includes("if (!url) { showToast('Signing token is missing — regenerate the request.'); return }")],
  ['public E-Sign mutations are tenant bound',archiveFn.includes("update({opened_at:openedAt}).eq('tenant_id',e.tenant_id)")&&archiveFn.includes("}).eq('tenant_id',e.tenant_id).eq('id',id).eq('signer_token',token).in('status',['Awaiting','Viewed'])")&&archiveFn.includes(".eq('tenant_id',e.tenant_id).eq('id',id).eq('signer_token',token)")],
  ['signed receipt markers are tenant bound',sendEmail.includes(".eq('tenant_id',tenant_id).eq('id',esignIdToMark)")&&read('supabase/functions/send-sms/index.ts').includes(".eq('tenant_id',tenantId).eq('id',esignIdToMark)")],
  ['signed archive SMS uses authorized e-sign receipt path',archiveFn.includes("kind:'esign_signed_receipt',esign_id:id")&&read('supabase/functions/send-sms/index.ts').includes("payload.kind==='esign_signed_receipt'&&payload.esign_id")],
]
let failed=0
for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'}  ${name}`);if(!ok)failed++}
if(failed){console.error(`Client assignment / Centurion link contract failed: ${failed} check(s)`);process.exit(1)}
console.log('PASS  Client assignment / Centurion link contract')
