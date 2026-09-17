import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const URL = Deno.env.get('SUPABASE_URL')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ADMIN_TENANT = 'a0000000-0000-0000-0000-000000000001'
const FROM_NAME = 'Romy Cruz — TaxRes CRM'
const FROM_EMAIL = 'romy@taxrescrm.net'
const STOP_STAGES = ['Demo Completed','Proposal Sent','Negotiation','Won','Lost']
const cors = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-internal-cron-token' }
const json = (b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,'Content-Type':'application/json'}})
const db = () => createClient(URL,SERVICE)
const first = (name='') => name.trim().split(' ')[0] || 'there'

async function isInternal(req:Request, sb:any){
  const auth=req.headers.get('authorization')||''
  if(SERVICE && auth===`Bearer ${SERVICE}`) return true
  const token=req.headers.get('x-internal-cron-token')||''
  if(!token) return false
  const {data,error}=await sb.rpc('verify_internal_cron_token',{provided:token})
  return !error && data===true
}

async function sendEmail(to:string,subject:string,html:string){
  const res=await fetch(`${URL}/functions/v1/demo-send-email`,{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${SERVICE}`},
    body:JSON.stringify({to,subject,html,tenant_id:ADMIN_TENANT})
  })
  if(!res.ok) console.error('[demo-followup] send failed',res.status,await res.text())
  return res.ok
}

function confirmation(name:string,type:string,when:string){return {subject:`You're confirmed — ${type} with TaxRes CRM`,html:`<p>Hi ${first(name)},</p><p>Your demo is confirmed:</p><p><strong>${type}</strong><br>${when}</p><p>We'll focus on your firm's real tax-resolution workflow.</p><p>Talk soon,<br><strong>Romy Cruz</strong><br>TaxRes CRM</p>`}}
function reminder(name:string,type:string,when:string){return {subject:`Tomorrow — ${type} with TaxRes CRM`,html:`<p>Hi ${first(name)},</p><p>A quick reminder that your TaxRes CRM walkthrough is tomorrow:</p><p><strong>${type}</strong><br>${when}</p><p>If you have a workflow you want to see, reply and let me know.</p><p>Romy Cruz<br>TaxRes CRM</p>`}}
function postDemo(name:string){return {subject:'Thanks for taking a look — TaxRes CRM',html:`<p>Hi ${first(name)},</p><p>Thanks for taking the time today. If anything came up after the walkthrough, reply here and I'll dig into it with you.</p><p><a href="https://taxrescrm.net/resources">Resource Center</a> · <a href="https://taxrescrm.net/pricing">Pricing</a> · <a href="https://taxrescrm.net/features">Features</a></p><p>Romy Cruz<br>TaxRes CRM</p>`}}
function follow3(name:string){return {subject:'Following up — TaxRes CRM',html:`<p>Hi ${first(name)},</p><p>Checking in after our walkthrough. If there is a specific workflow or switching concern you want me to address, reply here and I'll take a look.</p><p>Romy Cruz<br>TaxRes CRM</p>`}}
function follow7(name:string){return {subject:'Last check-in — TaxRes CRM',html:`<p>Hi ${first(name)},</p><p>One last check-in after our walkthrough. If the timing is right later, you can always reach me here or book another demo.</p><p><a href="https://taxrescrm.net/demo">Book a demo</a></p><p>Romy Cruz<br>TaxRes CRM</p>`}}

Deno.serve(async req=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
  if(req.method!=='POST') return json({error:'Method not allowed'},405)
  const sb=db()
  const body=await req.json().catch(()=>({}))
  const action=String(body.action||'sweep')
  const internal=await isInternal(req,sb)

  if(action==='trigger'){
    const eventId=String(body.calevent_id||'')
    if(!eventId) return json({error:'Missing calevent_id'},400)
    const {data:event}=await sb.from('calevents').select('id,"clientName",contact_email,"eventType",date,time,booking_token,tenant_id,product_id,status').eq('id',eventId).maybeSingle()
    if(!event?.contact_email) return json({error:'Booking not found'},404)
    const suppliedToken=String(body.booking_token||'')
    if(!internal && (!event.booking_token || suppliedToken!==event.booking_token)) return json({error:'Unauthorized'},401)
    if(event.product_id && event.product_id!=='taxres_crm') return json({ok:true,skipped:'different_product'})
    const {data:existing}=await sb.from('demo_followup_log').select('id').eq('calevent_id',event.id).limit(1)
    if(existing?.length) return json({ok:true,skipped:'already_started'})
    const when=`${event.date || ''}${event.time ? ` at ${event.time}` : ''}`
    const mail=confirmation(event.clientName||'',event.eventType||'TaxRes CRM Demo',when)
    const sent=await sendEmail(event.contact_email,mail.subject,mail.html)
    const {error:logErr}=await sb.from('demo_followup_log').insert({
      calevent_id:event.id,contact_email:event.contact_email,contact_name:event.clientName||'',event_type:event.eventType||'TaxRes CRM Demo',event_when:when,
      utm_params:'',step_0_sent:sent,step_0_sent_at:sent?new Date().toISOString():null,opted_out:false
    })
    if(logErr) return json({error:logErr.message},500)
    const {data:p}=await sb.from('prospects').select('id').eq('contact_email',event.contact_email).limit(1)
    if(!p?.length) await sb.from('prospects').insert({firm_name:event.clientName||event.contact_email,contact_name:event.clientName||'',contact_email:event.contact_email,product:'taxres_crm',stage:'Demo Scheduled',source:'Direct',demo_date:event.date||new Date().toISOString().slice(0,10),owner:FROM_EMAIL,notes:'Auto-created from verified demo booking.'})
    return json({ok:true,step:0,sent})
  }

  if(action==='opt_out'){
    const eventId=String(body.calevent_id||''), suppliedToken=String(body.booking_token||'')
    if(!eventId) return json({error:'Missing calevent_id'},400)
    const {data:event}=await sb.from('calevents').select('id,booking_token,contact_email').eq('id',eventId).maybeSingle()
    if(!event) return json({error:'Booking not found'},404)
    if(!internal && (!event.booking_token || suppliedToken!==event.booking_token)) return json({error:'Unauthorized'},401)
    await sb.from('demo_followup_log').update({opted_out:true}).eq('calevent_id',event.id)
    return json({ok:true})
  }

  if(action!=='sweep') return json({error:'Unsupported action'},400)
  if(!internal) return json({error:'Unauthorized'},401)

  const now=new Date(),results={checked:0,sent:0,skipped:0}
  const {data:logs,error:logsErr}=await sb.from('demo_followup_log').select('*').eq('opted_out',false).eq('completed',false)
  if(logsErr) return json({error:logsErr.message},500)
  for(const log of logs||[]){
    results.checked++
    const {data:event}=await sb.from('calevents').select('date,time,status').eq('id',log.calevent_id).maybeSingle()
    const {data:prospect}=await sb.from('prospects').select('stage').eq('contact_email',log.contact_email).limit(1).maybeSingle()
    if(prospect && STOP_STAGES.includes(prospect.stage)){await sb.from('demo_followup_log').update({completed:true}).eq('id',log.id);results.skipped++;continue}
    const created=new Date(log.created_at), sinceCreated=(now.getTime()-created.getTime())/3600000
    const eventAt=event?.date ? new Date(`${event.date}T${String(event.time||'09:00').slice(0,5)}:00-04:00`) : null
    const untilEvent=eventAt ? (eventAt.getTime()-now.getTime())/3600000 : null
    const sinceEvent=eventAt ? (now.getTime()-eventAt.getTime())/3600000 : null
    let mail:any=null,patch:any=null
    if(!log.step_1_sent && untilEvent!==null && untilEvent>0 && untilEvent<=25){mail=reminder(log.contact_name,log.event_type,log.event_when);patch={step_1_sent:true,step_1_sent_at:now.toISOString()}}
    else if(!log.step_2_sent && sinceEvent!==null && sinceEvent>=2){mail=postDemo(log.contact_name);patch={step_2_sent:true,step_2_sent_at:now.toISOString()}}
    else if(!log.step_3_sent && sinceEvent!==null && sinceEvent>=72){mail=follow3(log.contact_name);patch={step_3_sent:true,step_3_sent_at:now.toISOString()}}
    else if(!log.step_4_sent && sinceEvent!==null && sinceEvent>=168){mail=follow7(log.contact_name);patch={step_4_sent:true,step_4_sent_at:now.toISOString(),completed:true}}
    else if(!eventAt && sinceCreated>192){patch={completed:true}}
    if(mail){const sent=await sendEmail(log.contact_email,mail.subject,mail.html);if(sent){await sb.from('demo_followup_log').update(patch).eq('id',log.id);results.sent++}}
    else if(patch) await sb.from('demo_followup_log').update(patch).eq('id',log.id)
  }
  return json({ok:true,...results})
})
