import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const api=readFileSync('supabase/functions/bing-data/index.ts','utf8')
const ui=readFileSync('src/pages/AdminPortal.jsx','utf8')
assert.match(api,/pool_crm:\s*'https:\/\/poolverge\.com\/'/,'PoolVerge must be mapped to the correct verified domain')
assert.match(api,/settlelift:\s*'https:\/\/settlelift\.com\/'/,'SettleLift must resolve its existing Bing Webmaster property')
assert.ok(api.includes("productKey = String(body?.product_key || 'taxres_crm')"),'Keep product-specific Bing request selection')
for(const domain of ['taxrescrm.net','camvella.com','arcvena.com','bocasync.com','groundivo.com','oculivo.com','restorerelay.com','romylabs.com'])
  assert.ok(api.includes(domain+'/'),'Existing Bing site must remain supported: '+domain)
assert.ok(ui.includes("supabase.functions.invoke('bing-data', { body: { product_key: productKey } })"),'Bing reporting must use the selected business')
assert.ok(api.includes("error:'bing_site_not_verified'"),'Unverified sites cannot be marked connected')
assert.ok(api.includes("GetRankAndTrafficStats"),'Traffic reporting must remain available')
console.log('PASS PoolVerge Bing routing: correct host, other businesses unchanged, verification guarded')
