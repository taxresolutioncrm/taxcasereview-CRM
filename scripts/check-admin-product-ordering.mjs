import assert from 'node:assert/strict'
import { placeBuildingCRMsAfterHealth } from '../src/lib/adminProductOrdering.js'

const product = (key,lifecycleStage='building',extra={}) => ({key,lifecycleStage,...extra})
const items = [
  product('taxres_crm','live'),
  product('pool_crm','live'),
  product('health_insurance'),
  product('barbers_salons'),
  product('home_care','research'),
  product('veterinary','research'),
  product('settlelift','live'),
  product('other_business','building')
]
const result = placeBuildingCRMsAfterHealth(items)
const keys = result.map(x=>x.key)
assert.equal(keys[keys.indexOf('pool_crm')+1],'settlelift',
  'SettleLift must appear immediately below PoolVerge even when live')
assert.equal(keys[keys.indexOf('health_insurance')+1],'barbers_salons',
  'Keep ChairStyle after Health Insurance without pulling SettleLift away from PoolVerge')
assert(keys.indexOf('settlelift') < keys.indexOf('home_care'),
  'SettleLift must not be left at the bottom after research entries')
assert.equal(new Set(keys).size,keys.length,'No duplicated product rows')
assert.deepEqual(placeBuildingCRMsAfterHealth(result).map(x=>x.key),keys,
  'Final ordering must be idempotent')
const noPool = items.filter(x=>x.key!=='pool_crm')
const noSettle = items.filter(x=>x.key!=='settlelift')
assert(!placeBuildingCRMsAfterHealth(noPool).some(x=>x.key==='pool_crm'),
  'Filtered list must not reintroduce PoolVerge')
assert(!placeBuildingCRMsAfterHealth(noSettle).some(x=>x.key==='settlelift'),
  'Filtered list must not reintroduce SettleLift')
assert.deepEqual(placeBuildingCRMsAfterHealth([product('pool_crm','building'),product('settlelift','building')]).map(x=>x.key),
  ['pool_crm','settlelift'],'Keep pair together when lifecycle changes')
assert.deepEqual(placeBuildingCRMsAfterHealth([product('taxres_crm','live'),product('pool_crm','building')]).map(x=>x.key),
  ['taxres_crm','pool_crm'],'No insertions when SettleLift is absent')

// Both Dashboard Product Portfolio and Products Tab use the same helper.
const fs = await import('node:fs')
const portal = fs.readFileSync('src/pages/AdminPortal.jsx','utf8')
const dashboardStart = portal.indexOf('{/* ── Portfolio Grid (compact — not a duplicate of Products tab) ── */}')
assert(dashboardStart >= 0,'Dashboard Product Portfolio section missing')
assert(portal.slice(dashboardStart,dashboardStart+1800).includes('const products = placeBuildingCRMsAfterHealth(mergeProductRegistry(reportingProducts))'),
  'Dashboard must honor exact PoolVerge > SettleLift final order')
assert(portal.includes('const filtered = placeBuildingCRMsAfterHealth('),
  'Products tab must honor exact PoolVerge > SettleLift final order')

console.log('PASS RomyLabs Admin Portal: PoolVerge > SettleLift, then other products; filters intact')
