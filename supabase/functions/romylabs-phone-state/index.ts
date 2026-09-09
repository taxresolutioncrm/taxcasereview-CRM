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
    const db=createClient(URL,SERVICE)

    if(action==='ringing'){
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
        let playback_url=String(rec.recording_url||'')
        const prefix='storage://voicemails/'
        if(playback_url.startsWith(prefix)){
          const path=playback_url.slice(prefix.length)
          const {data:signed}=await db.storage.from('voicemails').createSignedUrl(path,60*60)
          playback_url=signed?.signedUrl||''
        }
        rows.push({...rec,recording_url:playback_url,ai:bySid.get(String(rec.call_sid||''))||null})
      }
      return json({ok:true,recordings:rows})
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
