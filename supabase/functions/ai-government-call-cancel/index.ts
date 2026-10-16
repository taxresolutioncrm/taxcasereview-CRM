import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL=Deno.env.get('SUPABASE_URL')!
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON=Deno.env.get('SUPABASE_ANON_KEY')!
const PRIMARY='61a89aef-0e7e-4ea2-b222-44ab2024655a'
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'}
const json=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,'Content-Type':'application/json'}})

serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  try{
    const auth=req.headers.get('authorization')||''
    const token=auth.replace(/^Bearer\s+/i,'')
    const caller=createClient(SUPABASE_URL,ANON,{global:{headers:{Authorization:auth}}})
    const {data:{user}}=await caller.auth.getUser(token)
    if(!user?.email)return json({error:'Unauthorized'},401)

    const {data:tenant}=await caller.rpc('current_tenant_id')
    if(!tenant)return json({error:'No active office context'},403)

    const body=await req.json().catch(()=>({}))
    const db=createClient(SUPABASE_URL,SERVICE)
    const {data:s}=await db.from('ai_government_call_sessions').select('*')
      .eq('id',body.session_id).eq('tenant_id',tenant).limit(1).maybeSingle()
    if(!s)return json({error:'AI call not found'},404)
    if(['completed','failed','cancelled'].includes(s.status))return json({ok:true,already_ended:true})

    let settings=(await db.from('settings').select('sw_space_url,sw_project_id,sw_api_token').eq('tenant_id',tenant).limit(1).maybeSingle()).data
    if(!settings?.sw_space_url||!settings?.sw_project_id||!settings?.sw_api_token){
      settings=(await db.from('settings').select('sw_space_url,sw_project_id,sw_api_token').eq('tenant_id',PRIMARY).limit(1).maybeSingle()).data
    }

    if(s.provider_call_sid&&settings?.sw_space_url&&settings?.sw_project_id&&settings?.sw_api_token){
      const space=String(settings.sw_space_url).replace(/^https?:[/][/]/,'')
      const endpoint='https://'+space+'/api/laml/2010-04-01/Accounts/'+settings.sw_project_id+'/Calls/'+encodeURIComponent(s.provider_call_sid)+'.json'
      const providerResponse=await fetch(endpoint,{
        method:'POST',
        headers:{
          Authorization:'Basic '+btoa(settings.sw_project_id+':'+settings.sw_api_token),
          'Content-Type':'application/x-www-form-urlencoded'
        },
        body:new URLSearchParams({Status:'completed'})
      }).catch(()=>null)

      // If SignalWire says the update failed, inspect the call before returning
      // an error. A provider call that already ended should still reconcile cleanly
      // instead of leaving a phantom active session in TaxRes.
      if(!providerResponse?.ok){
        const providerStatus=await fetch(endpoint,{
          headers:{Authorization:'Basic '+btoa(settings.sw_project_id+':'+settings.sw_api_token)}
        }).then(async r=>r.ok?await r.json():null).catch(()=>null)
        const state=String(providerStatus?.status||'').toLowerCase()
        if(!['completed','busy','failed','no-answer','canceled','cancelled'].includes(state)){
          return json({error:'Provider did not confirm the call ended',provider_status:state||null},502)
        }
      }
    }

    const now=new Date().toISOString()
    await db.from('ai_government_call_sessions').update({
      status:'cancelled',ended_at:now,last_action:'cancelled by '+user.email,updated_at:now
    }).eq('id',s.id)
    if(s.outbound_call_id)await db.from('outbound_calls').update({status:'completed'}).eq('id',s.outbound_call_id)
    await db.from('ai_government_call_events').insert({
      tenant_id:tenant,session_id:s.id,event_type:'cancelled',action:'cancelled_by_staff',meta:{email:user.email}
    })
    return json({ok:true})
  }catch(e){
    console.error('[ai-government-call-cancel]',e)
    return json({error:'Unable to cancel AI call'},500)
  }
})
