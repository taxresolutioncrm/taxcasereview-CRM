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

if(failures.length){
  failures.forEach(x=>console.error('CENTRAL FAMILY AUDIT FAIL:',x))
  process.exit(1)
}
console.log(`CENTRAL FAMILY AUDIT PASS: ${routes.length} module routes + branding/provider isolation checks`)
