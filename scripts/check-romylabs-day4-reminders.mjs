import fs from 'node:fs'
import assert from 'node:assert/strict'
import { transform } from 'esbuild'

const code = fs.readFileSync('supabase/functions/romylabs-day4-payment-reminders/index.ts', 'utf8')
const migration = fs.readFileSync('supabase/migrations/20261103220000_romylabs_day4_office_payment_reminders.sql','utf8')
await transform(code, { loader:'ts', target:'es2022' })
assert(code.includes("clock.day!==4||clock.hour<9||clock.hour>=12"), 'Fourth-of-month morning gate missing')
assert(code.includes("timeZone:'America/New_York'"), 'Eastern time zone missing')
assert(code.includes("verify_internal_cron_token"), 'Server-side cron auth missing')
assert(code.includes("romylabs_billing_accounts"), 'Must use central SaaS accounts')
assert(!code.includes('account.billing_day')&&!code.includes('account.auto_invoice'), 'All paying offices must be eligible regardless of invoicing mode')
assert(code.includes("romylabs_subscription_payments"), 'Must check actual received office payments')
assert(code.includes("romylabs_invoices"), 'Must check settled invoice status')
assert(code.includes("romylabs_day4_payment_reminders"), 'Idempotency outbox missing')
assert(code.includes("sameMonth("), 'Must check payment month')
assert(code.includes("paidNow>=account.monthly_amount_cents"), 'Must re-check payment before sending')
assert(code.includes("sendViaStalwart"), 'Must use Stalwart transport')
assert(code.includes("romylabs_system_reminder_transport"), 'Must resolve a private sender per product')
assert(code.includes('renderBrandedPaymentReminder('), 'CRM branded email template missing')
assert(code.includes("const logo='cid:'+EMAIL_LOGO_CID"), 'Official logo must be CID-embedded, not hotlinked')
assert(code.includes('rawLogo[0]===137')&&code.includes('rawLogo[7]===10'), 'Official PNG magic verification missing')
assert(code.includes('session.uploadUrl'), 'JMAP MIME upload required')
assert(code.includes("'Content-Type: multipart/related; boundary="), 'MIME HTML and logo must be multipart/related')
assert(code.includes("'Content-Disposition: inline; filename="), 'Inline MIME logo required')
assert(code.includes("['Email/import'"), 'Must import prebuilt MIME to avoid Stalwart inline attachment bug')
assert(code.includes("'Content-Type':'message/rfc822'"), 'Must upload a raw MIME message')
assert(code.includes("'Content-ID: <'+EMAIL_LOGO_CID+'>'"), 'Inline logo must use matching Content-ID')
assert(code.includes("if(!isPng||rawLogo.byteLength>2*1024*1024)"), 'Invalid or huge logos must block email')
assert(code.includes("Personal mailbox cannot send system reminders"), 'Send must reject personal sender')
assert(code.includes('#d8eaff'), 'Approved pale blue balance treatment missing')
assert(code.includes('font-weight:800;color:#101c32 !important'), 'Approved dark bold heading missing')
assert(!code.includes("const logo=escapeHtml(brand.logoUrl)"), 'Remote linked logos must not render directly in email')

assert(code.includes('BRAND_LOGO_FILES'), 'Published product logo registry missing')
// Every product logo must be a real, product-specific asset committed to this repository.
// Never allow a generated stand-in or another CRM's logo to pass certification.
const officialAssets = {
  taxres_crm:'taxrescrm-logo.png',
  arcvena:'arcvena-logo.png',
  bocasync:'bocasync-logo.svg',
  camvella:'camvella-logo.svg',
  restore_relay:'restore-relay-logo.svg',
  romylabs:'romylabs-logo.png',
  oculivo:'oculivo-logo.svg',
  groundivo:'groundivo-logo.svg',
}
for(const [product,file] of Object.entries(officialAssets)){
  assert(fs.existsSync('public/'+file), 'Official CRM logo asset missing: '+product+' '+file)
  assert(code.includes(product+":'"+file+"'"), 'Wrong branded logo mapping: '+product)
}
assert(!code.includes('placeholder-logo'), 'Placeholder logos are prohibited')

for(const key of ['taxres_crm','arcvena','bocasync','camvella','restore_relay','romylabs','oculivo','groundivo']){
  assert(code.includes(key+" :" ) || code.includes(key+":'"), 'Brand asset missing for '+key)
}
assert(code.includes('romylabs_products'), 'Per-CRM registry branding lookup missing')
assert(code.includes('missing_branded_email_assets'), 'Unbranded products must be blocked')
assert(code.includes('brandFor(account.product_key,product)'), 'Brand must match account product')
assert(code.includes('alt="\'+name+\' logo'), 'Accessible logo required in email')
assert(code.includes('REMAINING BALANCE'), 'Balance card missing')
assert(code.includes('automated billing reminder'), 'Automated reminder footer missing')
assert(code.includes('Please arrange payment through your existing payment method'), 'Must preserve off-platform payment arrangement')
assert(!code.includes('romy@'), 'Do not expose personal mail identities in branded email')

assert(code.includes("p_product_key:productKey"), 'Must pass office product key, not a fixed product')
assert(code.includes("'From: \"'+header(brand)+' System Reminder\" <'+from+'>'"), 'Must brand RFC822 sender by CRM')
assert(code.includes("product_key"), 'Must query office product')
assert(code.includes("unregistered_product_sender"), 'Must fail closed for unregistered products')
assert(!code.includes("p_product_key:'taxres_crm'")&&!code.includes("p_product_key:'romylabs'"), 'No fixed sender')
const privateSql=fs.readFileSync('supabase/migrations/20261103233000_private_product_office_payment_sender.sql','utf8')
assert(privateSql.includes("romylabs_system_reminder_transport"), 'Dedicated resolver missing')
assert(privateSql.includes("revoke all on function public.romylabs_system_reminder_transport(text) from public,anon,authenticated"), 'Resolver must be server-only')
assert(privateSql.includes("private_sender_unavailable"), 'Private sender must fail closed')
assert(privateSql.includes("'info@taxrescrm.net','taxres_crm'"), 'Register TaxRes nonpersonal mailbox')
assert(privateSql.includes("'info@poolverge.com','pool_crm'"), 'Register verified PoolVerge nonpersonal sender')
assert(privateSql.includes("from_address',v_sender"), 'Return selected nonpersonal address')
assert(privateSql.includes("lower(trim(m.outbound_from))=lower(trim(c.username))"), 'Sender must match a product mailbox')
assert(privateSql.includes("^(info|support|billing|notifications|no-reply|noreply|system|reminders)@"), 'Reject personal sender names')
assert(!code.includes('BREVO_API_KEY')&&!code.includes('api.brevo.com'),'No external Brevo provider')
assert(!code.includes('suspension_pending')&&!code.includes('auto_suspend'),'Early reminder cannot suspend office')
assert(migration.includes('unique(account_id,period_month)'), 'Per-account per-month uniqueness missing')
assert(migration.includes('romylabs-office-day4-payment-reminders'), 'Named cron missing')
assert(migration.includes("'tcr_internal_cron_token'"), 'Existing Vault cron token not used')
assert(migration.includes("*/15 13-16 4 * *"), 'Fourth-day retry window missing')
console.log('PASS RomyLabs office reminder: Edge TypeScript syntax, time zone, auth, Stalwart, payment guards, uniqueness, cron')
