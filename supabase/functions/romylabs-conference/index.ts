import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const URL=Deno.env.get('SUPABASE_URL')!
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON=Deno.env.get('SUPABASE_ANON_KEY')!
const TENANT='a0000000-0000-0000-0000-000000000001'
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'}
const json=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:{...CORS,'Content-Type':'application/json'}})
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const normalize=(s:unknown)=>{const digits=String(s||'').replace(/\D/g,'');return digits.length===10?'+1'+digits:digits.length===11&&digits.startsWith('1')?'+'+digits:''}
const terminal=new Set(['completed','canceled','cancelled','failed','busy','no-answer'])
const inviteSign=async (message:string)=>{
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(SERVICE),{name:'HMAC',hash:'SHA-256'},false,['sign'])
  const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(message))
  return Array.from(new Uint8Array(signature),b=>b.toString(16).padStart(2,'0')).join('')
}
const safeEqual=(a:string,b:string)=>{
  if(a.length!==b.length)return false
  let result=0
  for(let i=0;i<a.length;i++)result|=a.charCodeAt(i)^b.charCodeAt(i)
  return result===0
}


serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:CORS})
  if(req.method!=='POST')return json({error:'Method not allowed'},405)
  try{
    const auth=req.headers.get('authorization')||''
    if(!/^Bearer\s+\S+$/i.test(auth))return json({error:'Unauthorized'},401)
    const token=auth.replace(/^Bearer\s+/i,'')
    const uc=createClient(URL,ANON,{global:{headers:{Authorization:auth}}})
    const [{data:{user},error:authErr},{data:isAdmin}]=await Promise.all([
      uc.auth.getUser(token),uc.rpc('_is_platform_admin')
    ])
    if(authErr||!user?.email||isAdmin!==true)return json({error:'Forbidden'},403)
    const db=createClient(URL,SERVICE)
    const body=await req.json().catch(()=>({}))
    const action=String(body?.action||'')
    const id=String(body?.outbound_call_id||'')
    if(!UUID.test(id))return json({error:'Valid outbound_call_id required'},400)
    // A call must belong to this user and RomyLabs; status and provider SID
    // must be present before ANY provider operation. Cross-office calls cannot
    // be upgraded or have participants removed.
    const {data:row,error:rowErr}=await db.from('outbound_calls')
      .select('id,tenant_id,conference_name,destination_number,provider_call_sid,status,agent_name')
      .eq('id',id).eq('tenant_id',TENANT).limit(1).maybeSingle()
    if(rowErr||!row||String(row.agent_name||'').toLowerCase()!==user.email.toLowerCase())
      return json({error:'Outbound call not found for this agent'},404)
    if(row.status!=='connected')return json({error:'Call is no longer connected'},409)

    const romyCreds=async()=>{
      let {data:creds}=await db.from('settings').select('sw_space_url,sw_project_id,sw_api_token,sw_inbound_did')
        .eq('tenant_id',TENANT).limit(1).maybeSingle()
      if(!creds?.sw_space_url||!creds?.sw_project_id||!creds?.sw_api_token){
        const r=await db.from('settings').select('sw_space_url,sw_project_id,sw_api_token')
          .eq('tenant_id','61a89aef-0e7e-4ea2-b222-44ab2024655a').limit(1).maybeSingle()
        creds={...creds,...r.data}
      }
      if(!creds?.sw_space_url||!creds?.sw_project_id||!creds?.sw_api_token)throw Error('Phone provider not configured')
      const space=String(creds.sw_space_url).replace(/^https?:\/\//,'').replace(/\/$/,'')
      if(!/^[a-z0-9.-]+\.signalwire\.com$/i.test(space))throw Error('Untrusted phone provider host')
      return {base:'https://'+space+'/api/laml/2010-04-01/Accounts/'+encodeURIComponent(creds.sw_project_id),auth:'Basic '+btoa(creds.sw_project_id+':'+creds.sw_api_token)}
    }
    const creds=await romyCreds()
    const fetchProvider=async(path:string,init:RequestInit={})=>{
      const res=await fetch(creds.base+path,{...init,headers:{...init.headers,Authorization:creds.auth}})
      if(!res.ok)throw Error('Phone provider returned '+res.status)
      return res
    }
    const callSid=String(row.provider_call_sid||'')
    const expected=normalize(row.destination_number)
    if(!UUID.test(callSid)||!expected)return json({error:'Direct call is missing a verified provider leg'},409)

    const conference=String(row.conference_name||'')
    const upgraded=conference.startsWith('outbound-merge-')
    const getRoom=async()=>{
      const data=await (await fetchProvider('/Conferences.json?FriendlyName='+encodeURIComponent(conference)+'&Status=in-progress')).json()
      const sid=String(data?.conferences?.[0]?.sid||'')
      if(!UUID.test(sid))return null
      const list=await (await fetchProvider('/Conferences/'+sid+'/Participants.json')).json()
      return {sid,participants:list?.participants||[]}
    }

    if(action==='upgrade'){
      // Never migrate a direct call without verifying the provider's actual
      // destination leg: a browser or unrelated call ID must fail CLOSED.
      if(upgraded)return json({ok:true,conference_name:conference,already_upgraded:true})
      if(!conference.startsWith('direct-'))return json({error:'Call is not a direct outbound call'},409)
      const leg=await (await fetchProvider('/Calls/'+callSid+'.json')).json()
      if(normalize(leg?.to)!==expected||terminal.has(String(leg?.status||'').toLowerCase()))
        return json({error:'Provider leg does not match this active destination'},409)
      // The user explicitly pressed Add Caller. No direct outbound call
      // is ever moved to a conference merely because it was answered.
      const name='outbound-merge-'+crypto.randomUUID().replace(/-/g,'').slice(0,24)
      const {data:claimed,error:claimErr}=await db.from('outbound_calls')
        .update({conference_name:name}).eq('id',row.id).eq('tenant_id',TENANT)
        .eq('conference_name',conference).eq('status','connected').select('id')
      if(claimErr||!claimed?.length)return json({error:'Call changed before conference upgrade'},409)
      const url=URL+'/functions/v1/join-conference?conf='+encodeURIComponent(name)+'&tenant='+TENANT
      try{
        await fetchProvider('/Calls/'+callSid+'.json',{
          method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
          body:new URLSearchParams({Url:url,Method:'POST'})
        })
      }catch(e){
        await db.from('outbound_calls').update({conference_name:conference})
          .eq('tenant_id',TENANT).eq('id',id).eq('conference_name',name)
        console.error('[romylabs-conference] provider upgrade failed',e)
        return json({error:'Unable to move call to conference; original call was not intentionally ended'},502)
      }
      return json({ok:true,conference_name:name})
    }

    if(!upgraded)return json({error:'Conference has not been requested'},409)
    const room=await getRoom()
    if(!room)return json({ok:false,state:'waiting_for_agent',participants:[]})
    const details=await Promise.all(room.participants.map(async (p:any)=>{
      const sid=String(p?.call_sid||'')
      if(!UUID.test(sid))return null
      try{
        const leg=await (await fetchProvider('/Calls/'+sid+'.json')).json()
        const from=normalize(leg.from),to=normalize(leg.to)
        const kind=sid===callSid?'original':(from&&to&&from===to)?'agent':'guest'
        return {sid,kind,number:kind==='guest'?(to||from):undefined,
          status:String(leg.status||p.status||'unknown').toLowerCase()}
      }catch{return null}
    }))
    const participants=details.filter(Boolean) as {sid:string,kind:string,number?:string,status:string}[]
    if(action==='invite'){
      // No third-party call is made until the agent and the original party
      // have already joined. The guest is parked in a separate consult room
      // until the agent explicitly presses Merge Calls.
      const agentPresent=participants.some(p=>p.kind==='agent')
      const originalPresent=participants.some(p=>p.sid===callSid)
      if(!originalPresent||!agentPresent)return json({error:'Original caller and agent must both be connected'},409)
      const phone=normalize(body?.number)
      if(!phone)return json({error:'Enter a valid US number'},400)
      const {data:adminPhone}=await db.from('settings').select('sw_inbound_did')
        .eq('tenant_id',TENANT).limit(1).maybeSingle()
      const from=normalize(adminPhone?.sw_inbound_did)
      if(!from)return json({error:'RomyLabs outbound caller ID unavailable'},503)
      const invitation=crypto.randomUUID().replace(/-/g,'')
      const expires=Date.now()+15*60*1000
      const proof=await inviteSign(id+'.'+invitation+'.'+expires)
      const join=URL+'/functions/v1/romylabs-conference-guest?call='+encodeURIComponent(id)+
        '&invite='+invitation+'&exp='+expires+'&sig='+proof
      const dial=await fetchProvider('/Calls.json',{
        method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({To:phone,From:from,Url:join,Method:'POST',Timeout:'30'})
      })
      const data=await dial.json()
      const guestSid=String(data?.sid||'')
      if(!UUID.test(guestSid))return json({error:'Provider did not create an identifiable guest call'},502)
      const token=await inviteSign(id+'.'+guestSid+'.'+phone+'.'+expires)
      return json({ok:true,call_sid:guestSid,number:phone,expires,token,status:'ringing'})
    }

    if(['invite_status','merge','cancel_invite'].includes(action)){
      const guestSid=String(body?.call_sid||'')
      const number=normalize(body?.number)
      const expires=Number(body?.expires||0)
      const token=String(body?.token||'')
      if(!UUID.test(guestSid)||!number||!Number.isSafeInteger(expires)||expires<Date.now()||
         expires>Date.now()+15*60*1000||!token)
        return json({error:'Invitation expired or invalid'},403)
      const proof=await inviteSign(id+'.'+guestSid+'.'+number+'.'+expires)
      if(!safeEqual(proof,token))return json({error:'Invalid guest invitation'},403)
      const guest=await (await fetchProvider('/Calls/'+guestSid+'.json')).json()
      if(normalize(guest?.to)!==number)return json({error:'Guest call destination mismatch'},403)
      const inRoom=participants.some(p=>p.sid===guestSid)
      const guestState=String(guest?.status||'unknown').toLowerCase()
      if(action==='invite_status'){
        return json({ok:true,state:inRoom?'merged':terminal.has(guestState)?'ended':
          ['in-progress','answered'].includes(guestState)?'answered':'ringing',call_sid:guestSid})
      }
      if(action==='merge'){
        if(inRoom)return json({ok:true,state:'merged'})
        if(!['in-progress','answered'].includes(guestState))
          return json({error:'Guest must answer before joining'},409)
        const url=URL+'/functions/v1/join-conference?conf='+encodeURIComponent(conference)+'&tenant='+TENANT
        await fetchProvider('/Calls/'+guestSid+'.json',{
          method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
          body:new URLSearchParams({Url:url,Method:'POST'})
        })
        return json({ok:true,state:'merging'})
      }
      if(inRoom)return json({error:'Already merged; use Disconnect guest'},409)
      if(!terminal.has(guestState)){
        await fetchProvider('/Calls/'+guestSid+'.json',{
          method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
          body:new URLSearchParams({Status:'completed'})
        })
      }
      return json({ok:true,state:'ended'})
    }

    if(action==='status'){
      const originalPresent=participants.some(p=>p.sid===callSid)
      const agentPresent=participants.some(p=>p.kind==='agent')
      return json({ok:true,state:originalPresent&&agentPresent?'ready':'waiting_for_agent',
        participants,conference_sid:room.sid})
    }
    if(action==='remove'){
      const sid=String(body?.call_sid||'')
      const participant=participants.find(p=>p.sid===sid)
      if(!UUID.test(sid)||!participant||participant.kind!=='guest')
        return json({error:'Guest participant not found'},404)
      await fetchProvider('/Conferences/'+room.sid+'/Participants/'+sid+'.json',{method:'DELETE'})
      return json({ok:true,removed:sid})
    }
    return json({error:'Unsupported action'},400)
  }catch(e){console.error('[romylabs-conference]',e);return json({error:'Conference operation failed; check call status before retrying'},502)}
})
