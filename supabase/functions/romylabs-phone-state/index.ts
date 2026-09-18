import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const URL=Deno.env.get('SUPABASE_URL')!
const ANON=Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TENANT='a0000000-0000-0000-0000-000000000001'
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,'Content-Type':'application/json'}})

serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:CORS})
  const db=createClient(URL,SERVICE)

  const b64url=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
  const mediaSignature=async(id:string,exp:string)=>{
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(SERVICE),{name:'HMAC',hash:'SHA-256'},false,['sign'])
    const raw=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${id}.${exp}`))
    return b64url(new Uint8Array(raw))
  }
  const safeEqual=(a:string,b:string)=>{
    if(a.length!==b.length)return false
    let diff=0
    for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i)
    return diff===0
  }
  const romylabsSignalWireCredentials=async()=>{
    let {data:settings}=await db.from('settings')
      .select('sw_project_id,sw_api_token,sw_space_url')
      .eq('tenant_id',TENANT).limit(1).maybeSingle()
    if(!settings?.sw_project_id||!settings?.sw_api_token){
      const fallback=await db.from('settings')
        .select('sw_project_id,sw_api_token,sw_space_url')
        .eq('tenant_id','61a89aef-0e7e-4ea2-b222-44ab2024655a').limit(1).maybeSingle()
      settings=fallback.data||settings
    }
    return settings||null
  }

  if(req.method==='GET'){
    const url=new globalThis.URL(req.url)
    const id=String(url.searchParams.get('media')||'')
    const exp=String(url.searchParams.get('exp')||'')
    const sig=String(url.searchParams.get('sig')||'')
    if(!id||!/^\d{10,13}$/.test(exp)||!sig)return json({error:'Invalid media request'},400)
    const expMs=Number(exp)
    if(!Number.isFinite(expMs)||Date.now()>expMs)return json({error:'Media link expired'},401)
    const expected=await mediaSignature(id,exp)
    if(!safeEqual(expected,sig))return json({error:'Invalid media signature'},403)

    const {data:rec,error}=await db.from('call_recordings')
      .select('id,recording_url').eq('tenant_id',TENANT).eq('id',id).limit(1).maybeSingle()
    if(error)return json({error:error.message},500)
    if(!rec?.recording_url)return json({error:'Recording not found'},404)

    const raw=String(rec.recording_url)
    const prefix='storage://voicemails/'
    if(raw.startsWith(prefix)){
      const path=raw.slice(prefix.length)
      const {data:signed,error:signedError}=await db.storage.from('voicemails').createSignedUrl(path,60*15)
      if(signedError||!signed?.signedUrl)return json({error:'Recording unavailable'},502)
      return new Response(null,{status:302,headers:{...CORS,Location:signed.signedUrl,'Cache-Control':'private, no-store'}})
    }

    let parsed:URL
    try{parsed=new globalThis.URL(raw)}catch{return json({error:'Invalid recording source'},500)}
    if(parsed.protocol!=='https:'||!(parsed.hostname==='signalwire.com'||parsed.hostname.endsWith('.signalwire.com')))return json({error:'Invalid recording source'},500)

    const creds=await romylabsSignalWireCredentials()
    if(!creds?.sw_project_id||!creds?.sw_api_token)return json({error:'SignalWire recording credentials unavailable'},503)
    const headers:Record<string,string>={Authorization:'Basic '+btoa(`${creds.sw_project_id}:${creds.sw_api_token}`)}
    const range=req.headers.get('range')
    if(range)headers.Range=range
    const audioUrl=raw.endsWith('.mp3')?raw:`${raw}.mp3`
    const audio=await fetch(audioUrl,{headers,redirect:'follow'})
    if(!audio.ok&&audio.status!==206)return json({error:`Recording provider returned ${audio.status}`},502)

    const responseHeaders=new Headers(CORS)
    responseHeaders.set('Content-Type',audio.headers.get('content-type')||'audio/mpeg')
    responseHeaders.set('Cache-Control','private, no-store')
    responseHeaders.set('Accept-Ranges',audio.headers.get('accept-ranges')||'bytes')
    for(const h of ['content-length','content-range','etag','last-modified']){
      const v=audio.headers.get(h)
      if(v)responseHeaders.set(h,v)
    }
    return new Response(audio.body,{status:audio.status,headers:responseHeaders})
  }

  if(req.method!=='POST')return json({error:'Method not allowed'},405)
  try{
    const auth=req.headers.get('authorization')||''
    if(!auth.toLowerCase().startsWith('bearer '))return json({error:'Unauthorized'},401)
    const token=auth.slice(7).trim()
    const userClient=createClient(URL,ANON,{global:{headers:{Authorization:`Bearer ${token}`}}})
    const {data:{user},error:userErr}=await userClient.auth.getUser(token)
    if(userErr||!user?.email)return json({error:'Unauthorized'},401)
    const {data:isAdmin}=await userClient.rpc('_is_platform_admin')
    if(isAdmin!==true)return json({error:'Forbidden'},403)

    const body=await req.json().catch(()=>({}))
    const action=String(body?.action||'')

    async function signedRecordingUrl(rec:any){
      const raw=String(rec?.recording_url||'')
      if(!raw)return ''
      const prefix='storage://voicemails/'
      if(raw.startsWith(prefix)){
        const path=raw.slice(prefix.length)
        const {data:signed,error}=await db.storage.from('voicemails').createSignedUrl(path,60*60)
        if(error)console.error('[romylabs-phone-state] signed recording',error.message)
        return signed?.signedUrl||''
      }

      let parsed:URL
      try{parsed=new globalThis.URL(raw)}catch{return ''}
      if(parsed.protocol!=='https:'||!(parsed.hostname==='signalwire.com'||parsed.hostname.endsWith('.signalwire.com')))return ''

      const exp=String(Date.now()+15*60*1000)
      const sig=await mediaSignature(String(rec.id),exp)
      return `${URL}/functions/v1/romylabs-phone-state?media=${encodeURIComponent(String(rec.id))}&exp=${exp}&sig=${encodeURIComponent(sig)}`
    }

    if(action==='ringing'){
      // Provider/cXML failures can leave a row marked ringing even though the
      // physical call is already gone. Never surface those as phantom calls.
      const staleCutoff=new Date(Date.now()-2*60*1000).toISOString()
      await db.from('incoming_calls').update({status:'missed'})
        .eq('tenant_id',TENANT).eq('status','ringing').lt('created_at',staleCutoff)
      const {data,error}=await db.from('incoming_calls')
        .select('callsid,conference_name,from_number,department,created_at,status')
        .eq('tenant_id',TENANT).eq('status','ringing')
        .order('created_at',{ascending:false}).limit(1).maybeSingle()
      return error?json({error:error.message},500):json({ok:true,row:data||null})
    }

    if(action==='recordings'){
      const [recordings,summaries]=await Promise.all([
        db.from('call_recordings')
          .select('id,call_sid,from_number,to_number,recording_url,duration_seconds,created_at')
          .eq('tenant_id',TENANT).order('created_at',{ascending:false}).limit(50),
        db.from('call_ai_summaries')
          .select('id,call_sid,transcript,summary,key_points,action_items,sentiment,next_steps,created_at')
          .eq('tenant_id',TENANT).order('created_at',{ascending:false}).limit(50),
      ])
      const error=recordings.error||summaries.error
      if(error)return json({error:error.message},500)
      const bySid=new Map((summaries.data||[]).map((x:any)=>[String(x.call_sid||''),x]))
      const rows=[]
      for(const rec of recordings.data||[]){
        const playback_url=await signedRecordingUrl(rec)
        rows.push({...rec,recording_url:playback_url,playback_ready:!!playback_url,ai:bySid.get(String(rec.call_sid||''))||null})
      }
      return json({ok:true,recordings:rows})
    }

    if(action==='delete_recording'){
      const id=String(body?.id||'')
      if(!id)return json({error:'id required'},400)
      const {data:rec,error:findError}=await db.from('call_recordings')
        .select('id,call_sid,recording_url').eq('tenant_id',TENANT).eq('id',id).limit(1).maybeSingle()
      if(findError)return json({error:findError.message},500)
      if(!rec)return json({error:'Recording not found'},404)

      const raw=String(rec.recording_url||'')
      const prefix='storage://voicemails/'
      if(raw.startsWith(prefix)){
        const path=raw.slice(prefix.length)
        const {error:storageError}=await db.storage.from('voicemails').remove([path])
        if(storageError)console.error('[romylabs-phone-state] recording storage delete',storageError.message)
      }else if(raw){
        try{
          const parsed=new globalThis.URL(raw)
          if(parsed.protocol==='https:'&&(parsed.hostname==='signalwire.com'||parsed.hostname.endsWith('.signalwire.com'))){
            const creds=await romylabsSignalWireCredentials()
            if(!creds?.sw_project_id||!creds?.sw_api_token){
              return json({error:'SignalWire recording credentials unavailable; recording was not deleted.'},503)
            }
            const providerDelete=await fetch(raw,{
              method:'DELETE',
              headers:{Authorization:'Basic '+btoa(`${creds.sw_project_id}:${creds.sw_api_token}`)}
            })
            if(!providerDelete.ok&&providerDelete.status!==404){
              console.error('[romylabs-phone-state] provider recording delete',providerDelete.status,id)
              return json({error:`Provider refused recording deletion (${providerDelete.status})`},502)
            }
          }
        }catch(e){console.error('[romylabs-phone-state] provider delete parse',e)}
      }

      const aiDelete=await db.from('call_ai_summaries').delete().eq('tenant_id',TENANT).eq('call_sid',rec.call_sid)
      if(aiDelete.error)return json({error:aiDelete.error.message},500)
      const recordingDelete=await db.from('call_recordings').delete().eq('tenant_id',TENANT).eq('id',id)
      if(recordingDelete.error)return json({error:recordingDelete.error.message},500)
      return json({ok:true,id})
    }

    if(action==='recent_calls'){
      // A caller can hang up while the auto-attendant greeting is still
      // playing, before SignalWire invokes the Gather action. Clean those
      // abandoned menu rows so call history never shows phantom active calls.
      const staleMenuCutoff=new Date(Date.now()-2*60*1000).toISOString()
      await db.from('incoming_calls').update({status:'missed',department:'Auto Attendant'})
        .eq('tenant_id',TENANT).eq('status','menu').lt('created_at',staleMenuCutoff)

      const [incoming,outbound]=await Promise.all([
        db.from('incoming_calls')
          .select('id,callsid,from_number,department,status,created_at')
          .eq('tenant_id',TENANT).order('created_at',{ascending:false}).limit(50),
        db.from('outbound_calls')
          .select('id,destination_number,display_name,status,created_at,provider_call_sid')
          .eq('tenant_id',TENANT).order('created_at',{ascending:false}).limit(50),
      ])
      const error=incoming.error||outbound.error
      if(error)return json({error:error.message},500)
      const rows=[
        ...(incoming.data||[]).map((r:any)=>({
          id:`in:${r.id}`,direction:'Inbound',phone:r.from_number||'',name:r.department||'RomyLabs',status:r.status||'unknown',created_at:r.created_at
        })),
        ...(outbound.data||[]).map((r:any)=>({
          id:`out:${r.id}`,direction:'Outbound',phone:r.destination_number||'',name:r.display_name||'RomyLabs Call',status:r.status||'unknown',created_at:r.created_at
        })),
      ].sort((a:any,b:any)=>new Date(b.created_at||0).getTime()-new Date(a.created_at||0).getTime()).slice(0,75)
      return json({ok:true,calls:rows})
    }

    if(action==='claim'){
      const callsid=String(body?.callsid||'')
      const claimedBy=String(body?.claimed_by||user.email).slice(0,120)
      if(!callsid)return json({error:'callsid required'},400)
      const {data,error}=await db.from('incoming_calls')
        .update({status:'answered',claimed_by:claimedBy,claimed_at:new Date().toISOString()})
        .eq('tenant_id',TENANT).eq('callsid',callsid).eq('status','ringing')
        .select('callsid,conference_name,from_number,department,created_at')
      return error?json({error:error.message},500):json({ok:true,claimed:data||[]})
    }

    if(action==='release_claim'){
      const callsid=String(body?.callsid||'')
      if(!callsid)return json({error:'callsid required'},400)
      const {data,error}=await db.from('incoming_calls')
        .update({status:'ringing',claimed_by:null,claimed_at:null})
        .eq('tenant_id',TENANT).eq('callsid',callsid).eq('status','answered')
        .select('callsid,conference_name,status')
      return error?json({error:error.message},500):json({ok:true,released:data||[]})
    }

    if(action==='incoming_status'){
      const callsid=String(body?.callsid||'')
      if(!callsid)return json({error:'callsid required'},400)
      const {data,error}=await db.from('incoming_calls').select('status,conference_name,callsid')
        .eq('tenant_id',TENANT).eq('callsid',callsid).limit(1).maybeSingle()
      return error?json({error:error.message},500):json({ok:true,row:data||null})
    }

    if(action==='outbound_status'){
      const conferenceName=String(body?.conference_name||'')
      if(!conferenceName)return json({error:'conference_name required'},400)
      const {data,error}=await db.from('outbound_calls').select('id,status,conference_name,provider_call_sid')
        .eq('tenant_id',TENANT).eq('conference_name',conferenceName).limit(1).maybeSingle()
      return error?json({error:error.message},500):json({ok:true,row:data||null})
    }

    if(action==='restore_inbound'){
      const callsid=String(body?.callsid||'')
      if(!callsid)return json({error:'callsid required'},400)
      const {data,error}=await db.from('incoming_calls')
        .select('conference_name,callsid,status').eq('tenant_id',TENANT).eq('callsid',callsid)
        .in('status',['ringing','answered']).limit(1).maybeSingle()
      return error?json({error:error.message},500):json({ok:true,row:data||null})
    }

    if(action==='restore_outbound'){
      const conferenceName=String(body?.conference_name||'')
      if(!conferenceName)return json({error:'conference_name required'},400)
      const {data,error}=await db.from('outbound_calls')
        .select('id,conference_name,status,provider_call_sid').eq('tenant_id',TENANT).eq('conference_name',conferenceName)
        .in('status',['pending','ringing','answered','connected']).limit(1).maybeSingle()
      return error?json({error:error.message},500):json({ok:true,row:data||null})
    }

    if(action==='complete_inbound'){
      const callsid=String(body?.callsid||'')
      if(!callsid)return json({error:'callsid required'},400)
      const {error}=await db.from('incoming_calls').update({status:'completed'})
        .eq('tenant_id',TENANT).eq('callsid',callsid).eq('status','answered')
      return error?json({error:error.message},500):json({ok:true})
    }

    if(action==='save_log'){
      const rawCallId=body?.raw_call_id?String(body.raw_call_id):null
      const record={
        leadId:null,
        clientName:String(body?.client_name||'RomyLabs Call').slice(0,200),
        phone:String(body?.phone||'').slice(0,40),
        outcome:String(body?.outcome||'Connected').slice(0,80),
        notes:String(body?.notes||'').slice(0,10000),
        duration:String(body?.duration||'').slice(0,20),
        direction:String(body?.direction||'Outbound').slice(0,20),
        tenant_id:TENANT,
      }
      if(rawCallId){
        const {data,error}=await db.from('calllog').update(record).eq('tenant_id',TENANT).eq('raw_call_id',rawCallId).select('id')
        if(error)return json({error:error.message},500)
        if(data?.length)return json({ok:true,id:data[0].id})
        const ins=await db.from('calllog').insert({...record,raw_call_id:rawCallId}).select('id').single()
        return ins.error?json({error:ins.error.message},500):json({ok:true,id:ins.data?.id})
      }
      const ins=await db.from('calllog').insert(record).select('id').single()
      return ins.error?json({error:ins.error.message},500):json({ok:true,id:ins.data?.id})
    }

    return json({error:'Unsupported action'},400)
  }catch(e){
    console.error('[romylabs-phone-state]',e)
    return json({error:'Unable to manage RomyLabs phone state'},500)
  }
})
