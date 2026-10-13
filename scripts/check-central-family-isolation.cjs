const fs=require('fs')

const read=p=>fs.readFileSync(p,'utf8')
const app=read('src/App.jsx')
const sidebar=read('src/components/layout/Sidebar.jsx')
const email=read('src/pages/Email.jsx')
const settings=read('src/pages/Settings.jsx')
const manual=read('src/pages/Manual.jsx')
const branding=read('src/lib/firmBranding.js')
const bookingEmails=read('src/lib/bookingEmails.js')
const clientPortal=read('src/pages/ClientPortal.jsx')
const signPage=read('src/pages/SignPage.jsx')
const intake=read('src/components/FinancialIntakeWizard.jsx')
const kiosk=read('src/pages/Kiosk.jsx')
const clockIn=read('src/pages/ClockIn.jsx')
const appContext=read('src/context/AppContext.jsx')
const esign=read('src/pages/Esign.jsx')
const i18n=read('src/lib/i18n.js')
const manageBooking=read('src/pages/ManageBooking.jsx')
const adminPortal=read('src/pages/AdminPortal.jsx')
const quarantine=read('supabase/quarantine/central_legacy_nashville.sql')
const centralMetrics=read('supabase/quarantine/central_family_metrics_no_nashville.sql')
const storageIsolation=read('supabase/quarantine/central_storage_tenant_isolation.sql')
const documentsPage=read('src/pages/Documents.jsx')
const clientsPage=read('src/pages/Clients.jsx')
const screenShare=read('src/context/ScreenShareContext.jsx')
const retiredCentralFns=[
  'supabase/functions/m365-sync/index.ts',
  'supabase/functions/m365-oauth-start/index.ts',
  'supabase/functions/m365-oauth-callback/index.ts',
  'supabase/functions/m365-mail-gateway/index.ts',
  'supabase/functions/nashville-esign-mail/index.ts',
  'supabase/functions/nashville-esign-reminders/index.ts',
  'supabase/functions/nash-metrics-check/index.ts',
  'supabase/functions/nashville-system-mail-relay-sandbox/index.ts',
  'supabase/functions/nashville-mail-auth-probe/index.ts',
  'supabase/functions/nashville-cloudflare-inspect-temp/index.ts',
].map(read)

const failures=[]
const must=(ok,msg)=>{ if(!ok) failures.push(msg) }

const routes=[
  '/leads','/clients','/cases','/tasks','/calendar','/irsportal','/irsforms','/stateforms',
  '/taxreturns','/deadlines','/estimates','/invoices','/payments','/ar','/transactions',
  '/sms','/email','/email-blast','/documents','/esign','/timeclock','/payroll','/timeoff',
  '/employees','/activity-report','/reports','/settings','/dialer','/chat','/books',
  '/formacorp','/fax','/workflows','/timeentry','/training','/manual'
]
for(const route of routes){
  must(app.includes(`path="${route}"`)||app.includes(`path="${route}/`),`App route missing: ${route}`)
  if(!['/irsportal','/stateforms','/taxreturns','/estimates','/timeentry'].includes(route)){
    must(sidebar.includes(`path: '${route}'`),`Sidebar route missing: ${route}`)
  }
}

must(!manual.includes('Nashville'),'Central-family manual contains Nashville-specific content')
must(!manual.includes('Verizon'),'Central-family manual contains Verizon-specific content')
must(!manual.includes('Microsoft 365')&&!manual.includes('M365'),'Central-family manual contains M365-specific content')

must(branding.includes("supabase.rpc('current_tenant_id')"),'Authenticated branding must resolve current tenant')
must(branding.includes("booking_get_public_meta', { p_tenant: String(tenantHint) }"),'Public branding must require explicit tenant')
must(!branding.includes("supabase.rpc('booking_get_public_meta')"),'Public branding must not call tenantless meta RPC')

must(bookingEmails.includes("tenant_id: tenantId || FIRM.tenantId || undefined"),'Booking emails must bind delivery to explicit tenant when supplied')
must(!bookingEmails.includes("const args = tenantId ? { p_tenant: String(tenantId) } : {}"),'Booking branding must not call public meta with empty args')
must(bookingEmails.includes("bookUrl(tenantId)"),'Cancellation booking link must retain tenant')
must(bookingEmails.includes("const firm = await getFirmMeta(tenantId)"),'Tenant reply-to must resolve from tenant metadata')
const bookingInviteBody=bookingEmails.slice(bookingEmails.indexOf('export async function sendBookingInvite'))
must(bookingInviteBody.includes("tenant_id: FIRM.tenantId || undefined"),'Booking invite must use the authenticated firm tenant')
must(!bookingInviteBody.includes('tenant_id: tenantId || FIRM.tenantId || undefined'),'Booking invite must not reference an undefined tenantId variable')

must(clientPortal.includes("booking_get_public_meta', { p_client_id: id }"),'Client Portal branding must resolve from client id')
must(signPage.includes('loadFirmBrandingPublic(data.tenant_id)'), 'Signing page must brand from signed document tenant')
must(intake.includes('loadFirmBrandingPublic(rec?.tenant_id)'), 'Financial intake must brand from intake tenant')
must(kiosk.includes("booking_get_public_meta',{p_tenant:tenant}"),'Kiosk branding must use explicit tenant')
must(clockIn.includes('loadFirmBrandingPublic(tenantHint||undefined)'), 'Clock-in branding must use tenant hint')

must(settings.includes('delete payload.m365_client_id'),'Central settings must strip M365 fields outside Nashville boundary')
must(settings.includes('delete payload.verizon_api_key'),'Central settings must strip Verizon fields outside Nashville boundary')
must(settings.includes("calling_provider: 'signalwire'"),'Central calling provider default must remain SignalWire')

must(email.includes('isCloudCpaPlatformRelay'),'CloudCPA email relay path must remain explicit')
must(email.includes('myTenantId === CLOUDCPA_TENANT_ID && !gmailConnected'),'CloudCPA relay must be tenant-scoped')
must(email.includes('isNashville && (m365Connected ? ('),'M365 UI must remain behind an exact Nashville guard if shared code is present')

must(appContext.includes('This account does not have an active TaxRes-family office in this CRM.'),'Authenticated users with no active central tenant must fail closed')
must(!esign.includes('nashville-esign-mail'),'Central e-sign must never invoke Nashville mail')
must(!i18n.includes('Nashville Tax Solutions'),'Central translation bundle must not carry Nashville UI copy')
must(manageBooking.includes('loadFirmBrandingPublic(rec?.tenant_id)'),'Manage Booking must brand from the booking tenant')
must(!adminPortal.includes("{ key:'nashville'"),'Central Admin Portal metrics must not request Nashville')

for(const asset of [
  'public/cloudcpa-logo.png',
  'public/taxrescrm-logo.png',
  'public/taxrescrm-favicon.png',
  'public/templates/2848_Pers_RC.pdf',
  'public/templates/2848_RC_Biz.pdf',
  'public/templates/8821_Pers_RC.pdf',
  'public/templates/8821_Biz_RC.pdf',
  'public/templates/433A_Blank.pdf',
  'public/templates/433B_Blank.pdf',
  'public/templates/433D_Blank.pdf',
  'public/templates/433F_Blank.pdf',
  'public/templates/433H_Blank.pdf',
  'public/templates/656L_Blank.pdf'
]){
  must(fs.existsSync(asset),`Required central-family asset missing: ${asset}`)
}

must(quarantine.includes("status='cancelled'"),'Legacy Nashville central tenant must be disabled without deleting history')
must(quarantine.includes('as restrictive for all to anon, authenticated'),'Legacy tenant must have a restrictive RLS quarantine wall')
must(quarantine.includes('central_legacy_nashville_quarantine'),'Legacy quarantine policy must be installed on tenant tables')
must(quarantine.includes('financial_intake_save_unchecked'),'Financial-intake draft save must be guarded')
must(quarantine.includes('booking_create_unchecked'),'Public booking creation must be guarded')
must(quarantine.includes('booking_get_config_unchecked'),'Public booking config must be guarded')
must(quarantine.includes('booking_get_slots_unchecked'),'Public booking slots must be guarded')
must(quarantine.includes('emp_login_unchecked'),'Employee portal login must be guarded')
must(quarantine.includes('kiosk_login_unchecked'),'Kiosk login must be guarded')
must(quarantine.includes("'tenant_id',c.tenant_id::text"),'Manage-booking RPC must return tenant identity')
must(quarantine.includes('booking_note_and_rep(')&&quarantine.includes('r.tenant_id'),'Booking cancellation notification must keep tenant scope')
must(quarantine.includes('Tenant is not available for impersonation'),'Platform admin cannot jump into a cancelled/quarantined tenant')
must(quarantine.includes('get_branding_by_email_domain'),'Pre-login branding must be tenant-status guarded')
must(!quarantine.includes('delete from public.clients'),'Quarantine must preserve legacy client history')
must(!quarantine.includes('delete from public.payments'),'Quarantine must preserve legacy payment history')
must(!quarantine.includes('delete from public.cases'),'Quarantine must preserve legacy case history')
must(centralMetrics.includes('products":["tax_case_review","cloudcpa"]'),'Central family metrics must request TCR + CloudCPA only')
must(!centralMetrics.includes('products":["tax_case_review","nashville"'),'Central family metrics must not request Nashville')
must(!centralMetrics.includes('c_nash'),'Central family metrics must not define a Nashville tenant constant')
must(centralMetrics.includes('from public, anon'),'Central family metrics must revoke anonymous execution')
must(storageIsolation.includes('storage_object_tenants'),'Legacy storage objects must be mapped to tenant ownership')
must(storageIsolation.includes("split_part(name,'/',1) = public.current_tenant_id()::text"),'New storage objects must be tenant-prefixed')
must(storageIsolation.includes('documents_tenant_select'),'Documents bucket must use tenant-scoped policies')
must(storageIsolation.includes('training_recordings_tenant_select'),'Training recordings bucket must use tenant-scoped policies')
must(storageIsolation.includes('firm_assets_tenant_update'),'Firm asset writes must be tenant-scoped')
must(documentsPage.includes('${myTenantId}/docs/${ownerKey}'),'Documents page must tenant-prefix uploads')
must(clientsPage.includes('${myTenantId}/docs/${ownerKey}'),'Client page must tenant-prefix uploads')
must(screenShare.includes('${tenantId}/${filename}'),'Training recorder must tenant-prefix uploads')

for(const fn of retiredCentralFns){
  must(fn.includes('CENTRAL_TAXRES_NASHVILLE_RETIRED'),'Nashville-only central Edge Function source must stay retired')
  must(fn.includes("status: 410"),'Retired Nashville-only central Edge Function must fail closed')
  must(!fn.includes('SUPABASE_SERVICE_ROLE_KEY'),'Retired Nashville-only central Edge Function must not retain service-role runtime code')
}


const nashvilleSystemMail=read('supabase/functions/nashville-system-mail-relay/index.ts')
must(nashvilleSystemMail.includes("SECRET_KEY='nashville_system_mail_relay_v1'"),'Nashville system sender must require the dedicated bridge secret')
must(nashvilleSystemMail.includes("romylabs_stalwart_transport_for_product")&&nashvilleSystemMail.includes("p_product_key:'taxres_crm'"),'Nashville system sender may use only the TaxResCRM mail transport')
must(nashvilleSystemMail.includes("kind==='employee_access'")||nashvilleSystemMail.includes("kind==='employee_access'"),'Nashville system sender must explicitly gate employee access mail')
must(nashvilleSystemMail.includes("Nashville branding required")&&nashvilleSystemMail.includes("Foreign brand blocked"),'Nashville system sender must enforce Nashville-only message content')
must(!nashvilleSystemMail.includes("from('clients')")&&!nashvilleSystemMail.includes("from('employees')"),'TaxResCRM sender must not read Nashville client or employee data')

if(failures.length){
  failures.forEach(x=>console.error('CENTRAL FAMILY AUDIT FAIL:',x))
  process.exit(1)
}
console.log(`CENTRAL FAMILY AUDIT PASS: ${routes.length} module routes + branding/provider isolation checks`)
