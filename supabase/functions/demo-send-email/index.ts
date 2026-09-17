import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DEMO_TENANT='a0000000-0000-0000-0000-000000000001'
const DEMO_LOGIN='demo@taxrescrm.net'
const FROM='romy@taxrescrm.net'
const BRAND='TaxRes CRM'
const LOGO='https://taxrescrm.app/taxrescrm-logo.png'
const APP='https://taxrescrm.app'
const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type,x-internal-cron-token',
  'Content-Type':'application/json',
  'Cache-Control':'no-store',
}
const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:cors})
const safe=(v:any)=>String(v??'').replace(/[\r\n]+/g,' ').trim()
const esc=(v:any)=>String(v??'').replace(/[&<>"']/g,(c:string)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c))
const validEmail=(v:any)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safe(v))
const strip=(v:any)=>String(v??'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()

function wrap(inner:string){
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#172033">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:28px 14px"><tr><td align="center">
  <table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
  <tr><td style="background:#0b1f33;padding:24px 34px;text-align:center"><img src="${LOGO}" alt="TaxRes CRM" style="display:block;max-width:220px;max-height:64px;margin:0 auto"/></td></tr>
  <tr><td style="padding:32px 36px;font-size:14px;line-height:1.7">${inner}</td></tr>
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 30px;text-align:center;font-size:11px;color:#64748b">TaxRes CRM · <a href="https://taxrescrm.net" style="color:#2563eb">taxrescrm.net</a> · ${FROM}</td></tr>
  </table></td></tr></table></body></html>`
}

async function internalAuthorized(req:Request,admin:any){
  const auth=req.headers.get('authorization')||''
  const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
  if(service&&auth===`Bearer ${service}`)return true
  const token=req.headers.get('x-internal-cron-token')||''
  if(!token)return false
  const {data,error}=await admin.rpc('verify_internal_cron_token',{provided:token})
  return !error&&data===true
}

async function authenticatedDemo(req:Request,url:string,anon:string,admin:any){
  const auth=req.headers.get('authorization')||''
  if(!auth.startsWith('Bearer '))return null
  const jwt=auth.slice(7)
  const client=createClient(url,anon,{global:{headers:{Authorization:`Bearer ${jwt}`}},auth:{persistSession:false,autoRefreshToken:false}})
  const {data:{user}}=await client.auth.getUser(jwt)
  if(!user?.email)return null
  const {data:tenant}=await client.rpc('current_tenant_id')
  if(String(tenant)!==DEMO_TENANT||String(user.email).toLowerCase()!==DEMO_LOGIN)return null
  const {data:emp}=await admin.from('employees').select('status,perm_comms').eq('tenant_id',DEMO_TENANT).ilike('email',DEMO_LOGIN).maybeSingle()
  if(!emp||String(emp.status||'Active').toLowerCase()!=='active'||Number(emp.perm_comms||0)<2)throw new Error('Demo email permission denied')
  return user
}

async function transport(admin:any){
  const {data:t,error}=await admin.rpc('romylabs_stalwart_transport_for_product',{p_product_key:'taxres_crm'})
  if(error||!t?.ok||!t?.username||!t?.password)throw new Error('TaxRes CRM Stalwart transport unavailable')
  const from=safe(t.from_address||t.username).toLowerCase()
  if(from!==FROM)throw new Error(`TaxRes CRM sender mismatch: expected ${FROM}, got ${from||'none'}`)
  return {host:safe(t.host||'mail.taxrescrm.net'),username:safe(t.username),password:String(t.password),from}
}

async function sendJmap(admin:any,to:string,subject:string,html:string){
  const t=await transport(admin)
  const base='https://'+t.host.replace(/^https?:\/\//,'').replace(/\/$/,'')
  const auth='Basic '+btoa(`${t.username}:${t.password}`)
  const sessionRes=await fetch(base+'/.well-known/jmap',{headers:{Authorization:auth,Accept:'application/json'}})
  if(!sessionRes.ok)throw new Error(`TaxRes CRM mail session failed (${sessionRes.status})`)
  const session=await sessionRes.json()
  const accountId=session?.primaryAccounts?.['urn:ietf:params:jmap:mail']||Object.keys(session?.accounts||{})[0]
  const apiUrl=String(session?.apiUrl||'').replace('{accountId}','')
  if(!apiUrl||!accountId)throw new Error('TaxRes CRM mail account unavailable')
  const metaRes=await fetch(apiUrl,{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({using:['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail','urn:ietf:params:jmap:submission'],methodCalls:[['Identity/get',{accountId},'i0'],['Mailbox/get',{accountId,properties:['id','name','role']},'m0']]})})
  if(!metaRes.ok)throw new Error(`TaxRes CRM mail metadata failed (${metaRes.status})`)
  const meta=await metaRes.json()
  const ids=(meta.methodResponses||[]).find((x:any)=>x?.[0]==='Identity/get')?.[1]?.list||[]
  const boxes=(meta.methodResponses||[]).find((x:any)=>x?.[0]==='Mailbox/get')?.[1]?.list||[]
  const identity=ids.find((x:any)=>String(x.email||'').toLowerCase()===FROM)
  const drafts=boxes.find((x:any)=>String(x.role||'').toLowerCase()==='drafts')
  const sent=boxes.find((x:any)=>String(x.role||'').toLowerCase()==='sent')
  if(!identity?.id||!drafts?.id||!sent?.id)throw new Error('TaxRes CRM mail identity or Sent/Drafts mailbox unavailable')
  const bodyId='body'
  const sendRes=await fetch(apiUrl,{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({using:['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail','urn:ietf:params:jmap:submission'],methodCalls:[['Email/set',{accountId,create:{draft:{from:[{email:FROM,name:BRAND}],to:[{email:to}],replyTo:[{email:FROM}],subject,mailboxIds:{[drafts.id]:true},keywords:{'$draft':true},bodyValues:{[bodyId]:{value:html,charset:'utf-8'}},htmlBody:[{partId:bodyId,type:'text/html'}]}}},'e0'],['EmailSubmission/set',{accountId,create:{sendIt:{emailId:'#draft',identityId:identity.id}},onSuccessUpdateEmail:{'#sendIt':{['mailboxIds/'+drafts.id]:null,['mailboxIds/'+sent.id]:true,'keywords/$draft':null}}},'s0']]})})
  if(!sendRes.ok)throw new Error(`TaxRes CRM mail send failed (${sendRes.status})`)
  const payload=await sendRes.json()
  const submission=payload?.methodResponses?.find((x:any)=>x?.[0]==='EmailSubmission/set')?.[1]
  const rejected=submission?.notCreated?.sendIt
  if(rejected)throw new Error(rejected.description||rejected.type||'TaxRes CRM mail rejected')
  const id=submission?.created?.sendIt?.id
  if(!id)throw new Error('TaxRes CRM mail submission was not confirmed')
  return String(id)
}

async function logSent(admin:any,to:string,subject:string,html:string,submissionId:string){
  const stamp=new Date().toISOString()
  const row={tenant_id:DEMO_TENANT,recipient:to,recipients:[to],subject,body:strip(html),body_html:html,triage:'Sent',status:'Sent',direction:'outbound',is_read:true,sender:FROM,from_address:FROM,reply_from:FROM,mailbox_owner:DEMO_LOGIN,received_at:stamp,created_at:stamp,product_id:'taxres_crm',message_id:`stalwart:${submissionId}`,received_mailbox:FROM}
  const {error}=await admin.from('emails').insert(row)
  if(error)console.error('[demo-send-email] sent log failed',error.message)
}

async function deliver(admin:any,to:any,subject:any,html:any,text:any){
  const recipient=safe(Array.isArray(to)?to[0]:to).toLowerCase()
  if(!validEmail(recipient))throw new Error('Valid recipient email required')
  const cleanSubject=safe(subject)
  if(!cleanSubject)throw new Error('Subject required')
  const inner=html?String(html):`<p>${esc(String(text||'')).replace(/\n/g,'<br>')}</p>`
  const branded=String(inner).includes('taxrescrm-logo.png')?String(inner):wrap(inner)
  const submissionId=await sendJmap(admin,recipient,cleanSubject,branded)
  await logSent(admin,recipient,cleanSubject,branded,submissionId)
  return {ok:true,via:'taxrescrm_stalwart',from:FROM,submission_id:submissionId}
}

function bookingHtml(kind:string,ev:any){
  const name=esc(ev.clientName||'there'),typ=esc(ev.eventType||'Appointment')
  const date=new Date(String(ev.date)+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})
  const [h,m]=String(ev.time||'09:00').slice(0,5).split(':').map(Number),when=`${date} at ${((h+11)%12)+1}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'} (Eastern)`
  if(kind==='booking_confirmation')return {to:ev.contact_email,subject:`Appointment Confirmed — ${safe(ev.eventType||'Appointment')}`,html:`<p>Hi <strong>${name}</strong>,</p><p>Your appointment is confirmed:</p><p><strong>${typ}</strong><br>${esc(when)}</p><p>Need to make a change? Reply to this email.</p><p>Talk soon,<br><strong>TaxRes CRM</strong></p>`}
  if(kind==='booking_cancel_confirmation')return {to:ev.contact_email,subject:`Appointment Canceled — ${safe(ev.eventType||'Appointment')}`,html:`<p>Hi <strong>${name}</strong>,</p><p>Your <strong>${typ}</strong> on ${esc(when)} has been canceled.</p><p>If you need another time, reply to this email.</p>`}
  if(kind==='booking_cancel_firm_notification')return {to:FROM,subject:`Booking canceled: ${safe(ev.clientName||'Client')}`,html:`<p><strong>${name}</strong> canceled their <strong>${typ}</strong> on ${esc(when)}.</p>`}
  if(kind==='booking_reschedule_firm_notification')return {to:FROM,subject:`Booking rescheduled: ${safe(ev.clientName||'Client')}`,html:`<p><strong>${name}</strong> rescheduled their <strong>${typ}</strong> to ${esc(when)}.</p>`}
  return {to:FROM,subject:`New booking: ${safe(ev.clientName||'Client')}`,html:`<p><strong>${name}</strong> just booked online:</p><p><strong>${typ}</strong><br>${esc(when)}<br>Email: ${esc(ev.contact_email||'—')}</p>`}
}

serve(async(req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  if(req.method!=='POST')return json({error:'Method not allowed'},405)
  try{
    const url=Deno.env.get('SUPABASE_URL')||'',service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',anon=Deno.env.get('SUPABASE_ANON_KEY')||''
    if(!url||!service||!anon)return json({error:'Server configuration missing'},500)
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
    const body=await req.json().catch(()=>({}))
    const kind=safe(body.kind)
    const user=await authenticatedDemo(req,url,anon,admin)
    const internal=await internalAuthorized(req,admin)

    if(user){
      return json(await deliver(admin,body.to,body.subject,body.html,body.text))
    }

    if(kind.startsWith('booking_')&&body.booking_token){
      const {data:ev,error}=await admin.from('calevents').select('booking_token,clientName,eventType,date,time,contact_email,tenant_id,product_id,status').eq('booking_token',safe(body.booking_token)).maybeSingle()
      if(error||!ev)return json({error:'Invalid booking token'},403)
      if(String(ev.tenant_id)!==DEMO_TENANT)return json({passthrough:true},409)
      const mail=bookingHtml(kind,ev)
      return json(await deliver(admin,mail.to,mail.subject,mail.html,''))
    }

    if(kind==='esign_signed_copy'&&body.esign_id){
      const {data:e,error}=await admin.from('esigns').select('id,status,tenant_id,client_email,client_name,doc_type,signed_at,signed_copy_sent_at').eq('id',safe(body.esign_id)).maybeSingle()
      if(error||!e)return json({error:'Invalid signing request'},403)
      if(String(e.tenant_id)!==DEMO_TENANT)return json({passthrough:true},409)
      if(String(e.status)!=='Signed')return json({error:'Signing request is not signed'},409)
      if(e.signed_copy_sent_at)return json({ok:true,already_sent:true,from:FROM})
      const html=`<p>Dear <strong>${esc(e.client_name||'Client')}</strong>,</p><p>Thank you — your signed <strong>${esc(e.doc_type||'document')}</strong> was received${e.signed_at?' on '+esc(new Date(e.signed_at).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})):''} and saved to your file.</p><p>If anything looks wrong, reply to this email and we will correct it.</p><p>Sincerely,<br><strong>TaxRes CRM</strong></p>`
      const result=await deliver(admin,e.client_email,`Signed Copy: ${safe(e.doc_type||'Document')} — TaxRes CRM`,html,'')
      await admin.from('esigns').update({signed_copy_sent_at:new Date().toISOString()}).eq('id',e.id)
      return json(result)
    }

    if(kind==='employee_timeoff_notification'&&body.employee_portal_token){
      const {data:s}=await admin.from('employee_portal_sessions').select('employee_id,employee_name,tenant_id,expires_at').eq('token',safe(body.employee_portal_token)).gt('expires_at',new Date().toISOString()).maybeSingle()
      if(!s)return json({error:'Invalid or expired employee session'},403)
      if(String(s.tenant_id)!==DEMO_TENANT)return json({passthrough:true},409)
      const html=`<p><strong>${esc(s.employee_name||'Employee')}</strong> submitted a ${esc(String(body.request_type||'time off').toUpperCase())} request.</p><p>${esc(body.start_date)} to ${esc(body.end_date)} (${esc(body.days)} day(s)).</p><p>Review it in the Demo CRM under Time Off.</p>`
      return json(await deliver(admin,FROM,`Time off request — ${safe(s.employee_name||'Employee')}`,html,''))
    }

    if(internal&&String(body.tenant_id||'')===DEMO_TENANT){
      return json(await deliver(admin,body.to,body.subject,body.html,body.text))
    }

    return json({passthrough:true},409)
  }catch(e){
    console.error('[demo-send-email]',e)
    return json({error:e?.message||'Demo email send failed'},500)
  }
}))
