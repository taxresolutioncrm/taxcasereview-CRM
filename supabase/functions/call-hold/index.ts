import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const corsHeaders = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'}
function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}})}

serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:corsHeaders})
  try{
    const authHeader=req.headers.get('authorization')||''
    if(!authHeader.toLowerCase().startsWith('bearer ')) return json({error:'Unauthorized'},401)
    const token=authHeader.slice(7).trim()
    const authClient=createClient(SUPABASE_URL,ANON_KEY,{global:{headers:{Authorization:`Bearer ${token}`}}})
    const {data:{user},error:userErr}=await authClient.auth.getUser(token)
    if(userErr||!user?.email) return json({error:'Unauthorized'},401)

    const {conference_name,hold,phoneContext}=await req.json()
    if(!conference_name||typeof hold!=='boolean') return json({error:'conference_name and hold (boolean) required'},400)
    if(!/^[A-Za-z0-9_-]+$/.test(conference_name)) return json({error:'invalid conference name'},400)

    const db=createClient(SUPABASE_URL,SERVICE_KEY)
    const {data:isPlatformAdmin}=await authClient.rpc('_is_platform_admin')
    const isRomyLabs=phoneContext==='romylabs'&&isPlatformAdmin===true
    const {data:emp}=await db.from('employees').select('tenant_id,status').ilike('email',user.email).limit(1).maybeSingle()
    const tenantId=isRomyLabs?'a0000000-0000-0000-0000-000000000001':emp?.tenant_id
    if(!tenantId||(!isRomyLabs&&String(emp?.status||'Active').toLowerCase()!=='active')) return json({error:'Unauthorized'},403)

    let {data:settings,error:sErr}=await db.from('settings').select('sw_space_url,sw_project_id,sw_api_token,sw_inbound_did').eq('tenant_id',tenantId).limit(1).maybeSingle()
    if(isRomyLabs&&(!settings?.sw_space_url||!settings?.sw_project_id||!settings?.sw_api_token)){
      const f=await db.from('settings').select('sw_space_url,sw_project_id,sw_api_token,sw_inbound_did').eq('tenant_id','61a89aef-0e7e-4ea2-b222-44ab2024655a').limit(1).maybeSingle()
      if(f.data)settings=f.data;if(!sErr)sErr=f.error
    }
    if(sErr||!settings?.sw_space_url||!settings?.sw_project_id||!settings?.sw_api_token) return json({error:'SignalWire credentials missing for this calling context.'},400)

    const [{data:inConf},{data:outConf}]=await Promise.all([
      db.from('incoming_calls').select('id').eq('tenant_id',tenantId).eq('conference_name',conference_name)
        .in('status',['ringing','answered']).limit(1).maybeSingle(),
      db.from('outbound_calls').select('id').eq('tenant_id',tenantId).eq('conference_name',conference_name)
        .in('status',['pending','ringing','answered','connected']).limit(1).maybeSingle(),
    ])
    if(!inConf&&!outConf) return json({error:'Call not found — it may have already ended.'},404)

    const spaceDomain=settings.sw_space_url.replace(/^https?:\/\//,'')
    const providerAuth='Basic '+btoa(`${settings.sw_project_id}:${settings.sw_api_token}`)
    const base=`https://${spaceDomain}/api/laml/2010-04-01/Accounts/${settings.sw_project_id}`
    const holdUrl=`${SUPABASE_URL}/functions/v1/hold-music`
    let businessNumber=settings.sw_inbound_did||''
    if(isRomyLabs){const {data:adminPhone}=await db.from('settings').select('sw_inbound_did').eq('tenant_id','a0000000-0000-0000-0000-000000000001').limit(1).maybeSingle();businessNumber=adminPhone?.sw_inbound_did||''}
    const businessDigits=businessNumber.replace(/\D/g,'').slice(-10)
    const confResp=await fetch(`${base}/Conferences.json?FriendlyName=${encodeURIComponent(conference_name)}&Status=in-progress`,{headers:{Authorization:providerAuth}})
    const confData=await confResp.json()
    const conf=confData?.conferences?.[0]
    if(!conf?.sid) return json({error:'Call not found — it may have already ended.'},404)

    const partResp=await fetch(`${base}/Conferences/${conf.sid}/Participants.json`,{headers:{Authorization:providerAuth}})
    const partData=await partResp.json()
    let touched=0
    for(const p of partData?.participants||[]){
      const callSid=p.call_sid
      if(!callSid) continue
      let isAgent=false
      try{
        const callResp=await fetch(`${base}/Calls/${callSid}.json`,{headers:{Authorization:providerAuth}})
        const call=await callResp.json()
        const fromD=(call?.from||'').replace(/\D/g,'').slice(-10)
        const toD=(call?.to||'').replace(/\D/g,'').slice(-10)
        isAgent=!!businessDigits&&fromD===businessDigits&&toD===businessDigits
      }catch(e){console.error('call-hold call fetch failed',callSid,e)}
      if(isAgent) continue
      const holdBody:Record<string,string>={Hold:hold?'true':'false'}
      if(hold){
        // SignalWire does not guarantee audible media when HoldUrl is omitted.
        // Point held remote legs at our public LaML endpoint so hold is never silent.
        holdBody.HoldUrl=holdUrl
        holdBody.HoldMethod='POST'
      }
      const upd=await fetch(`${base}/Conferences/${conf.sid}/Participants/${callSid}.json`,{method:'POST',headers:{Authorization:providerAuth,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(holdBody)})
      if(upd.ok) touched++; else console.error('call-hold participant update failed',callSid,upd.status,await upd.text())
    }
    if(touched===0) return json({error:'No caller leg found to '+(hold?'hold':'resume')+'.'},404)
    return json({ok:true,participants:touched})
  }catch(err){console.error('call-hold error:',err);return json({error:'Unable to change hold state.'},500)}
})
