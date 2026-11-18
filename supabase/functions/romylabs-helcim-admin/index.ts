import {createClient} from 'https://esm.sh/@supabase/supabase-js@2'
const cors={'Access-Control-Allow-Origin':'https://admin.romylabs.com','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store','Content-Type':'application/json'}
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:cors})
// RomyLabs-owned SaaS office collections only; read-only verification, no charges.
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  if(req.method!=='POST')return reply({ok:false,error:'Method not allowed'},405)
  const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY')
  if(!url||!anon)return reply({ok:false,error:'Authentication unavailable'},503)
  const authorization=req.headers.get('authorization')||''
  if(!/^Bearer \S+$/.test(authorization))return reply({ok:false,error:'Sign-in required'},401)
  const caller=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}})
  const {data:admin,error:authError}=await caller.rpc('_is_platform_admin')
  if(authError||admin!==true)return reply({ok:false,error:'Platform admin required'},403)
  const body=await req.json().catch(()=>({}))
  if(!['status','verify'].includes(body.action))return reply({ok:false,error:'Unsupported action'},400)
  const token=Deno.env.get('HELCIM_API_TOKEN')
  if(!token)return reply({ok:true,configured:false,verified:false,checkout_ready:false,reason:'Helcim API token not configured'})
  try{
    const response=await fetch('https://api.helcim.com/v2/connection-test',{headers:{'api-token':token,'accept':'application/json'},signal:AbortSignal.timeout(8000)})
    return reply({ok:true,configured:true,verified:response.ok,checkout_ready:false,reason:response.ok?'Connection verified; payments locked pending webhook certification':'Helcim API authentication failed'})
  }catch{return reply({ok:true,configured:true,verified:false,checkout_ready:false,reason:'Helcim verification unavailable'})}
})
