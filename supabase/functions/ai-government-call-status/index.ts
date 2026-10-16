import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const SUPABASE_URL=Deno.env.get('SUPABASE_URL')!,SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
serve(async req=>{
  const u=new globalThis.URL(req.url),id=u.searchParams.get('session')||'',token=u.searchParams.get('token')||''
  const db=createClient(SUPABASE_URL,SERVICE)
  const {data:s}=await db.from('ai_government_call_sessions').select('id,tenant_id,outbound_call_id,status,callback_token').eq('id',id).eq('callback_token',token).limit(1).maybeSingle()
  if(!s) return new Response('forbidden',{status:403})
  const form=await req.formData().catch(()=>null)
  const callStatus=String(form?.get('CallStatus')||form?.get('CallStatus')||'completed')
  const terminal=callStatus==='completed'?'completed':(['busy','failed','no-answer','canceled'].includes(callStatus)?'failed':null)
  if(terminal){
    const now=new Date().toISOString()
    await db.from('ai_government_call_sessions').update({status:terminal,ended_at:now,last_action:'provider:'+callStatus,updated_at:now}).eq('id',id).not('status','eq','cancelled')
    if(s.outbound_call_id) await db.from('outbound_calls').update({status:'completed'}).eq('id',s.outbound_call_id)
    await db.from('ai_government_call_events').insert({tenant_id:s.tenant_id,session_id:id,event_type:'provider_completed',action:callStatus,meta:{}})
  }
  return new Response('ok',{status:200})
})
