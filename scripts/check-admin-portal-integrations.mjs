import fs from 'node:fs'

const read=(p)=>fs.readFileSync(p,'utf8')
const admin=read('src/pages/AdminPortal.jsx')
const adminHostGuard=read('public/romylabs-admin-hotfix.js')
const appRouter=read('src/App.jsx')
const billing=read('src/components/admin/RomyLabsBilling.jsx')
const hub=read('supabase/functions/hub-proxy/index.ts')
const metricsSignal=read('supabase/functions/metrics-signal/index.ts')
const realtimeMetricsMigration=read('supabase/migrations/romylabs_admin_metrics_realtime.sql')
const content=read('supabase/functions/content-generator/index.ts')
const publish=read('supabase/functions/linkedin-publish/index.ts')
const strictCompanyMigration=read('supabase/migrations/20261026090000_linkedin_company_page_only_taxres_arcvena.sql')
const scheduler=read('supabase/functions/linkedin-scheduler/index.ts')
const replenisher=read('supabase/functions/linkedin-queue-replenisher/index.ts')
const bing=read('supabase/functions/bing-data/index.ts')
const migration=read('supabase/migrations/20261007_linkedin_autopilot_regression_repair.sql')
const autopilotMigration=read('supabase/migrations/20261007_linkedin_hourly_queue_autopilot.sql')
const taxresCadenceMigration=read('supabase/migrations/20261008_restore_taxres_linkedin_tue_thu.sql')
const personalAutopilotGuard=read('supabase/migrations/20261105024000_linkedin_personal_publisher_starvation_guard.sql')

const checks=[
  ['LinkedIn company-page ACL uses versioned REST and both supported organization fields',publish.includes('/rest/organizationAcls?q=roleAssignee') && publish.includes('x?.organizationTarget||x?.organization') && publish.includes("'Linkedin-Version':'202610'")],
  ['LinkedIn trusted callback gets explicit React route before /crm-admin catchall',appRouter.indexOf('path="/crm-admin/linkedin/callback"') >= 0 && appRouter.indexOf('path="/crm-admin/linkedin/callback"') < appRouter.indexOf('path="/crm-admin/*"') && appRouter.includes('function LinkedInCallbackBridge()')],
  ['Legacy TaxRes redirect exempts LinkedIn callback',adminHostGuard.includes("path !== '/crm-admin/linkedin/callback'")],
  ['LinkedIn OAuth opens separately and keeps workspace available',admin.includes("window.open(authorizationUrl, 'romylabs-linkedin-auth'") && appRouter.includes("type: 'romylabs-linkedin-oauth-code'")],
  ['LinkedIn OAuth shared state expires and is checked across tabs',admin.includes("localStorage.setItem('linkedin_oauth_transaction'") && admin.includes('transaction.state !== result.state')],
  ['LinkedIn workspace restores drafts and active tab',admin.includes("sessionStorage.getItem('romylabs_li_draft_body')") && admin.includes("sessionStorage.getItem('romylabs_li_active_tab')")],
  ['LinkedIn authorization uses original registered callback for all products',admin.includes("pid === 'arcvena' ? ADMIN_LINKEDIN_CALLBACK : TAXRES_LINKEDIN_REDIRECT_URI")],
  ['Company-page OAuth requests LinkedIn organization admin read permission',admin.includes("selectedPid === 'arcvena'") && admin.includes("company-page publishing requires LinkedIn approval")],
  ['LinkedIn OAuth validates admin ACL even when scope metadata omitted',publish.includes("requiresOrganization && grantedScopes && !scopeSet.has('w_organization_social')") && publish.includes('resolveOrganization(tokenData.access_token, productId)')],
  ['LinkedIn OAuth errors are bridged from original trusted host',admin.includes("bridge.searchParams.set('error_description', params.get('error_description') || linkedInError)")],
  ['LinkedIn reconnect surfaces provider authorization errors',admin.includes('result.error_description || result.error') && admin.includes("'LinkedIn connection failed: '")],
  ['LinkedIn rejects invalid callback redirect and missing code',publish.includes('allowedRedirects.has(redirect_uri)')],
  ['LinkedIn validates token response and profile identity',publish.includes('!tokenRes.ok || !tokenData.access_token') && publish.includes('!profileRes.ok || !profile.sub')],
  ['LinkedIn never reports successful reconnect on failed database upsert',publish.includes('connectionSaveError') && publish.includes('No successful connection has been recorded.')],
  ['LinkedIn status rejects expired personal profile connection',publish.includes('reconnect_required: expired || (companyPageRequired && !validOrganization)')],
  ['LinkedIn prevents unverified organization ID updates',publish.includes("if (ORG_PRODUCTS.has(productId)) {") && publish.includes('Reconnect LinkedIn and authorize the company page')],
  ['LinkedIn publish checks organization permissions',publish.includes("!grantedScopes.includes('w_organization_social')")],
  ['TaxRes and Arcvena database publishing never falls back to personal profiles',strictCompanyMigration.includes("v_author:='urn:li:organization:'") && !strictCompanyMigration.includes("v_author:='urn:li:person:'")],
  ['TaxRes company-page OAuth resolves verified organization ID',publish.includes("const ORG_PRODUCTS = new Set(['arcvena'])") && publish.includes("productId === 'taxres_crm'")],
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
  ['Manual billing offers all registered CRM products, including PoolVerge, PHL Land Care and health insurance',billing.includes("supabase.from('romylabs_products').select('product_id,name')")&&billing.includes("'pool_crm','PoolVerge'")&&billing.includes("'phl_land_care','PHL Land Care CRM'")&&billing.includes("'health_insurance','Health Insurance Agency CRM'")],
  ['Manual billing finds separately hosted offices from central account ledger',billing.includes('for(const a of accounts)')&&billing.includes('candidates.set(String(a.external_tenant_id)')&&billing.includes('officeOptions.map(o=>')],
  ['Manual billing prepopulates existing Nashville account price and billing contact',billing.includes('Number(account.per_seat_amount_cents||0)/100')&&billing.includes('billing_email:account.billing_email')&&billing.includes('seat_count:account.seat_count')],
  ['Manual billing clears stale account details when switching CRM product',billing.includes('const chooseProduct = key => setPayment')&&billing.includes('...blankPayment,product_key:key')],
  ['Manual billing records through authorized idempotent server RPC',billing.includes("supabase.rpc('admin_record_manual_subscription_payment'")&&billing.includes("p_reference:stableReference")],
  ['Billing subscribes only to billing-domain changes',billing.includes("channel('romylabs-billing-live')")&&billing.includes("table:'romylabs_subscription_payments'")&&billing.includes("table:'romylabs_billing_accounts'")&&!billing.includes("table:'romylabs_metrics_cache'")],
  ['hub supports generic cache refresh and recovery',hub.includes("refresh_product_metrics")&&hub.includes("refresh_stale_metrics")&&hub.includes('refreshProductCache')&&hub.includes('EdgeRuntime.waitUntil')],
  ['metrics signal is invalidation-only and rate limited',metricsSignal.includes("claim_romylabs_metrics_refresh")&&metricsSignal.includes("romylabs_metrics_signal_queue")&&!metricsSignal.includes("record")&&!metricsSignal.includes("old_record")],
  ['metrics signal coalesces refresh writes for 30 seconds',metricsSignal.includes('p_min_interval_ms: 30000')],
  ['Admin Portal realtime refresh is tab/product-scoped and does not reload hidden command-center work',admin.includes('setLiveMetricsProduct(productKey)')&&admin.includes("if (tab !== 'crm') return")&&admin.includes('}, [tab, crmProduct])')&&admin.includes("if (tab !== 'overview') return")&&admin.includes('}, [reportingProducts, tab])')&&admin.includes('liveMetricsProduct !== crmProduct')],
  ['realtime metrics migration protects cache and publishes it',realtimeMetricsMigration.includes('romylabs_metrics_cache_platform_admin_read')&&realtimeMetricsMigration.includes('alter publication supabase_realtime add table public.romylabs_metrics_cache')],
  ['realtime metrics migration uses async pg_net signals',realtimeMetricsMigration.includes("functions/v1/metrics-signal")&&realtimeMetricsMigration.includes('net.http_post')&&realtimeMetricsMigration.includes("for each statement")],
  ['realtime metrics migration uses valid PL/pgSQL delimiters',realtimeMetricsMigration.includes("create or replace function public.romylabs_dispatch_metrics_signal()\nreturns trigger\nlanguage plpgsql\nsecurity definer\nset search_path = public, pg_catalog\nas $$")&&!realtimeMetricsMigration.includes("\nas $\nbegin")],

  ['product cards never bypass hub proxy',!admin.includes("['camvella', 'arcvena'].includes(product.key)")&&!admin.includes("'apikey':        'eyJ")],
  ['LinkedIn scopes require organization publishing for TaxRes and Arcvena',admin.includes("'openid profile w_member_social'") && admin.includes("selectedPid === 'arcvena'") && !admin.includes("'openid profile w_organization_social rw_organization_admin'")],
  ['LinkedIn UI requires company page for TaxRes and Arcvena',admin.includes("const companyPageRequired = selectedPid === 'arcvena'") && admin.includes('companyPageReady')],
  ['publisher requires organization target for TaxRes and Arcvena',publish.includes("const ORG_PRODUCTS = new Set(['arcvena'])") && publish.includes("required_scope: 'w_organization_social'")],
  ['scheduler requires organization publishing for both company pages',scheduler.includes("const hasTarget=target==='ORGANIZATION' && Boolean(conn.linkedin_organization_id)")&&scheduler.includes('arcvena_company_page_target_not_verified')&&scheduler.includes('verify_internal_cron_token')],
  ['legacy TaxRes replenisher accepts member or organization target',replenisher.includes('publishTargetReady')&&replenisher.includes("targetType==='PERSON'")&&replenisher.includes('publish_target_not_ready')],
  ['database publisher is product scoped',migration.includes("v_post.product_id='arcvena'")&&migration.includes("elsif nullif(v_conn.linkedin_person_id,'') is not null")],
  ['database publisher supports organization and person authors',migration.includes("'urn:li:organization:'||v_conn.linkedin_organization_id")&&migration.includes("'urn:li:person:'||v_conn.linkedin_person_id")],
  ['TaxRes LinkedIn queue no longer has duplicate hourly/daily generators',taxresCadenceMigration.includes("'linkedin-taxres-queue-autopilot'")&&taxresCadenceMigration.includes("'linkedin-queue-replenishment-supabase'")],
  ['TaxRes LinkedIn publishes only Tue/Thu 9 AM ET with no stale catch-up',taxresCadenceMigration.includes("extract(isodow from scheduled_at at time zone 'America/New_York') in (2,4)")&&taxresCadenceMigration.includes("extract(hour from scheduled_at at time zone 'America/New_York') = 9")&&taxresCadenceMigration.includes("scheduled_at >= now() - interval '2 hours'")],
  ['Personal LinkedIn rolling eight-slot queue is refreshed by the existing hourly run',scheduler.includes('const target=slots(now,8)')&&scheduler.includes('action!==\'run\'')&&!scheduler.includes("if(clock.day==='Mon'&&clock.hour===7){")],
  ['Disconnected company queues cannot starve member publishing',personalAutopilotGuard.includes('and exists (')&&personalAutopilotGuard.includes("linkedin_posts.product_id='taxres_crm'")&&personalAutopilotGuard.includes("upper(lc.publish_target_type)='PERSON'")&&personalAutopilotGuard.includes("linkedin_posts.product_id='arcvena'")&&personalAutopilotGuard.includes("upper(lc.publish_target_type)='ORGANIZATION'")&&personalAutopilotGuard.indexOf('and exists (')<personalAutopilotGuard.indexOf('limit 3')],
  ['No late or off-schedule catch-up, personal Tue/Thu 9 Eastern preserved',personalAutopilotGuard.includes("scheduled_at >= now() - interval '2 hours'")&&personalAutopilotGuard.includes("extract(isodow from scheduled_at at time zone 'America/New_York') in (2,4)")&&personalAutopilotGuard.includes("extract(hour from scheduled_at at time zone 'America/New_York') = 9")],
  ['Personal target still validates real OAuth connection and token before queueing',scheduler.includes("target==='PERSON' && Boolean(conn.linkedin_person_id)")&&scheduler.includes("new Date(conn.expires_at)<now")],

  ['Bing state comes from Bing verification',bing.includes('GetUserSites')&&bing.includes('VerifySite')&&bing.includes("status:'configured'")&&bing.includes('last_verified_at')],
]
let failed=0
for(const [label,ok] of checks){console.log(`${ok?'PASS':'FAIL'}  ${label}`);if(!ok)failed++}
if(failed) process.exit(1)
console.log(`Admin Portal integration gate PASS: ${checks.length}/${checks.length}`)
