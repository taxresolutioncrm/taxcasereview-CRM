const fs = require('fs')

const files = {
  page: fs.readFileSync('src/pages/FormaCorp.jsx','utf8'),
  lifecycle: fs.readFileSync('src/components/formacorp/FormaCorpLifecycle.jsx','utf8'),
  adapter: fs.readFileSync('supabase/functions/formacorp-bizee/index.ts','utf8'),
  webhook: fs.readFileSync('supabase/functions/formacorp-bizee-webhook/index.ts','utf8'),
  migration: fs.readFileSync('supabase/migrations/20260918225500_formacorp_bizee_partner_contract.sql','utf8'),
  config: fs.readFileSync('supabase/config.toml','utf8'),
}

const all = Object.values(files).join('\n')
const failures = []
const reject = (ok,msg) => { if (!ok) failures.push(msg) }

reject(!/https:\/\/(?:orders\.)?bizee\.com/i.test(all), 'External Bizee browser URL must not be hardcoded in FormaCorp integration')
reject(!/Open Bizee Secure Window|popup=yes|formacorp_bizee_pro/i.test(all), 'External Bizee popup workflow must not return')
reject(!/<iframe[^>]*bizee/i.test(all), 'Bizee iframe workflow must not return')
reject(!/service_fee\s*:\s*99/.test(all), 'Hardcoded $99 CRM service fee must not return')
reject(!/zapier|make\.com|browserless|proxycurl/i.test(all), 'Paid middleware/connector detected in Bizee integration')
reject(!/data\?\.(order_id|orderId|status)|body\?\.(order_id|orderId|status|event_id|type)/.test(files.adapter + files.webhook), 'Undocumented Bizee response/webhook field assumption detected')

for (const marker of [
  'BIZEE_PARTNER_NO_ADDITIONAL_API_FEE_CONFIRMED',
  'BIZEE_PARTNER_CREATE_FIELD_MAP_JSON',
  'BIZEE_PARTNER_STATUS_MAP_JSON',
  'BIZEE_PARTNER_DOCUMENTS_ARRAY_FIELD',
  'BIZEE_PARTNER_TENANT_TOKENS_JSON',
]) reject(files.adapter.includes(marker), 'Missing adapter readiness marker: '+marker)

for (const marker of [
  'BIZEE_PARTNER_WEBHOOK_SECRET_HEADER',
  'BIZEE_PARTNER_WEBHOOK_ORDER_ID_FIELD',
  'BIZEE_PARTNER_WEBHOOK_EVENT_ID_FIELD',
  'BIZEE_PARTNER_TENANT_WEBHOOK_SECRETS_JSON',
]) reject(files.webhook.includes(marker), 'Missing webhook readiness marker: '+marker)

reject(files.config.includes('[functions.formacorp-bizee]') && files.config.includes('[functions.formacorp-bizee-webhook]'), 'Missing Bizee edge-function auth configuration')
reject(/verify_jwt\s*=\s*true/.test(files.config.slice(files.config.indexOf('[functions.formacorp-bizee]'))), 'Staff Bizee adapter must require JWT')
reject(files.migration.includes('tenant_scoped_formacorp_provider_events'), 'Missing tenant-scoped provider-event RLS policy')
reject(files.migration.includes('uq_formacorp_documents_tenant_provider_document'), 'Missing tenant-scoped provider-document idempotency')
reject(files.migration.includes('uq_formacorp_provider_events_tenant_event'), 'Missing tenant-scoped provider-event idempotency')

if (failures.length) {
  console.error('FormaCorp Bizee invariant check FAILED:')
  for (const f of failures) console.error(' - '+f)
  process.exit(1)
}
console.log('FormaCorp Bizee invariant check PASS')
