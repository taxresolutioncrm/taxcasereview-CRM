import assert from 'node:assert/strict'
import { placeBuildingCRMsAfterHealth } from '../src/lib/adminProductOrdering.js'

const product = (key,lifecycleStage='building',extra={}) => ({key,lifecycleStage,...extra})
const items = [
  product('taxres_crm','live'),
  product('health_insurance'),
  product('barbers_salons'),
  product('home_care','research'),
  product('veterinary','research'),
  product('settlelift'),
  product('other_business','building')
]
const result=placeBuildingCRMsAfterHealth(items)
const keys=result.map(x=>x.key)
assert.deepEqual(keys.slice(keys.indexOf('health_insurance'),keys.indexOf('health_insurance')+3),
  ['health_insurance','settlelift','barbers_salons'],
  'SettleLift must be directly below Health Insurance and above ChairStyle')
assert(keys.indexOf('settlelift') < keys.indexOf('home_care'),'SettleLift must appear above research')
assert(keys.indexOf('settlelift') < keys.indexOf('veterinary'),'SettleLift must appear above veterinary research')
assert.equal(new Set(keys).size,keys.length,'Placement must not duplicate records')
assert.deepEqual(placeBuildingCRMsAfterHealth(result).map(x=>x.key),keys,'Placement must be idempotent')
assert.deepEqual(placeBuildingCRMsAfterHealth(items.filter(x=>x.key!=='health_insurance')),items.filter(x=>x.key!=='health_insurance'),
  'Do not insert products into filters where Health Insurance is absent')
assert.deepEqual(placeBuildingCRMsAfterHealth([product('health_insurance','live'),product('settlelift')]).map(x=>x.key),
  ['health_insurance','settlelift'],'Do not reposition products if lifecycle status changes')
// Guard the exact dashboard Product Portfolio table shown in the incident screenshot.
// The Products tab and dashboard are separate renderers and must both apply this helper.
const fs = await import('node:fs')
const adminPortalSource = fs.readFileSync('src/pages/AdminPortal.jsx','utf8')
const dashboardStart = adminPortalSource.indexOf('{/* ── Portfolio Grid (compact — not a duplicate of Products tab) ── */}')
assert(dashboardStart >= 0, 'Dashboard Product Portfolio section missing')
const dashboardSection = adminPortalSource.slice(dashboardStart, dashboardStart + 1800)
assert(dashboardSection.includes('const products = placeBuildingCRMsAfterHealth(mergeProductRegistry(reportingProducts))'),
  'Dashboard Product Portfolio must apply the same final Building order as Products tab')
assert(adminPortalSource.includes('const filtered = placeBuildingCRMsAfterHealth('),
  'Products tab must preserve its existing Building order fix')
console.log('PASS Admin Portal Building order: Health Insurance > SettleLift > ChairStyle > Research')
