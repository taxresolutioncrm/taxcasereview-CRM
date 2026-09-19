// formacorp-bizee-webhook
// Inbound Bizee partner status/document webhook.
// Exact signature/header validation is intentionally configurable until Bizee
// supplies the official webhook contract.
//
// Required once provided by Bizee:
//   BIZEE_PARTNER_WEBHOOK_SECRET
//   BIZEE_PARTNER_WEBHOOK_SECRET_HEADER
//   BIZEE_PARTNER_WEBHOOK_ORDER_ID_FIELD
//   BIZEE_PARTNER_WEBHOOK_EVENT_ID_FIELD
//   BIZEE_PARTNER_WEBHOOK_EVENT_TYPE_FIELD
//   BIZEE_PARTNER_WEBHOOK_STATUS_FIELD
// Optional:
//   BIZEE_PARTNER_STATUS_MAP_JSON

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}
})
function readField(value:any,path:string){
  return path.split('.').filter(Boolean).reduce((cur,key)=>cur==null?undefined:cur[key],value)
}

function statusMap(){
  const raw=(Deno.env.get('BIZEE_PARTNER_STATUS_MAP_JSON')||'{}').trim()
  let value:any
  try{value=JSON.parse(raw)}catch{throw new Error('BIZEE_PARTNER_STATUS_MAP_JSON is not valid JSON')}
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error('BIZEE_PARTNER_STATUS_MAP_JSON must be a JSON object')
  return value
}

async function applyStatusToCase(admin:any,caseId:string,providerStatus:string){
  const crmStatus=String(statusMap()[providerStatus]||'')
  if(!crmStatus) return
  const allowed=new Set(['Draft','Ready to Submit','Filing Queue','Submitted to Florida','Under State Review','Action Required','Approved / Active'])
  if(!allowed.has(crmStatus)) throw new Error('BIZEE_PARTNER_STATUS_MAP_JSON contains an invalid CRM status')
  const {data:caseRow,error:caseErr}=await admin.from('formacorp').select('id,state,fl_submitted_at').eq('id',caseId).maybeSingle()
  if(caseErr) throw caseErr
  if(!caseRow||caseRow.state!=='FL') return
  const patch:any={fl_filing_status:crmStatus,stage:'State Filing'}
  const now=new Date().toISOString()
  if(crmStatus==='Submitted to Florida') patch.fl_submitted_at=caseRow.fl_submitted_at||now
  if(crmStatus==='Approved / Active'||crmStatus==='Action Required') patch.fl_decision_at=now
  const {error:updateErr}=await admin.from('formacorp').update(patch).eq('id',caseId)
  if(updateErr) throw updateErr
}

serve(async req=>{
  if(req.method!=='POST') return json({error:'Method not allowed'},405)
  try{
    const secret=Deno.env.get('BIZEE_PARTNER_WEBHOOK_SECRET')||''
    const header=(Deno.env.get('BIZEE_PARTNER_WEBHOOK_SECRET_HEADER')||'').trim().toLowerCase()
    const orderField=(Deno.env.get('BIZEE_PARTNER_WEBHOOK_ORDER_ID_FIELD')||'').trim()
    const eventIdField=(Deno.env.get('BIZEE_PARTNER_WEBHOOK_EVENT_ID_FIELD')||'').trim()
    const eventTypeField=(Deno.env.get('BIZEE_PARTNER_WEBHOOK_EVENT_TYPE_FIELD')||'').trim()
    const statusField=(Deno.env.get('BIZEE_PARTNER_WEBHOOK_STATUS_FIELD')||'').trim()
    if(!secret||!header||!orderField||!eventIdField||!eventTypeField||!statusField){
      return json({error:'Bizee webhook contract is not configured'},503)
    }
    if((req.headers.get(header)||'')!==secret) return json({error:'Unauthorized'},401)

    const body=await req.json()
    const eventId=String(readField(body,eventIdField)||'')
    const orderId=String(readField(body,orderField)||'')
    const eventType=String(readField(body,eventTypeField)||'')
    const eventStatus=String(readField(body,statusField)||'')
    if(!orderId) return json({error:'Missing configured provider order id'},400)

    const admin=createClient(
      Deno.env.get('SUPABASE_URL')||'',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',
      {auth:{persistSession:false}}
    )

    const {data:reqRow,error:reqErr}=await admin.from('formacorp_service_requests')
      .select('id,tenant_id,case_id')
      .eq('provider','bizee').eq('provider_order_id',orderId).maybeSingle()
    if(reqErr) throw reqErr
    if(!reqRow) return json({ok:true,ignored:true,reason:'unknown_order'})

    const {error:eventErr}=await admin.from('formacorp_provider_events').upsert({
      tenant_id:reqRow.tenant_id,
      case_id:reqRow.case_id,
      service_request_id:reqRow.id,
      provider:'bizee',
      provider_event_id:eventId||null,
      event_type:eventType||null,
      event_status:eventStatus||null,
      payload:body,
      received_at:new Date().toISOString(),
    }, eventId ? {onConflict:'provider,provider_event_id'} : undefined)
    if(eventErr) throw eventErr

    const normalizedStatus=eventStatus||eventType||'updated'
    const {error:updateErr}=await admin.from('formacorp_service_requests').update({
      provider_status:normalizedStatus,
      provider_payload:body,
      provider_last_synced_at:new Date().toISOString(),
      provider_error:null,
    }).eq('id',reqRow.id)
    if(updateErr) throw updateErr

    await applyStatusToCase(admin,reqRow.case_id,normalizedStatus)

    return json({ok:true,status:normalizedStatus})
  }catch(err:any){
    console.error('formacorp-bizee-webhook error',err)
    return json({error:err?.message||'Webhook processing failed'},500)
  }
})
