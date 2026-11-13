// Regression gates for RomyLabs New Office and external office details.
// Run from the repository root: node scripts/check-admin-office-release.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = path => readFileSync(path,'utf8')
const portal=read('src/pages/AdminPortal.jsx')
const form=read('src/pages/NewOffice.jsx')
const pricing=read('src/lib/productOfficePricing.js')
const backend=read('supabase/functions/provision-tenant/index.ts')
const nashville=read('supabase/nashville/functions/platform-metrics/index.ts')
const must=(src,token,msg)=>assert.ok(src.includes(token),msg)
must(portal,'const merged={...registered}','External office must merge live and registry fields')
must(portal,"productKey==='nashville' && r.product_key==='taxres_crm'",'Nashville legacy registry key must map')
must(portal,'merged.is_active=liveMatch.is_active','Live office status must beat stale central registry status')
must(portal,'Refresh office directory','All Offices must offer refresh')
must(portal,'auto-fill,minmax(min(100%,310px),1fr)','Office card grid must be responsive')
must(portal,'role="button" tabIndex={0}','Office cards must support keyboard navigation')
must(nashville,"sb.from('tenants').select('id,tenant_code,firm_name",'Nashville must use its actual tenant data')
for(const field of ['plan_tier','status','tenant_code','primary_contact_name','primary_contact_email','firm_phone','contract_start_date','contract_end_date']){
  must(nashville,'tenant.'+field,'Nashville tenant metadata absent: '+field)
}
must(form,'PLAN_OPTIONS.map','Keep existing Starter, Professional, Enterprise control tiers')
must(form,"officePrice(productKey,p.value)",'Tier pricing must depend on selected product')
for(const mode of ['standard','per_seat','flat'])must(form,"value=\""+mode+"\"",'Missing billing mode '+mode)
must(form,"product?.billingUnit === 'seat'",'Flat/location pricing cannot multiply by employee seats')
must(backend,"b.product_key !== 'taxres_crm'",'No cross-project provisioning via TaxRes function')
must(backend,"const {data:pricing, error:pricingReadError}",'Must verify billed seats and rates before login')
assert.ok(backend.indexOf('pricingReadError')<backend.indexOf('admin.auth.admin.createUser'),'Billing must be verified before creating admin auth')
must(pricing,"restore_relay:Object.freeze({starter:149,professional:299,enterprise:499})",'Restore Relay verified published plans')
must(pricing,"camvella:Object.freeze({starter:149,professional:349,enterprise:null})",'Camvella published plans')
must(pricing,"bocasync:Object.freeze({starter:299,professional:499,enterprise:699})",'BocaSync published plans')
assert.ok(!pricing.includes('arcvena:Object.freeze('),'Arcvena quote-only pricing must not be invented')
console.log('Admin Office source regression checks passed')
