import fs from 'node:fs'

const read=(p)=>fs.readFileSync(p,'utf8')
const admin=read('src/pages/AdminPortal.jsx')
const hub=read('supabase/functions/hub-proxy/index.ts')
const content=read('supabase/functions/content-generator/index.ts')
const publish=read('supabase/functions/linkedin-publish/index.ts')
const scheduler=read('supabase/functions/linkedin-scheduler/index.ts')
const replenisher=read('supabase/functions/linkedin-queue-replenisher/index.ts')
const bing=read('supabase/functions/bing-data/index.ts')
const migration=read('supabase/migrations/20260929192500_linkedin_company_page_publish_targets.sql')
const autopilotMigration=read('supabase/migrations/20260929204000_linkedin_autopilot_product_scheduler.sql')

const checks=[
  ['portfolio uses live metrics batch',admin.includes("action:'metrics_batch'")&&admin.includes('portfolioCrmStatus')],
  ['portfolio no longer counts static connection labels',!admin.includes("const connectedN = products.filter(p => p.connection === 'connected').length")],
  ['products tab derives connection state from live metrics',admin.includes('function connectionFor(p)')&&admin.includes('productMetricsKey')&&!admin.includes("selected.connection === 'partial'")&&!admin.includes("selected.connection === 'not_connected'")],
  ['stale metrics deploy instructions removed',!admin.includes('metrics deploy pending')&&!admin.includes('push-platform-metrics')&&!admin.includes('Deploy the platform-metrics edge function')],
  ['stale historical blockers removed',!admin.includes('arcvena.com DNS cutover not complete')&&!admin.includes('GH Actions minutes exhausted')],
  ['content center supports browser preflight',content.includes("req.method==='OPTIONS'")&&content.includes('x-force-regenerate')],
  ['hub forwards central admin session to Camvella',hub.includes("productKey === 'camvella'")&&hub.includes("productHeaders['Authorization'] = \`Bearer \${jwt}\`")],
  ['hub uses BocaSync hub credential',hub.includes("productKey === 'bocasync'")&&hub.includes("productHeaders['x-hub-secret'] = hubSecret")],
  ['hub uses product support credentials',hub.includes("groundivo: 'GROUNDIVO_SUPPORT_SECRET'")&&hub.includes("oculivo: 'OCULIVO_SUPPORT_SECRET'")&&hub.includes("restore_relay: 'RESTORE_RELAY_SUPPORT_SECRET'")&&hub.includes("x-romylabs-support-secret")],
  ['hub keeps Arcvena server-side credential path',hub.includes("arcvena: 'ARCVENA_SUPPORT_SECRET'")&&hub.includes("x-arcvena-support-secret")],
  ['product cards never bypass hub proxy',!admin.includes("['camvella', 'arcvena'].includes(product.key)")&&!admin.includes("'apikey':        'eyJ")],
  ['TaxRes and Arcvena request LinkedIn organization scope',admin.includes("['taxres_crm','arcvena'].includes(selectedPid)")&&admin.includes('w_organization_social r_organization_admin')],
  ['LinkedIn UI blocks autopilot without company page',admin.includes('companyPageReady')&&admin.includes('Reconnect Company Page')&&admin.includes('Wrong Publish Target')],
  ['publisher refuses personal fallback',publish.includes('Company-page publishing is required')&&publish.includes('resolveOrganization')],
  ['scheduler requires company-page target',scheduler.includes('company_page_target_not_verified')&&scheduler.includes('verify_internal_cron_token')&&scheduler.includes("error:'Unauthorized'")],
  ['legacy replenisher requires autopilot and company page',replenisher.includes('autopilot_disabled')&&replenisher.includes('company_page_not_ready')&&replenisher.includes('product_id:PRODUCT')],
  ['database publisher is product scoped',migration.includes('product_id = v_post.product_id')&&migration.includes("v_post.product_id in ('taxres_crm','arcvena')")],
  ['database publisher uses organization author',migration.includes("'urn:li:organization:' || v_conn.linkedin_organization_id")],
  ['autopilot is database scheduled without Actions',autopilotMigration.includes("'linkedin-autopilot-run'")&&autopilotMigration.includes("'7 * * * *'")&&autopilotMigration.includes("'tcr_internal_cron_token'")],
  ['Bing state comes from Bing verification',bing.includes('GetUserSites')&&bing.includes('VerifySite')&&bing.includes("status:'configured'")&&bing.includes('last_verified_at')],
]
let failed=0
for(const [label,ok] of checks){console.log(`${ok?'PASS':'FAIL'}  ${label}`);if(!ok)failed++}
if(failed) process.exit(1)
console.log(`Admin Portal integration gate PASS: ${checks.length}/${checks.length}`)
