import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {placeBuildingCRMsAfterHealth} from '../src/lib/adminProductOrdering.js'

const p=(key,lifecycleStage='building',extra={})=>({key,lifecycleStage,...extra})
const full=[
  p('restore_relay','live'),p('pool_crm','live'),
  p('health_insurance'),p('barbers_salons'),p('home_care','research'),
  p('veterinary','research'),p('settlelift','live'),p('med_spa','research')
]
const ordered=placeBuildingCRMsAfterHealth(full)
const keys=ordered.map(x=>x.key)
assert.deepEqual(keys.slice(keys.indexOf('pool_crm'),keys.indexOf('pool_crm')+2),['pool_crm','settlelift'],
  'SettleLift must appear immediately after PoolVerge regardless of lifecycle')
assert.deepEqual(keys.slice(keys.indexOf('health_insurance'),keys.indexOf('health_insurance')+2),
  ['health_insurance','barbers_salons'],'ChairStyle must remain directly under Health Insurance')
assert(keys.indexOf('settlelift')<keys.indexOf('home_care'),'SettleLift must stay above Research')
assert.equal(new Set(keys).size,keys.length,'Product rows must not duplicate')
assert.deepEqual(placeBuildingCRMsAfterHealth(ordered),ordered,'Placement must be idempotent')
assert.deepEqual(placeBuildingCRMsAfterHealth([p('pool_crm','live'),p('settlelift','live')]).map(x=>x.key),
  ['pool_crm','settlelift'],'PoolVerge/SettleLift pair must work without Health Insurance')
const filtered=[p('settlelift','live'),p('restore_relay','live')]
assert.deepEqual(placeBuildingCRMsAfterHealth(filtered),filtered,
  'Do not insert or reorder a missing PoolVerge in filtered views')
const admin=readFileSync('src/pages/AdminPortal.jsx','utf8')
const poolStart=admin.indexOf("key:        'pool_crm'")
const poolEnd=admin.indexOf('\n  },',poolStart)
assert(poolStart>=0&&poolEnd>poolStart,'PoolVerge product definition must exist')
const pool=admin.slice(poolStart,poolEnd)
assert(pool.includes("lifecycleStage: 'live'"),'PoolVerge is built, not Building')
assert(pool.includes("connection:     'not_connected'"),'Do not falsely claim CRM metrics are connected')
assert(admin.includes('const filtered = placeBuildingCRMsAfterHealth('),
  'Products tab must use final consistent product order')
assert(admin.includes('const products = placeBuildingCRMsAfterHealth(mergeProductRegistry(reportingProducts))'),
  'Dashboard portfolio must use the same product order')
console.log('PASS Admin Portal: PoolVerge Live; SettleLift directly below PoolVerge; filtered views safe')
