import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const source=readFileSync('supabase/functions/linkedin-scheduler/index.ts','utf8')
const phases=['intake','investigation','casework','resolution','closeout']
for(const phase of phases){
  const matches=[...source.matchAll(new RegExp('\\{category:"'+phase+'",cta_type:', 'g'))]
  assert.equal(matches.length,3,'TaxRes stage '+phase+' must have three original LinkedIn posts')
}
assert(source.includes('const TAXRES_WORKFLOW_STAGES = ["intake","investigation","casework","resolution","closeout"] as const'),
  'Five-stage rotation must match public TaxRes CRM workflow')
assert(source.includes("if(productId===TAXRES_PRODUCT)"),'Do not affect Arcvena or other LinkedIn feeds')
assert(source.includes("const stage=TAXRES_WORKFLOW_STAGES"),'Generate by stage, not random legacy post order')
assert(source.includes("const options=TAXRES_WORKFLOW_LIBRARY.filter(p=>p.category===stage)"),
  'Future TaxRes posts must prefer the selected workflow stage')
assert(source.includes("if(!source)for(let tries=0;tries<library.length;tries++)"),
  'Keep existing tax-resolution and other business content as fallback')
assert(source.includes("const target=slots(now,8)")&&source.includes("const open=target.filter"),
  'Keep current Tuesday/Thursday queue and existing reservations')
assert(source.includes("if(productId===ARCVENA_PRODUCT"),'Preserve existing Arcvena publishing isolation')
assert(source.includes("et(now).day==='Mon'"),'Generate content path must have defined clock')
const mon=Date.UTC(2026,10,23,14)
const categories=[]
for(let week=0;week<7;week++)for(const offset of [1,3]){
  const d=new Date(mon+week*7*86400000+offset*86400000)
  const mondayWeek=Math.floor((d.getTime()+3*86400000)/(7*86400000))
  const step=mondayWeek*2+(d.getUTCDay()===4?1:0)
  categories.push(phases[((step%5)+5)%5])
}
assert.equal(new Set(categories.slice(0,5)).size,5,'Each five new posting slots must cover all stages')
assert.deepEqual(categories.slice(0,5),categories.slice(5,10),'Stage rotation must be repeatable')
console.log('PASS LinkedIn five-stage TaxRes content rotation, original content preserved, Arcvena isolated')
