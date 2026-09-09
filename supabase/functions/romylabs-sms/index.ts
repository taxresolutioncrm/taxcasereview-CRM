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
    const action=String(body?.action||'list')
    const db=createClient(URL,SERVICE)

    if(action==='list'){
      const limit=Math.max(1,Math.min(Number(body?.limit)||200,500))
      const {data,error}=await db.from('sms_messages')
        .select('id,clientName,phone,body,status,direction,signalwire_sms_id,sent_by,read,media,error_msg,created_at')
        .eq('tenant_id',TENANT)
        .not('signalwire_sms_id','like','demo-seed-sms-%')
        .order('created_at',{ascending:false})
        .limit(limit)
      return error?json({error:error.message},500):json({ok:true,messages:data||[]})
    }

    if(action==='mark_read'){
      const id=String(body?.id||'')
      if(!id)return json({error:'id required'},400)
      const {error}=await db.from('sms_messages').update({read:true}).eq('tenant_id',TENANT).eq('id',id)
      return error?json({error:error.message},500):json({ok:true})
    }

    if(action==='mark_thread_read'){
      const phone=String(body?.phone||'').replace(/\D/g,'').slice(-10)
      if(phone.length!==10)return json({error:'valid phone required'},400)
      const {data,error}=await db.from('sms_messages')
        .select('id,phone').eq('tenant_id',TENANT).eq('direction','inbound').eq('read',false)
      if(error)return json({error:error.message},500)
      const ids=(data||[]).filter((x:any)=>String(x.phone||'').replace(/\D/g,'').slice(-10)===phone).map((x:any)=>x.id)
      if(ids.length){
        const upd=await db.from('sms_messages').update({read:true}).eq('tenant_id',TENANT).in('id',ids)
        if(upd.error)return json({error:upd.error.message},500)
      }
      return json({ok:true,updated:ids.length})
    }

    if(action==='delete'){
      const id=String(body?.id||'')
      if(!id)return json({error:'id required'},400)
      const {error}=await db.from('sms_messages').delete().eq('tenant_id',TENANT).eq('id',id)
      return error?json({error:error.message},500):json({ok:true})
    }

    return json({error:'Unsupported action'},400)
  }catch(e){
    console.error('[romylabs-sms]',e)
    return json({error:'Unable to manage RomyLabs SMS'},500)
  }
})
