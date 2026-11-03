import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.0'

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}})
const clean=(x:unknown,max=250)=>String(x??'').trim().slice(0,max)
const escapeHtml=(s:unknown)=>clean(s,1000).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')

function secretMatches(supplied:string,expected:string){
 const a=new TextEncoder().encode(supplied),b=new TextEncoder().encode(expected)
 if(!expected||a.length!==b.length)return false
 let mismatch=0
 for(let i=0;i<a.length;i++)mismatch|=a[i]^b[i]
 return mismatch===0
}

async function submitStalwartEmail(admin:any,contact:any,leadId:string) {
 const {data:transport,error:transportError}=await admin.rpc('romylabs_stalwart_transport_for_product',{p_product_key:'romylabs'})
 if(transportError||!transport?.ok||!transport.username||!transport.password)throw new Error('RomyLabs Stalwart sender not configured')
 const host=clean(transport.host||'mail.taxrescrm.net')
 const from=clean(transport.from_address||transport.username).toLowerCase()
 const base='https://'+host.replace(/^https?:\/\//,'').replace(/\/$/,'')
 const auth='Basic '+btoa(String(transport.username)+':'+String(transport.password))
 const sessionRes=await fetch(base+'/.well-known/jmap',{headers:{Authorization:auth,Accept:'application/json'},signal:AbortSignal.timeout(10000)})
 if(!sessionRes.ok)throw new Error('Stalwart session HTTP '+sessionRes.status)
 const session=await sessionRes.json()
 const api=String(session.apiUrl||'').replace('{accountId}','')
 const accountId=session.primaryAccounts?.['urn:ietf:params:jmap:mail']||Object.keys(session.accounts||{})[0]
 if(!api||!accountId)throw new Error('Stalwart mail account unavailable')
 const headers={Authorization:auth,'Content-Type':'application/json',Accept:'application/json'}
 const using=['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail','urn:ietf:params:jmap:submission']
 const metaRes=await fetch(api,{method:'POST',headers,body:JSON.stringify({using,methodCalls:[['Identity/get',{accountId},'i0'],['Mailbox/get',{accountId,properties:['id','name','role']},'m0']]}),signal:AbortSignal.timeout(10000)})
 if(!metaRes.ok)throw new Error('Stalwart identity HTTP '+metaRes.status)
 const meta=await metaRes.json()
 const identities=meta.methodResponses?.find((x:any)=>x[0]==='Identity/get')?.[1]?.list||[]
 const mailboxes=meta.methodResponses?.find((x:any)=>x[0]==='Mailbox/get')?.[1]?.list||[]
 const identity=identities.find((x:any)=>clean(x.email).toLowerCase()===from)
 const drafts=mailboxes.find((x:any)=>x.role==='drafts'),sent=mailboxes.find((x:any)=>x.role==='sent')
 if(!identity?.id||!drafts?.id||!sent?.id)throw new Error('Stalwart sender identity or mailboxes missing')
 const body='<h2>New Oculivo Demo Request</h2><p><strong>Name:</strong> '+escapeHtml(contact.name)+'</p><p><strong>Email:</strong> '+escapeHtml(contact.email)+'</p><p><strong>Practice:</strong> '+escapeHtml(contact.practice)+'</p><p><strong>Specialty:</strong> '+escapeHtml(contact.specialty)+'</p><p><strong>Locations:</strong> '+escapeHtml(contact.locations)+'</p><p>Review this lead in the RomyLabs Admin Portal &gt; Demo Leads &amp; Tasks.</p><p>Lead ID: '+escapeHtml(leadId)+'</p>'
 const email={from:[{email:from,name:'Oculivo Demo Alerts'}],to:[{email:'romy@romylabs.com'}],subject:'[Oculivo] New demo request — '+clean(contact.practice,100),mailboxIds:{[drafts.id]:true},keywords:{$draft:true},bodyValues:{body:{value:body,charset:'utf-8'}},htmlBody:[{partId:'body',type:'text/html'}]}
 const reply=await fetch(api,{method:'POST',headers,body:JSON.stringify({using,methodCalls:[['Email/set',{accountId,create:{draft:email}},'e0'],['EmailSubmission/set',{accountId,create:{sendIt:{emailId:'#draft',identityId:identity.id}},onSuccessUpdateEmail:{'#sendIt':{['mailboxIds/'+drafts.id]:null,['mailboxIds/'+sent.id]:true,'keywords/$draft':null}}},'s0']]}),signal:AbortSignal.timeout(15000)})
 if(!reply.ok)throw new Error('Stalwart submission HTTP '+reply.status)
 const result=await reply.json()
 const submission=result.methodResponses?.find((x:any)=>x[0]==='EmailSubmission/set')?.[1]
 if(submission?.notCreated?.sendIt||!submission?.created?.sendIt?.id)throw new Error('Stalwart did not confirm email submission')
 return String(submission.created.sendIt.id)
}

Deno.serve(async req=>{
 if(req.method!=='POST')return json({ok:false,error:'Method not allowed'},405)
 const expected=Deno.env.get('OCULIVO_LEAD_WEBHOOK_SECRET')||''
 const header=req.headers.get('authorization')||''
 if(!secretMatches(header.startsWith('Bearer ')?header.slice(7):'',expected))return json({ok:false,error:'Unauthorized'},401)
 let body:any
 try{const raw=await req.text();if(raw.length>8192)return json({ok:false,error:'Payload too large'},413);body=JSON.parse(raw)}
 catch{return json({ok:false,error:'Invalid JSON'},400)}
 if(body?.product!=='oculivo'||body?.event!=='demo_request'||body?.source!=='oculivo.com'||!body?.consent)return json({ok:false,error:'Invalid Oculivo lead event'},400)
 const c=body.contact||{}
 const name=clean(c.name,120),email=clean(c.email,254).toLowerCase(),practice=clean(c.practice,160),specialty=clean(c.specialty,40),locations=clean(c.locations,12),notes=clean(c.message,900)
 if(!name||!practice||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!['optometry','ophthalmology','optical','multi-specialty','other'].includes(specialty)||!['1','2-5','6+'].includes(locations))return json({ok:false,error:'Invalid contact details'},400)
 const url=Deno.env.get('SUPABASE_URL')||'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
 if(!url||!key)return json({ok:false,error:'Lead intake unavailable'},503)
 const admin=createClient(url,key,{auth:{persistSession:false}})
 const attribution=body.attribution&&typeof body.attribution==='object'&&!Array.isArray(body.attribution)?Object.fromEntries(['utm_source','utm_medium','utm_campaign','landing_path'].map(k=>[k,clean(body.attribution[k],120)])):{}
 const {data:lead,error}=await admin.from('romylabs_demo_requests').insert({
   product_id:'oculivo',source:'oculivo.com',lead_name:name,lead_email:email,practice_name:practice,specialty,locations,notes,attribution
 }).select('id').single()
 if(error||!lead?.id){console.error('[oculivo-demo-intake] lead database insert failed',error?.code||'unknown');return json({ok:false,error:'Lead could not be saved'},503)}
 try{
  const submissionId=await submitStalwartEmail(admin,{name,email,practice,specialty,locations},String(lead.id))
  await admin.from('romylabs_demo_requests').update({notification_submission_id:submissionId,notification_submitted_at:new Date().toISOString(),notification_last_error:null}).eq('id',lead.id)
  return json({ok:true,notification_submitted:true})
 }catch(e){
  const detail=e instanceof Error?e.message:'Notification failed'
  console.error('[oculivo-demo-intake] email submission pending',detail)
  await admin.from('romylabs_demo_requests').update({notification_last_error:detail.slice(0,250)}).eq('id',lead.id)
  // Lead is durably saved and a follow-up task is visible even when mail fails.
  return json({ok:true,notification_submitted:false})
 }
})
