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
const quarantine=read('supabase/quarantine/central_legacy_nashville.sql')
const storageIsolation=read('supabase/quarantine/central_storage_isolation.sql')
const m365Sync=read('supabase/functions/m365-sync/index.ts')
const screenShare=read('src/context/ScreenShareContext.jsx')
const training=read('src/pages/Training.jsx')
const settingsPage=read('src/pages/Settings.jsx')
const esignArchive=read('supabase/functions/esign-archive-upload/index.ts')

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
must(storageIsolation.includes('central_document_storage_access'),'Private documents bucket must have tenant-aware object authorization')
must(storageIsolation.includes('as restrictive'),'Storage tenant guard must be restrictive, not another permissive policy')
must(storageIsolation.includes("bucket_id<>'documents'"),'Documents Storage guard must apply without breaking other buckets')
must(storageIsolation.includes("p_name like 'tenant/'||v_tenant::text||'/%'"),'New document paths must support explicit tenant prefixes')
must(storageIsolation.includes("p_name like 'portal/'||v_tenant::text||'/%'"),'Portal document paths must remain tenant-bound')
must(storageIsolation.includes("p_name like 'organizer/'||v_tenant::text||'/%'"),'Organizer document paths must remain tenant-bound')
must(storageIsolation.includes("p_name like 'tds-direct/'||v_tenant::text||'/%'"),'IRS transcript storage paths must remain tenant-bound')
must(storageIsolation.includes("v_tenant='61a89aef-0e7e-4ea2-b222-44ab2024655a'::uuid")&&storageIsolation.includes('p_owner_id is null')&&storageIsolation.includes("p_name like 'docs/%/signed/%'"),'Legacy ownerless signed-package compatibility must be TCR-only')
must(storageIsolation.includes('central_firm_asset_write_access'),'Firm-assets writes must be tenant-scoped')
must(storageIsolation.includes("p_name like 'logo-'||v_tenant::text||'.%'"),'Firm logo writes must use the current tenant id')
must(storageIsolation.includes("p_name like 'signature-logo-'||v_tenant::text||'.%'"),'Firm signature-logo writes must use the current tenant id')
must(storageIsolation.includes("p_name like 'signatures/'||v_tenant::text||'/%'"),'Employee signature assets must use a tenant folder')
must(storageIsolation.includes('central_training_storage_access'),'Training recordings must have tenant-scoped Storage authorization')
must(m365Sync.includes('Microsoft 365 sync is retired from the central TaxRes project.'),'Central M365 scheduler/browser path must die when the legacy tenant is quarantined')
must(m365Sync.includes(".eq('id', NASHVILLE_TENANT)"),'Central M365 kill switch must check the exact legacy Nashville tenant')
must(esignArchive.includes('tenant/${e.tenant_id}/esign/'),'Future signed e-sign archives must include tenant identity in their Storage path')
must(screenShare.includes('const path = `${tenantId}/${filename}`'),'New training recording uploads must use a tenant folder')
must(training.includes('.list(String(myTenantId)'),'Training recordings list must be tenant-folder scoped')
must(training.includes('`${myTenantId}/${name}`'),'Training recording read/delete paths must stay tenant scoped')
must(settingsPage.includes('const path = `logo-${tid}.${ext}`'),'Firm logo upload must never use a shared/default filename')
must(settingsPage.includes('const path = `signature-logo-${tid}.${ext}`'),'Firm signature logo must never use a shared/default filename')
must(settingsPage.includes('const path = `signatures/${tid}/'),'Personal signature images must use tenant-prefixed paths')

if(failures.length){
  failures.forEach(x=>console.error('CENTRAL FAMILY AUDIT FAIL:',x))
  process.exit(1)
}
console.log(`CENTRAL FAMILY AUDIT PASS: ${routes.length} module routes + branding/provider isolation checks`)
