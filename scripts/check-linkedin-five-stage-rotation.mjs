import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const source=readFileSync('supabase/functions/linkedin-scheduler/index.ts','utf8')
const services=['tax_preparation','bookkeeping','business_formation','time_clock','tax_resolution']
for(const service of services){
  const matches=source.split('category:"'+service+'",cta_type:').length-1
  assert.equal(matches,3,'Three original LinkedIn posts required for '+service)
}
assert(source.includes('const TAXRES_SERVICE_AREAS = ["tax_preparation","bookkeeping","business_formation","time_clock","tax_resolution"] as const'),'Five distinct services')
assert(source.includes('const area=TAXRES_SERVICE_AREAS'),'Future posts must rotate by business service')
assert(source.includes('TAXRES_SERVICE_LIBRARY.filter(p=>p.category===area)'),'Category-specific selection')
assert(source.includes('if(productId===TAXRES_PRODUCT)'),'Only existing TaxRes feed is modified')
assert(!source.includes('TAXRES_WORKFLOW_STAGES'),'Old case-stage rotation must be removed')
assert(source.includes('if(!source)for(let tries=0;tries<library.length;tries++)'),'Existing approved content retained as fallback')
assert(source.includes('const target=slots(now,8)')&&source.includes('const open=target.filter'),'Do not rewrite existing queue slots')
assert(source.includes('if(pid===ARCVENA_PRODUCT'),'Arcvena target remains independent')
assert(source.includes("et(now).day==='Mon'"),'Manual content generation uses defined clock')
console.log('PASS five TaxRes service lines, balanced content and isolated LinkedIn publishing')
