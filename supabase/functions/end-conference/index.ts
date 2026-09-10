import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL=Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY=Deno.env.get('SUPABASE_ANON_KEY')!
const corsHeaders={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}})

serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:corsHeaders})
  try{
    const authHeader=req.headers.get('authorization')||''
    if(!authHeader.toLowerCase().startsWith('bearer ')) return json({error:'Unauthorized'},401)
    const token=authHeader.slice(7).trim()
    const authClient=createClient(SUPABASE_URL,ANON_KEY,{global:{headers:{Authorization:`Bearer ${token}`}}})
    const {data:{user},error:userErr}=await authClient.auth.getUser(token)
    if(userErr||!user?.email) return json({error:'Unauthorized'},401)
    const {conferenceName,phoneContext}=await req.json()
    if(!conferenceName||!/^[A-Za-z0-9_-]+$/.test(conferenceName)) return json({error:'valid conferenceName required'},400)

    const db=createClient(SUPABASE_URL,SERVICE_KEY)
    const {data:isPlatformAdmin}=await authClient.rpc('_is_platform_admin')
    const isRomyLabs=phoneContext==='romylabs'&&isPlatformAdmin===true
    const {data:emp}=await db.from('employees').select('tenant_id,status').ilike('email',user.email).limit(1).maybeSingle()
    const tenantId=isRomyLabs?'a0000000-0000-0000-0000-000000000001':emp?.tenant_id
    if(!tenantId||(!isRomyLabs&&String(emp?.status||'Active').toLowerCase()!=='active')) return json({error:'Unauthorized'},403)
    let {data:settings,error:sErr}=await db.from('settings').select('sw_space_url,sw_project_id,sw_api_token').eq('tenant_id',tenantId).limit(1).maybeSingle()
    if(isRomyLabs&&(!settings?.sw_space_url||!settings?.sw_project_id||!settings?.sw_api_token)){
      const f=await db.from('settings').select('sw_space_url,sw_project_id,sw_api_token').eq('tenant_id','61a89aef-0e7e-4ea2-b222-44ab2024655a').limit(1).maybeSingle()
      if(f.data)settings=f.data;if(!sErr)sErr=f.error
    }
    if(sErr||!settings?.sw_space_url||!settings?.sw_project_id||!settings?.sw_api_token) return json({error:'SignalWire credentials missing for this calling context.'},400)

    // Validate ownership by durable conference identity, regardless of DB status.
    // The previous active-status filter raced with the browser marking a call
    // completed, causing this endpoint to skip provider termination while the
    // PSTN/cell leg remained connected.
    const [{data:inConf},{data:outConf}]=await Promise.all([
      db.from('incoming_calls').select('id,callsid,status').eq('tenant_id',tenantId).eq('conference_name',conferenceName)
        .order('created_at',{ascending:false}).limit(1).maybeSingle(),
      db.from('outbound_calls').select('id,provider_call_sid,status').eq('tenant_id',tenantId).eq('conference_name',conferenceName)
        .order('created_at',{ascending:false}).limit(1).maybeSingle(),
    ])
    if(!inConf&&!outConf) return json({error:'Conference does not belong to this calling context.'},403)

    const spaceDomain=settings.sw_space_url.replace(/^https?:\/\//,'')
    const providerAuth='Basic '+btoa(`${settings.sw_project_id}:${settings.sw_api_token}`)
    const base=`https://${spaceDomain}/api/laml/2010-04-01/Accounts/${settings.sw_project_id}`
    const providerCallSids=new Set<string>()
    if(inConf?.callsid)providerCallSids.add(String(inConf.callsid))
    if(outConf?.provider_call_sid)providerCallSids.add(String(outConf.provider_call_sid))

    let conferenceSid=''
    try{
      const confResp=await fetch(`${base}/Conferences.json?FriendlyName=${encodeURIComponent(conferenceName)}&Status=in-progress`,{headers:{Authorization:providerAuth}})
      if(confResp.ok){
        const confData=await confResp.json()
        conferenceSid=String(confData?.conferences?.[0]?.sid||'')
      }else{
        console.error('end-conference conference lookup failed',confResp.status,await confResp.text())
      }
    }catch(e){console.error('end-conference conference lookup error',e)}

    if(conferenceSid){
      try{
        const partResp=await fetch(`${base}/Conferences/${conferenceSid}/Participants.json`,{headers:{Authorization:providerAuth}})
        if(partResp.ok){
          const partData=await partResp.json()
          for(const p of partData?.participants||[]){if(p?.call_sid)providerCallSids.add(String(p.call_sid))}
        }else console.error('end-conference participant lookup failed',partResp.status,await partResp.text())
      }catch(e){console.error('end-conference participant sweep error',e)}
    }

    let providerFailure=false
    for(const callSid of providerCallSids){
      try{
        const kill=await fetch(`${base}/Calls/${encodeURIComponent(callSid)}.json`,{
          method:'POST',headers:{Authorization:providerAuth,'Content-Type':'application/x-www-form-urlencoded'},
          body:new URLSearchParams({Status:'completed'})
        })
        if(!kill.ok){providerFailure=true;console.error('end-conference call hangup failed',callSid,kill.status,await kill.text())}
      }catch(e){providerFailure=true;console.error('end-conference call hangup error',callSid,e)}
    }

    if(conferenceSid){
      try{
        const updResp=await fetch(`${base}/Conferences/${conferenceSid}.json`,{
          method:'POST',headers:{Authorization:providerAuth,'Content-Type':'application/x-www-form-urlencoded'},
          body:new URLSearchParams({Status:'completed'})
        })
        if(!updResp.ok){providerFailure=true;console.error('end-conference conference termination failed',updResp.status,await updResp.text())}
      }catch(e){providerFailure=true;console.error('end-conference conference termination error',e)}
    }

    if(providerFailure) return json({error:'Could not confirm every SignalWire call leg ended.'},502)

    await db.from('outbound_calls').update({status:'completed'}).eq('tenant_id',tenantId).eq('conference_name',conferenceName).neq('status','completed')
    await db.from('incoming_calls').update({status:'completed'}).eq('tenant_id',tenantId).eq('conference_name',conferenceName).neq('status','completed')
    return json({ok:true,terminated_call_sids:providerCallSids.size,conference_found:!!conferenceSid})
  }catch(err){console.error('end-conference error:',err);return json({error:'Unable to end conference.'},500)}
})
