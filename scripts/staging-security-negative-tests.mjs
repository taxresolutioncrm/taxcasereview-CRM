// Synthetic-data-only cross-tenant negative test. Never use against production.
// Required environment: STAGING_SUPABASE_URL, STAGING_SUPABASE_ANON_KEY,
// STAGING_TEST_ACCOUNTS_JSON (three test staff accounts + one view-only account),
// STAGING_ALLOW_SYNTHETIC_WRITES=YES. No service role or production credentials.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const PROD_REFS=new Set(['mpxgxfqdbquzkrvvejkh','ydrvncdedgjtcprczwpu','txrcnfhrfqbtuchwznzz'])
const url=process.env.STAGING_SUPABASE_URL||''
const anon=process.env.STAGING_SUPABASE_ANON_KEY||''
const config=process.env.STAGING_TEST_ACCOUNTS_JSON||''
if(!url||!anon||!config||process.env.STAGING_ALLOW_SYNTHETIC_WRITES!=='YES') {
 console.error('BLOCKED: staging URL, staging anon key, synthetic test accounts and explicit synthetic-write flag required')
 process.exit(2)
}
let host
try {host=new URL(url).hostname} catch {throw Error('STAGING_SUPABASE_URL must be a valid URL')}
assert.match(host,/^[a-z0-9-]+\.supabase\.co$/,'Only a dedicated Supabase staging project is supported')
const ref=host.split('.')[0]
assert.ok(!PROD_REFS.has(ref),'BLOCKED: live/known project cannot be used for a penetration test')
const accounts=JSON.parse(config)
assert.ok(Array.isArray(accounts)&&accounts.length===4,'Exactly three tenant staff accounts and one restricted account required')
assert.deepEqual(new Set(accounts.map(a=>a.role)),new Set(['tcr','taxres','centurion','readonly']))
const staff=accounts.filter(a=>a.role!=='readonly')
assert.equal(new Set(staff.map(a=>a.tenantId)).size,3,'Each office must use a different tenant')
for(const a of accounts){
 for(const k of ['email','password','tenantId','ownClientId']) assert.ok(typeof a[k]==='string'&&a[k].length>0,'Missing synthetic '+k+' for '+a.role)
 assert.match(a.expectedName||'',/^STAGING_PENTEST_/,'Refuse to target non-synthetic client records')
}
const checks=[]
function check(name,ok,detail=''){checks.push({name,pass:!!ok,detail});if(!ok)throw Error(name+': '+detail)}
function client(){return createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})}
const clients=[]
try{
 for(const account of accounts){
  const c=client()
  const {error}=await c.auth.signInWithPassword({email:account.email,password:account.password})
  check(account.role+' logs into isolated sandbox',!error,error?.message||'')
  clients.push({account,c})
 }
 for(const {account,c} of clients){
  const {data:tenant,error}=await c.rpc('current_tenant_id')
  check(account.role+' tenant resolves correctly',!error&&tenant===account.tenantId,'actual tenant mismatches test configuration')
  const {data:own,error:ownErr}=await c.from('clients').select('id,tenant_id,name').eq('id',account.ownClientId).maybeSingle()
  check(account.role+' sees only designated synthetic own record',!ownErr&&own?.tenant_id===account.tenantId&&own?.name===account.expectedName)
  for(const foreign of staff.filter(x=>x.tenantId!==account.tenantId)){
   const {data,error:readErr}=await c.from('clients').select('id').eq('id',foreign.ownClientId)
   check(account.role+' cannot read '+foreign.role+' client',!readErr&&Array.isArray(data)&&data.length===0)
   const {data:changed,error:writeErr}=await c.from('clients').update({name:'STAGING_PENTEST_UNAUTHORIZED_WRITE'}).eq('id',foreign.ownClientId).select('id')
   check(account.role+' cannot update '+foreign.role+' client',!!writeErr||(Array.isArray(changed)&&changed.length===0))
  }
 }
 const ro=clients.find(x=>x.account.role==='readonly')
 const {data:changed,error:roErr}=await ro.c.from('clients').update({name:'STAGING_PENTEST_READONLY_WRITE'}).eq('id',ro.account.ownClientId).select('id')
 check('read-only account cannot edit own synthetic client',!!roErr||(Array.isArray(changed)&&changed.length===0))
 const anonymous=client()
 for(const [rpc,args] of [['esign_load',{p_id:'es_00000000-0000-0000-0000-000000000000'}],['esign_mark_signed',{p_id:'es_00000000-0000-0000-0000-000000000000',p_signed_name:'Test',p_signer_full_name:'Test',p_signer_ip:'',p_signed_user_agent:''}]]){
  const {error}=await anonymous.rpc(rpc,args)
  check('anonymous '+rpc+' execution denied',!!error&&(/permission denied|42501|not found|schema cache|Could not find/i).test(error.message||''),error?'server declined request':'unexpected success')
 }
 const res=await fetch(url+'/functions/v1/stripe-set-autopay',{method:'POST',headers:{'Content-Type':'application/json',apikey:anon},body:JSON.stringify({clientId:staff[0].ownClientId,enabled:false})})
 check('anonymous autopay modification rejected',res.status===401||res.status===403,'HTTP '+res.status)
}finally{
 for(const {c} of clients){try{await c.auth.signOut()}catch{}}
 const result={testedAt:new Date().toISOString(),project_ref:ref,environment:'dedicated staging only',synthetic_only:true,checks,passed:checks.length>0&&checks.every(x=>x.pass)}
 fs.mkdirSync('artifacts',{recursive:true})
 fs.writeFileSync('artifacts/staging-security-negative-tests.json',JSON.stringify(result,null,2))
 console.log(JSON.stringify({environment:result.environment,project_ref:ref,passes:checks.filter(x=>x.pass).length,failed:checks.filter(x=>!x.pass).map(x=>x.name),passed:result.passed}))
}
if(checks.some(x=>!x.pass))process.exit(1)
