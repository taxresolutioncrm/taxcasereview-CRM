import assert from 'node:assert/strict'
import fs from 'node:fs'
import { transform } from 'esbuild'

// Compile the actual Deno function source and run it under mocked Supabase and
// JMAP dependencies. No network, production credential or database is used.
const source=fs.readFileSync(new URL('../supabase/functions/oculivo-demo-intake/index.ts',import.meta.url),'utf8')
const stubbed=source.replace(/^import \{ createClient \} from '[^']+'\s*/,'const createClient=globalThis.__oculivoMockCreateClient\n')
assert.notEqual(stubbed,source,'Deno external Supabase import must be stubbed')
const {code}=await transform(stubbed,{loader:'ts',format:'esm',target:'es2022'})

const previous={Deno:globalThis.Deno,createClient:globalThis.__oculivoMockCreateClient,fetch:globalThis.fetch}
const env={OCULIVO_LEAD_WEBHOOK_SECRET:'test-webhook-secret',SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'not-a-real-key'}
const rows=[]
let handler,notifications=0,mailFailure=false

globalThis.Deno={env:{get:key=>env[key]},serve:fn=>{handler=fn}}
globalThis.__oculivoMockCreateClient=()=>({
 from(table){
  assert.equal(table,'romylabs_demo_requests')
  return {
   insert(values){return {select(){return {single:async()=>{
    if(rows.some(x=>x.request_key===values.request_key))return {data:null,error:{code:'23505'}}
    const row={...values,id:'lead-'+(rows.length+1),notification_submission_id:null,notification_last_error:null}
    rows.push(row);return {data:{id:row.id},error:null}
   }}}}},
   select(){return {eq(key,value){return {maybeSingle:async()=>({data:rows.find(r=>r[key]===value)||null,error:null})}}}},
   update(changes){return {eq:async(key,value)=>{
    const row=rows.find(r=>r[key]===value)
    if(row)Object.assign(row,changes)
    return {error:null}
   }}}
  }
 },
 rpc:async(name,params)=>{
  assert.equal(name,'romylabs_stalwart_transport_for_product')
  assert.equal(params.p_product_key,'romylabs')
  return {data:{ok:true,host:'mail.taxrescrm.net',username:'info@romylabs.com',from_address:'info@romylabs.com',password:'synthetic-test-password'},error:null}
 }
})
globalThis.fetch=async(url,options={})=>{
 const address=String(url)
 if(mailFailure)return new Response('mail unavailable',{status:503})
 if(address.endsWith('/.well-known/jmap'))return Response.json({apiUrl:'https://mail.taxrescrm.net/jmap',primaryAccounts:{'urn:ietf:params:jmap:mail':'account-1'},accounts:{'account-1':{}}})
 if(!address.endsWith('/jmap'))throw new Error('Unexpected outbound request: '+address)
 const request=JSON.parse(options.body)
 if(request.methodCalls.some(x=>x[0]==='Identity/get')){
  return Response.json({methodResponses:[['Identity/get',{list:[{id:'identity-1',email:'info@romylabs.com'}]}],['Mailbox/get',{list:[{id:'drafts-1',role:'drafts'},{id:'sent-1',role:'sent'}]}]]})
 }
 const call=request.methodCalls.find(x=>x[0]==='Email/set')
 assert.ok(call,'Email/set required')
 const email=call[1].create.draft
 assert.equal(email.from[0].email,'info@romylabs.com')
 assert.ok(email.bodyValues.body.value.includes('oculivo-website-logo.png'))
 assert.ok(email.bodyValues.body.value.includes('https://taxrescrm.app/crm-admin/tasks'))
 assert.ok(email.bodyValues.body.value.includes('New private demo request'))
 notifications++
 return Response.json({methodResponses:[['EmailSubmission/set',{created:{sendIt:{id:'submission-'+notifications}}}]]})
}

const payload={product:'oculivo',source:'oculivo.com',event:'demo_request',request_id:'bcb61f21-1db7-490a-a82a-451ce1d5c022',consent:true,contact:{name:'Website Lead',email:'lead@example.com',practice:'Test Vision Center',specialty:'optometry',locations:'1',message:'No patient information'}}
const request=(data=payload,secret=env.OCULIVO_LEAD_WEBHOOK_SECRET)=>new Request('https://test.invalid/functions/v1/oculivo-demo-intake',{method:'POST',headers:{authorization:'Bearer '+secret,'content-type':'application/json'},body:JSON.stringify(data)})
try{
 await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
 assert.equal(typeof handler,'function','Deno.serve handler registered')
 let response=await handler(request(payload,'wrong-secret'))
 assert.equal(response.status,401)
 assert.equal(rows.length,0)
 console.log('PASS wrong webhook secret rejected')
 response=await handler(request({...payload,product:'other'}))
 assert.equal(response.status,400)
 assert.equal(rows.length,0)
 console.log('PASS wrong product rejected')
 response=await handler(request({...payload,contact:{...payload.contact,email:'not-an-email'}}))
 assert.equal(response.status,400)
 console.log('PASS malformed lead rejected')
 response=await handler(request())
 assert.equal(response.status,200)
 assert.equal((await response.json()).ok,true)
 assert.equal(rows.length,1)
 assert.equal(rows[0].lead_email,'lead@example.com')
 assert.equal(rows[0].notification_submission_id,'submission-1')
 assert.equal(notifications,1)
 console.log('PASS valid lead persisted and branded Stalwart notification submitted')
 response=await handler(request())
 assert.equal(response.status,200)
 assert.equal((await response.json()).already_received,true)
 assert.equal(rows.length,1)
 assert.equal(notifications,1)
 console.log('PASS repeated request key creates no duplicate lead or email')
 mailFailure=true
 response=await handler(request({...payload,request_id:'20ec72ae-851f-4473-9c34-d321d8b0a7fe'}))
 assert.equal(response.status,200)
 assert.equal(rows.length,2)
 assert.ok(rows[1].notification_last_error)
 assert.equal(rows[1].notification_submission_id,null)
 console.log('PASS mail outage preserves durable lead and records visible error')
}finally{
 globalThis.Deno=previous.Deno
 globalThis.__oculivoMockCreateClient=previous.createClient
 globalThis.fetch=previous.fetch
}
