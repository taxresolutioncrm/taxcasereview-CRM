import fs from 'node:fs'

const read = p => fs.readFileSync(p,'utf8')
const must = (ok,msg) => { if(!ok){ console.error('CLOUDCPA READINESS FAIL:',msg); process.exitCode=1 } else console.log('PASS',msg) }

const app = read('src/App.jsx')
const sidebar = read('src/components/layout/Sidebar.jsx')
const employees = read('src/pages/Employees.jsx')
const email = read('src/pages/Email.jsx')
const settings = read('src/pages/Settings.jsx')
const migration = read('supabase/migrations/20260918121000_cloudcpa_prospect_readiness.sql')
const bookingMigration = read('supabase/migrations/20260918122000_tenant_booking_branding.sql')

must(fs.existsSync('public/cloudcpa-logo.png'),'CloudCPA logo asset exists')
for (const route of ['/clients','/leads','/cases','/tasks','/calendar','/documents','/esign','/formacorp']) {
  must(app.includes(route) || sidebar.includes(route), `core CRM route present: ${route}`)
}
must(app.includes('Email') && email.includes("supabase"),'Email workspace is part of the shared tenant CRM')
must(app.includes('Dialer'),'Dialer is part of the shared tenant CRM')
must(app.includes('Fax') || sidebar.includes('/fax'),'Fax is part of the shared tenant CRM')
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
must(migration.includes("payment_provider = case"),'payment provider is only shown when real tenant credentials exist')
must(!migration.includes('insert into auth.users'),'migration does not fabricate or overwrite authentication credentials')
must(bookingMigration.includes("when coalesce(trim(v_firm_name),'') <> '' then '[' || trim(v_firm_name) || ']'"),'tenant bookings use the office identity instead of TaxRes CRM branding')

if(process.exitCode) process.exit(process.exitCode)
console.log('CLOUDCPA READINESS CERTIFICATION PASS')
