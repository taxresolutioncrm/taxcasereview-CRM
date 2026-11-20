import fs from 'node:fs'
import assert from 'node:assert/strict'
import {transform} from 'esbuild'
const source=fs.readFileSync('supabase/functions/romylabs-first-day-office-reminders/index.ts','utf8')
const migration=fs.readFileSync('supabase/migrations/20261120090000_romylabs_first_day_office_payment_notices.sql','utf8')
await transform(source,{loader:'ts',target:'es2022'})
for(const [snippet,reason] of [
  ["clock.day!==1||clock.hour<9||clock.hour>=12",'Correct local first-day sending gate'],
  ["timeZone:'America/New_York'",'Eastern time zone'],
  ["verify_internal_cron_token",'Signed internal cron authorization'],
  ["romylabs_first_day_office_reminders",'Separate service-only first-day outbox'],
  ["a.id==='3aa7c0d0-3765-4e9c-9838-9e8efa6c4448'&&a.product_key==='taxres_crm'",'Chris must only use TaxRes sender'],
  ["a.id==='339710c8-4739-450f-bac8-540a3a325cec'&&a.product_key==='restore_relay'",'Calico must only use Restore Relay sender'],
  ["sendViaStalwart(db,a.product_key",'Never use one global sender for both offices'],
  ["romylabs_system_reminder_transport",'Sender must be selected and verified by product'],
  ["from.endsWith('@'+domain)",'Reject cross-product sender'],
  ["Cross-product sender or branding rejected",'Strong sender isolation'],
  ["TaxRes-only branding guard",'Reject RomyLabs/personal branding in TaxRes messages'],
  ["'Upcoming automatic subscription payment'",'Calico message must not falsely demand duplicate payment'],
  ["no new payment link is needed",'No duplicate Calico payment link'],
  ["credit-card surcharge",'ACH and credit-card-fee distinction'],
  ["chrisZelle= isChris && year<=2026",'Chris keeps Zelle-only instructions through December 2026'],
  ["isChris?'Friendly monthly reminder'",'Chris gets a courtesy reminder instead of a demand'],
  ["Please use the same payment arrangement as before.",'Chris retains existing Zelle payment arrangement'],
  ["This is only a courtesy reminder.",'Chris notice must be friendly'],
  ["firstDayMessage(brand,a.account_name,monthLabel,Number(a.monthly_amount_cents),isAuto,Number(a.billing_day||19),clock.year)",'January 2027 change determined by local billing year'],
  ["Payment options &amp; processing fees",'Branded payment options box required'],
  ["ACH / Bank Transfer:", 'ACH must be clearly identified'],
  ["No additional card-processing fee.", 'Fee-free ACH must be disclosed'],
  ["Debit and prepaid cards are not subject", 'No debit surcharge allowed'],
  ["No action or additional payment is required", 'Automatic Calico reminder must not demand a duplicate payment'],
  ["status:'sent'",'Record successful send only after mail server accepts submission'],
  ["status:'pending',last_error:",'Failed delivery must be retried'],
  ["(invoices||[]).some",'Avoid reminding Chris after paid invoice']
])assert(source.includes(snippet),reason)
for(const [snippet,reason] of [
  ['unique(account_id,period_month)','One reminder per office/month'],
  ['enable row level security','Outbox protected by RLS'],
  ['revoke all on public.romylabs_first_day_office_reminders from public,anon,authenticated','No browser outbox access'],
  ["'*/15 13-16 1 * *'",'First day timezone retry cadence'],
  ["'tcr_internal_cron_token'",'Existing protected Vault token'],
  ['romylabs-first-day-office-reminders','New cron endpoint']
])assert(migration.includes(snippet),reason)
assert(!source.includes('api.brevo.com'),'No Brevo fallback')
assert(!source.includes('sk_live_'),'No Stripe secret')
console.log('PASS first-day branded SaaS payment notices, protected outbox, and no duplicate Calico charge')
