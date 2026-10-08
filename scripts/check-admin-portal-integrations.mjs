import fs from 'node:fs'

const read=(p)=>fs.readFileSync(p,'utf8')
const admin=read('src/pages/AdminPortal.jsx')
const billing=read('src/components/admin/RomyLabsBilling.jsx')
const hub=read('supabase/functions/hub-proxy/index.ts')
const metricsSignal=read('supabase/functions/metrics-signal/index.ts')
const realtimeMetricsMigration=read('supabase/migrations/romylabs_admin_metrics_realtime.sql')
const content=read('supabase/functions/content-generator/index.ts')
const publish=read('supabase/functions/linkedin-publish/index.ts')
const scheduler=read('supabase/functions/linkedin-scheduler/index.ts')
const replenisher=read('supabase/functions/linkedin-queue-replenisher/index.ts')
const bing=read('supabase/functions/bing-data/index.ts')
const migration=read('supabase/migrations/20261007_linkedin_autopilot_regression_repair.sql')
const autopilotMigration=read('supabase/migrations/20261007_linkedin_hourly_queue_autopilot.sql')
const taxresCadenceMigration=read('supabase/migrations/20261008_restore_taxres_linkedin_tue_thu.sql')

const checks=[
  ['portfolio uses live metrics batch',admin.includes("action:'metrics_batch'")&&admin.includes('portfolioCrmStatus')],
  ['portfolio no longer counts static connection labels',!admin.includes("const connectedN = products.filter(p => p.connection === 'connected').length")],
  ['products tab derives connection state from live metrics',admin.includes('function connectionFor(p)')&&admin.includes('productMetricsKey')&&!admin.includes("selected.connection === 'partial'")&&!admin.includes("selected.connection === 'not_connected'")],
  ['stale metrics deploy instructions removed',!admin.includes('metrics deploy pending')&&!admin.includes('push-platform-metrics')&&!admin.includes('Deploy the platform-metrics edge function')],
  ['stale historical blockers removed',!admin.includes('arcvena.com DNS cutover not complete')&&!admin.includes('GH Actions minutes exhausted')],
  ['content center supports browser preflight',content.includes("req.method==='OPTIONS'")&&content.includes('x-force-regenerate')],
  ['hub refreshes Camvella server-to-server',hub.includes("camvella: 'CAMVELLA_SUPPORT_SECRET'")&&hub.includes("x-romylabs-support-secret")],
  ['hub refreshes BocaSync server-to-server',!hub.includes("BocaSync metrics require an authenticated RomyLabs admin session")&&hub.includes("productHeaders['x-hub-secret'] = hubSecret")],
  ['hub uses product support credentials',hub.includes("groundivo: 'GROUNDIVO_SUPPORT_SECRET'")&&hub.includes("oculivo: 'OCULIVO_SUPPORT_SECRET'")&&hub.includes("restore_relay: 'RESTORE_RELAY_SUPPORT_SECRET'")&&hub.includes("x-romylabs-support-secret")],
  ['hub keeps Arcvena server-side credential path',hub.includes("arcvena: 'ARCVENA_SUPPORT_SECRET'")&&hub.includes("x-arcvena-support-secret")],
  ['Admin Portal subscribes to live metrics cache',admin.includes("channel('romylabs-admin-metrics-live')")&&admin.includes("table:'romylabs_metrics_cache'")&&admin.includes('liveMetricsVersion')],
  ['Billing subscribes to live metrics cache',billing.includes("channel('romylabs-billing-live')")&&billing.includes("table:'romylabs_metrics_cache'")],
  ['hub supports generic cache refresh and recovery',hub.includes("refresh_product_metrics")&&hub.includes("refresh_stale_metrics")&&hub.includes('refreshProductCache')&&hub.includes('EdgeRuntime.waitUntil')],
  ['metrics signal is invalidation-only and rate limited',metricsSignal.includes("claim_romylabs_metrics_refresh")&&metricsSignal.includes("romylabs_metrics_signal_queue")&&!metricsSignal.includes("record")&&!metricsSignal.includes("old_record")],
  ['realtime metrics migration protects cache and publishes it',realtimeMetricsMigration.includes('romylabs_metrics_cache_platform_admin_read')&&realtimeMetricsMigration.includes('alter publication supabase_realtime add table public.romylabs_metrics_cache')],
  ['realtime metrics migration uses async pg_net signals',realtimeMetricsMigration.includes("functions/v1/metrics-signal")&&realtimeMetricsMigration.includes('net.http_post')&&realtimeMetricsMigration.includes("for each statement")],
  ['realtime metrics migration uses valid PL/pgSQL delimiters',realtimeMetricsMigration.includes("create or replace function public.romylabs_dispatch_metrics_signal()\nreturns trigger\nlanguage plpgsql\nsecurity definer\nset search_path = public, pg_catalog\nas $$")&&!realtimeMetricsMigration.includes("\nas $\nbegin")],

  ['product cards never bypass hub proxy',!admin.includes("['camvella', 'arcvena'].includes(product.key)")&&!admin.includes("'apikey':        'eyJ")],
  ['LinkedIn scopes keep TaxRes member publishing and Arcvena organization publishing',admin.includes("selectedPid === 'arcvena'")&&admin.includes("'openid profile w_organization_social'")&&admin.includes("'openid profile w_member_social'")],
  ['LinkedIn UI requires company page only for Arcvena',admin.includes("const companyPageRequired = selectedPid === 'arcvena'")&&admin.includes('companyPageReady')],
  ['publisher requires organization target only for Arcvena',publish.includes("const ORG_PRODUCTS = new Set(['arcvena'])")&&publish.includes("required_scope: 'w_organization_social'")],
  ['scheduler preserves TaxRes target and Arcvena company-page gate',scheduler.includes('taxres_publish_target_not_verified')&&scheduler.includes('arcvena_company_page_target_not_verified')&&scheduler.includes('verify_internal_cron_token')],
  ['legacy TaxRes replenisher accepts member or organization target',replenisher.includes('publishTargetReady')&&replenisher.includes("targetType==='PERSON'")&&replenisher.includes('publish_target_not_ready')],
  ['database publisher is product scoped',migration.includes("v_post.product_id='arcvena'")&&migration.includes("elsif nullif(v_conn.linkedin_person_id,'') is not null")],
  ['database publisher supports organization and person authors',migration.includes("'urn:li:organization:'||v_conn.linkedin_organization_id")&&migration.includes("'urn:li:person:'||v_conn.linkedin_person_id")],
  ['TaxRes LinkedIn queue no longer has duplicate hourly/daily generators',taxresCadenceMigration.includes("'linkedin-taxres-queue-autopilot'")&&taxresCadenceMigration.includes("'linkedin-queue-replenishment-supabase'")],
  ['TaxRes LinkedIn publishes only Tue/Thu 9 AM ET with no stale catch-up',taxresCadenceMigration.includes("extract(isodow from scheduled_at at time zone 'America/New_York') in (2,4)")&&taxresCadenceMigration.includes("extract(hour from scheduled_at at time zone 'America/New_York') = 9")&&taxresCadenceMigration.includes("scheduled_at >= now() - interval '2 hours'")],
  ['Monday scheduler remains the sole TaxRes generator path',scheduler.includes("clock.day==='Mon'&&clock.hour===7")&&scheduler.includes("action==='generate_monday_drafts'||action==='generate_content'")],
  ['Bing state comes from Bing verification',bing.includes('GetUserSites')&&bing.includes('VerifySite')&&bing.includes("status:'configured'")&&bing.includes('last_verified_at')],
]
let failed=0
for(const [label,ok] of checks){console.log(`${ok?'PASS':'FAIL'}  ${label}`);if(!ok)failed++}
if(failed) process.exit(1)
console.log(`Admin Portal integration gate PASS: ${checks.length}/${checks.length}`)
