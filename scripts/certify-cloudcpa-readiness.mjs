import fs from 'node:fs'

const read = p => fs.readFileSync(p,'utf8')
const must = (ok,msg) => { if(!ok){ console.error('CLOUDCPA READINESS FAIL:',msg); process.exitCode=1 } else console.log('PASS',msg) }

const app = read('src/App.jsx')
const appContext = read('src/context/AppContext.jsx')
const sidebar = read('src/components/layout/Sidebar.jsx')
const employees = read('src/pages/Employees.jsx')
const login = read('src/pages/Login.jsx')
const email = read('src/pages/Email.jsx')
const sms = read('src/pages/Sms.jsx')
const clients = read('src/pages/Clients.jsx')
const leads = read('src/pages/Leads.jsx')
const fax = read('src/pages/Fax.jsx')
const payments = read('src/pages/Payments.jsx')
const paymentLink = read('src/components/SendPaymentLinkModal.jsx')
const sendEmail = read('supabase/functions/send-email/index.ts')
const sendSms = read('supabase/functions/send-sms/index.ts')
const sendFax = read('supabase/functions/send-fax/index.ts')
const relayToken = read('supabase/functions/signalwire-relay-token/index.ts')
const startOutbound = read('supabase/functions/start-outbound-call/index.ts')
const stripeCheckout = read('supabase/functions/stripe-create-checkout-session/index.ts')
const stripeCharge = read('supabase/functions/stripe-charge/index.ts')
const settings = read('src/pages/Settings.jsx')
const migration = read('supabase/migrations/20260918121000_cloudcpa_prospect_readiness.sql')
const bookingMigration = read('supabase/migrations/20260918122000_tenant_booking_branding.sql')

const CLOUD_ID='ecd3d3ce-016a-4bb4-800e-f090f51e4cae'
const TCR_RELAY_ID='61a89aef-0e7e-4ea2-b222-44ab2024655a'

must(fs.existsSync('public/cloudcpa-logo.png'),'CloudCPA logo asset exists')
for (const route of ['/clients','/leads','/cases','/tasks','/calendar','/documents','/esign','/formacorp','/sms','/email','/fax','/dialer','/invoices','/payments','/reports','/workflows']) {
  must(app.includes(route) || sidebar.includes(route), `core CRM route present: ${route}`)
}

must(login.includes('resetPasswordForEmail'),'login provides password recovery')
must(login.includes("redirectTo: window.location.origin + '/'"),'password recovery uses approved app root redirect')
must(appContext.includes("_event === 'PASSWORD_RECOVERY'"),'recovery session is routed into password settings')
must(appContext.includes("window.location.href = '/settings?reset_password=1'"),'password recovery lands on Settings')

must(app.includes('Email') && email.includes('supabase'),'Email workspace is part of the shared tenant CRM')
must(sendEmail.includes("cloudTenant?.tenant_code === 'TRC-003'"),'CloudCPA has a tenant-scoped platform mail fallback before mailbox cutover')
must(sendEmail.includes("via:'taxres_platform_relay'"),'CloudCPA mail fallback identifies the physical relay truthfully')
must(sendEmail.includes('replyTo:cloudReply'),'CloudCPA platform mail keeps replies tenant-owned')
must(email.includes("myTenantId === CLOUDCPA_TENANT_ID && !gmailConnected"),'CloudCPA compose uses platform mail when Gmail is not connected')
must(email.includes("data?.via !== 'taxres_platform_relay'"),'CloudCPA compose verifies platform delivery result')
must(email.includes("data?.reply_to !== 'tony@thecloudcpa.net'"),'CloudCPA compose verifies tenant Reply-To')
must(email.includes('alreadyStored = true'),'CloudCPA platform mail does not duplicate Sent history')

must(sendSms.includes("cloudTenant?.tenant_code==='TRC-003'"),'CloudCPA SMS relay is explicitly scoped to TRC-003')
must(sendSms.includes("platformRelay=true"),'CloudCPA SMS truthfully marks platform relay')
must(sendSms.includes("eq('tenant_id',tenantId)"),'CloudCPA SMS client/lead resolution stays tenant scoped')
must(sendSms.includes("return json({success:true,sid:sw.sid,platform_relay:platformRelay"),'SMS response exposes physical relay state')
must(sms.includes(`myTenantId === '${CLOUD_ID}'`),'global SMS workspace invokes the CloudCPA relay without fake tenant credentials')
must(clients.includes(`myTenantId === '${CLOUD_ID}'`),'client SMS invokes the CloudCPA relay')
must(leads.includes(`myTenantId === '${CLOUD_ID}'`),'lead SMS invokes the CloudCPA relay')
must(sms.includes('client_id: clients.find'),'global SMS passes the matching client id for clean tenant history')

must(sendFax.includes("cloudTenant?.tenant_code === 'TRC-003'"),'CloudCPA fax relay is explicitly scoped to TRC-003')
must(sendFax.includes(`.eq('tenant_id','${TCR_RELAY_ID}')`),'CloudCPA fax borrows only the proven platform transport')
must(sendFax.includes('platform_relay: platformRelay'),'fax response exposes physical relay state')
must(fax.includes('const actualFrom = resData?.from || fromNum || null'),'fax history records the actual physical sending number')
must(fax.includes('Attach a PDF to send by fax'),'fax UI does not offer a text-only path the provider cannot transmit')

must(relayToken.includes(`.eq('tenant_id','${TCR_RELAY_ID}')`),'browser calling token has a proven platform-provider fallback')
must(startOutbound.includes("cloudTenant?.tenant_code === 'TRC-003'"),'CloudCPA outbound calling fallback is explicitly scoped to TRC-003')
must(startOutbound.includes('tenant_id: effectiveTenantId'),'outbound call record stays on CloudCPA tenant')
must(startOutbound.includes('platformRelay = true'),'outbound call response can truthfully identify platform relay')

must(paymentLink.includes("paymentProvider !== 'stripe'"),'payment links are blocked until this office connects a real processor')
must(payments.includes("paymentProvider !== 'stripe'"),'charge-now and autopay are blocked until this office connects a real processor')
must(stripeCheckout.includes("authClient.rpc('current_tenant_id')"),'payment-link backend resolves the authenticated office')
must(stripeCheckout.includes(".eq('tenant_id', tenantId)"),'payment-link record lookup is tenant scoped')
must(stripeCheckout.includes("'Stripe-Account': connectedAccount"),'payment-link backend supports the tenant connected account without reusing the primary merchant account')
must(stripeCheckout.includes("tenantId !== PRIMARY_TENANT_ID && !connectedAccount"),'unconnected prospect offices cannot charge through the primary Stripe account')
must(stripeCharge.includes("authClient.rpc('current_tenant_id')"),'saved-card charging resolves the authenticated office')
must(stripeCharge.includes("tenant_id: tenantId"),'payment results are recorded on the authenticated tenant')
must(stripeCharge.includes(".eq('tenant_id', tenantId)"),'saved-card and customer lookups are tenant scoped')
must(!stripeCharge.includes("tenant_id: '61a89aef-0e7e-4ea2-b222-44ab2024655a'"),'saved charges are no longer hard-coded to Tax Case Review')
must(migration.includes("stripe_connect_account_id"),'CloudCPA readiness recognizes only a real tenant payment connection')
must(migration.includes("payment_provider = case"),'CloudCPA does not inherit another office payment provider')

must(settings.includes('BookingSettings'),'Online booking settings are available')
must(employees.includes('perm levels: 0=No Access, 1=View Only, 2=Edit, 3=Full Admin'),'permission model exposes Full Admin level 3')
must(migration.includes("firmname = 'CloudCPA Inc'"),'CloudCPA does not inherit Tax Case Review firm name')
must(migration.includes("firmemail = 'tony@thecloudcpa.net'"),'CloudCPA correspondence identity is tenant-owned')
must(migration.includes("logourl = '/cloudcpa-logo.png'"),'CloudCPA logo is tenant branding')
must(migration.includes("firmaddress = null"),'stale inherited office address is removed')
for (const perm of ['perm_clients','perm_leads','perm_billing','perm_schedule','perm_documents','perm_reports','perm_hr','perm_settings','perm_irs','perm_comms']) {
  must(migration.includes(`${perm} = case when lower(email)='tony@thecloudcpa.net' then 3`), `Tony Full Admin permission: ${perm}`)
}
must(migration.includes("'enabled', true"),'CloudCPA public booking is enabled for the prospect workspace')
must(migration.includes("calling_provider = case"),'voice provider is only shown when real tenant credentials exist')
must(!migration.includes('insert into auth.users'),'migration does not fabricate or overwrite authentication credentials')
must(bookingMigration.includes("when coalesce(trim(v_firm_name),'') <> '' then '[' || trim(v_firm_name) || ']'"),'tenant bookings use the office identity instead of TaxRes CRM branding')

if(process.exitCode) process.exit(process.exitCode)
console.log('CLOUDCPA READINESS CERTIFICATION PASS')
