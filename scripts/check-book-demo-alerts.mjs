// Lightweight non-mutating regression gate for every central RomyLabs Book Demo route.
// Run: node scripts/check-book-demo-alerts.mjs
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const read=p=>readFileSync(p,'utf8')
const cfg=read('src/lib/productBookingConfig.js')
const book=read('src/pages/BookAppointment.jsx')
const mail=read('supabase/functions/send-email/index.ts')
const alert=read('src/components/AdminBookingAlerts.jsx')
const shell=read('src/pages/AdminPortal.jsx')
const migration=read('supabase/migrations/20261030183000_romylabs_durable_booking_alerts.sql')
const brand=read('supabase/migrations/20261030183500_fix_central_demo_branding.sql')
const keys=['taxres_crm','romylabs','camvella','arcvena','bocasync','oculivo','groundivo','restore_relay','pool_crm','barbers_salons','health_insurance']
for (const key of keys) {
  assert.match(cfg,new RegExp('\\b'+key+':\\s*\\{'),'Missing booking config: '+key)
  assert.match(brand,new RegExp(key==='taxres_crm'?'\\[TaxRes CRM\\]':key==='restore_relay'?'\\[Restore Relay\\]':key==='romylabs'?'\\[RomyLabs\\]':key==='camvella'?'\\[Camvella\\]':key==='arcvena'?'\\[Arcvena\\]':key==='bocasync'?'\\[BocaSync\\]':key==='oculivo'?'\\[Oculivo\\]' :key==='groundivo'?'\\[GroundIVO\\]':key==='pool_crm'?'\\[PoolVerge\\]':key==='barbers_salons'?'\\[Barbers & Salons CRM\\]':'\\[Health Insurance Agency CRM\\]'),'Missing calendar brand: '+key)
}
assert.ok(book.includes("booking_create_product"),'booking writes must persist product identity')
assert.ok(book.includes("booking_firm_notification"),'firm notification must be requested')
assert.ok(book.includes("booking_confirmation"),'client confirmation must be requested')
assert.ok(cfg.includes("productParam === 'aquagrid'"),'Legacy PoolVerge alias missing')
assert.ok(mail.includes("booking_token"),'mail must validate booking token')
assert.ok(mail.includes("romylabs_stalwart_transport_for_product"),'Internal bookings must use RomyLabs Stalwart')
assert.ok(mail.includes("notification_submission_id"),'Stalwart submission must be auditable')
assert.ok(mail.includes("camvella: { name: 'Camvella', email: 'romy@camvella.com' }"),'Camvella booking mailbox routing must not regress')
assert.ok(migration.includes("after insert or update of product_id,status"),'durable booking trigger missing')
assert.ok(migration.includes("on conflict (booking_id) do nothing"),'idempotent recent booking backfill missing')
assert.ok(alert.includes("acknowledged_at"),'in-app review state missing')
assert.ok(shell.includes('<AdminBookingAlerts />'),'Admin Portal booking alerts not mounted')
console.log('PASS — 11 central booking products, labels, mail invocation, durable alerts and Admin Portal visibility')
