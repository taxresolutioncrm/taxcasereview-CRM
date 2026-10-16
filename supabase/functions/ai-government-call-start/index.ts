import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const URL=Deno.env.get('SUPABASE_URL')!
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON=Deno.env.get('SUPABASE_ANON_KEY')!
const PRIMARY_TENANT='61a89aef-0e7e-4ea2-b222-44ab2024655a'
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
const json=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}})
const norm=(v:any)=>{const d=String(v||'').replace(/\D/g,'');return d.length===10?'+1'+d:(d.length===11&&d.startsWith('1')?'+'+d:'')}

serve(async req=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
  if(req.method!=='POST') return json({error:'POST only'},405)
  try{
    const auth=req.headers.get('authorization')||''
    if(!auth.toLowerCase().startsWith('bearer ')) return json({error:'Unauthorized'},401)
    const token=auth.slice(7).trim()
    const caller=createClient(URL,ANON,{global:{headers:{Authorization:'Bearer '+token}}})
    const {data:{user},error:userErr}=await caller.auth.getUser(token)
    if(userErr||!user?.email) return json({error:'Unauthorized'},401)
    const {data:tenantId,error:tenantErr}=await caller.rpc('current_tenant_id')
    if(tenantErr||!tenantId) return json({error:'No active office context'},403)

    const db=createClient(URL,SERVICE)
    const {data:isPlatformAdmin}=await caller.rpc('_is_platform_admin')
    const {data:emp}=await db.from('employees').select('name,status,perm_comms').eq('tenant_id',tenantId).ilike('email',user.email).limit(1).maybeSingle()
    const active=emp&&String(emp.status||'Active').toLowerCase()==='active'
    if(!isPlatformAdmin&&(!active||Number(emp?.perm_comms||0)<2)) return json({error:'Phone permission denied'},403)

    const body=await req.json().catch(()=>({}))
    const destination=norm(body.destination_number)
    if(!destination) return json({error:'A valid US government phone number is required'},400)
    const objective=String(body.objective||'').trim()
    if(!objective) return json({error:'Call objective is required'},400)
    const routeHints=Array.isArray(body.route_hints)?body.route_hints.slice(0,20).map((x:any)=>({intent:String(x?.intent||'').slice(0,160),digit:String(x?.digit||'').replace(/[^0-9*#]/g,'').slice(0,4)})).filter((x:any)=>x.intent&&x.digit):[]
    const requestedAssignee=String(body.assigned_to_email||user.email).trim().toLowerCase()
    const {data:assignee}=await db.from('employees').select('name,email,status,perm_comms')
      .eq('tenant_id',tenantId).ilike('email',requestedAssignee).limit(1).maybeSingle()
    if(!assignee||String(assignee.status||'Active').toLowerCase()!=='active'||Number(assignee.perm_comms||0)<1){
      return json({error:'Takeover employee must be an active staff member with communications access'},400)
    }

    let {data:settings,error:sErr}=await db.from('settings').select('sw_space_url,sw_project_id,sw_api_token,sw_inbound_did,sw_outbound_did').eq('tenant_id',tenantId).limit(1).maybeSingle()
    if(!settings?.sw_space_url||!settings?.sw_project_id||!settings?.sw_api_token){
      const fallback=await db.from('settings').select('sw_space_url,sw_project_id,sw_api_token,sw_inbound_did,sw_outbound_did').eq('tenant_id',PRIMARY_TENANT).limit(1).maybeSingle()
      if(fallback.data) settings=fallback.data
      if(!sErr) sErr=fallback.error
    }
    if(sErr||!settings?.sw_space_url||!settings?.sw_project_id||!settings?.sw_api_token) return json({error:'SignalWire calling is not configured'},422)
    // Government calls intentionally present the local direct-return DID first.
    // Ordinary TaxRes outbound calls use the public toll-free DID, but IRS/state
    // representatives need the dedicated direct number when they call back.
    const from=norm(settings.sw_outbound_did||settings.sw_inbound_did)
    if(!from) return json({error:'Outbound caller ID is not configured'},422)

    const callbackToken=crypto.randomUUID()+'-'+crypto.randomUUID()
    const conference='ai-gov-'+crypto.randomUUID().slice(0,18)
    const {data:session,error:insErr}=await db.from('ai_government_call_sessions').insert({
      tenant_id:tenantId,
      client_id:body.client_id||null,
      case_id:body.case_id||null,
      client_name:String(body.client_name||'').slice(0,240)||null,
      requested_by_email:user.email.toLowerCase(),
      requested_by_name:emp?.name||user.email.split('@')[0],
      assigned_to_email:String(assignee.email).toLowerCase(),
      purpose_key:String(body.purpose_key||'custom').slice(0,80),
      agency:String(body.agency||'Government Agency').slice(0,160),
      destination_number:destination,
      objective,
      route_hints:routeHints,
      status:'dialing',
      conference_name:conference,
      callback_token:callbackToken,
    }).select('id').single()
    if(insErr||!session?.id) return json({error:insErr?.message||'Could not create AI call session'},500)

    // Keep a normal outbound_calls row so the existing durable conference,
    // recording and browser-join infrastructure can recognize the call.
    const {data:out,error:outErr}=await db.from('outbound_calls').insert({
      conference_name:conference,destination_number:destination,
      display_name:`AI Government Call — ${String(body.client_name||body.agency||destination).slice(0,160)}`,
      entity_type:'ai-government',status:'pending',tenant_id:tenantId,
      agent_name:emp?.name||user.email,agent_extension:null,
    }).select('id').single()
    if(outErr){
      await db.from('ai_government_call_sessions').update({status:'failed',last_action:'outbound_calls insert failed'}).eq('id',session.id)
      return json({error:outErr.message},500)
    }
    await db.from('ai_government_call_sessions').update({outbound_call_id:out.id}).eq('id',session.id)

    const space=String(settings.sw_space_url).replace(/^https?:\/\//,'')
    const basic='Basic '+btoa(`${settings.sw_project_id}:${settings.sw_api_token}`)
    const legUrl=`${URL}/functions/v1/ai-government-call-leg?session=${encodeURIComponent(session.id)}&token=${encodeURIComponent(callbackToken)}`
    const statusUrl=`${URL}/functions/v1/ai-government-call-status?session=${encodeURIComponent(session.id)}&token=${encodeURIComponent(callbackToken)}`
    const resp=await fetch(`https://${space}/api/laml/2010-04-01/Accounts/${settings.sw_project_id}/Calls.json`,{
      method:'POST',headers:{Authorization:basic,'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({To:destination,From:from,Url:legUrl,Method:'POST',StatusCallback:statusUrl,StatusCallbackEvent:'completed',StatusCallbackMethod:'POST'})
    })
    const raw=await resp.text()
    if(!resp.ok){
      await db.from('ai_government_call_sessions').update({status:'failed',last_action:'SignalWire rejected call: '+raw.slice(0,500)}).eq('id',session.id)
      await db.from('outbound_calls').update({status:'failed',provider_http_status:resp.status,provider_error:raw.slice(0,1000)}).eq('id',out.id)
      return json({error:'SignalWire rejected the AI call'},502)
    }
    let sid:any=null;try{sid=JSON.parse(raw)?.sid||null}catch{}
    if(sid){
      await Promise.all([
        db.from('ai_government_call_sessions').update({provider_call_sid:sid,status:'navigating'}).eq('id',session.id),
        db.from('outbound_calls').update({provider_call_sid:sid,status:'ringing'}).eq('id',out.id)
      ])
    }
    await db.from('ai_government_call_events').insert({tenant_id:tenantId,session_id:session.id,event_type:'started',action:'dial',meta:{destination,agency:body.agency,purpose_key:body.purpose_key,assigned_to_email:String(assignee.email).toLowerCase(),caller_id:from}})
    return json({ok:true,session_id:session.id,agency:String(body.agency||'Government Agency'),conference_name:conference,status:'navigating',assigned_to_email:String(assignee.email).toLowerCase(),caller_id:from})
  }catch(e){
    console.error('[ai-government-call-start]',e)
    return json({error:'Unable to start AI government call'},500)
  }
})
