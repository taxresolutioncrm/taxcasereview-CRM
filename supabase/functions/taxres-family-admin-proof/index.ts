import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TENANT='489ace07-1a6b-4864-833a-4f8420568b40'
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors})
const RANK:Record<string,number>={'Super Admin':100,'Admin':80,'Manager':60,'Tax Advisor':50,'Tax Associate':40,'Associate':40,'Para':40,'Sales Rep':30,'View Only':10}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
  if(req.method!=='POST') return json({error:'POST only'},405)
  try{
    const auth=req.headers.get('authorization')||''
    if(!auth.toLowerCase().startsWith('bearer ')) return json({error:'Authentication required'},401)
    const token=auth.replace(/^Bearer\s+/i,'')
    if(!token) return json({error:'Authentication required'},401)

    const url=Deno.env.get('SUPABASE_URL')||''
    const anon=Deno.env.get('SUPABASE_ANON_KEY')||''
    const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
    if(!url||!anon||!service) return json({error:'Server configuration missing'},500)

    const caller=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}})
    const {data:userData,error:userErr}=await caller.auth.getUser(token)
    const actorEmail=String(userData?.user?.email||'').trim().toLowerCase()
    if(userErr||!actorEmail) return json({error:'Invalid Nashville session'},401)

    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
    const {data:actor,error:actorErr}=await admin.from('employees')
      .select('id,email,name,status,access,tenant_id')
      .eq('tenant_id',TENANT).eq('status','Active').ilike('email',actorEmail).limit(1).maybeSingle()
    if(actorErr) return json({error:'Could not verify Nashville Admin access'},500)
    if(!actor||!['Admin','Super Admin'].includes(String(actor.access||''))) return json({error:'Nashville Admin access required'},403)

    const body=await req.json().catch(()=>({}))
    const targetEmail=String(body?.target_email||'').trim().toLowerCase()
    if(!/^\S+@\S+\.\S+$/.test(targetEmail)) return json({error:'Employee email required'},400)

    const {data:target,error:targetErr}=await admin.from('employees')
      .select('id,email,name,status,access,tenant_id')
      .eq('tenant_id',TENANT).eq('status','Active').ilike('email',targetEmail).limit(1).maybeSingle()
    if(targetErr) return json({error:'Could not verify Nashville employee'},500)
    if(!target) return json({error:'Active Nashville employee not found'},404)

    const actorRank=RANK[String(actor.access||'')]||0
    const targetRank=RANK[String(target.access||'')]||0
    const isSelf=actorEmail===targetEmail
    if(!isSelf && actor.access!=='Super Admin' && targetRank>=actorRank){
      return json({error:'Cannot manage an equal or higher access account'},403)
    }

    return json({
      success:true,
      actor_email:actorEmail,
      target_email:String(target.email||'').toLowerCase(),
      target_name:target.name||'',
      target_access:target.access||''
    })
  }catch(e){
    console.error('[taxres-family-admin-proof]',e)
    return json({error:'Could not verify Nashville admin access'},502)
  }
})
