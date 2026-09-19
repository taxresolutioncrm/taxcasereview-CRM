import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const REDIRECT='https://taxrescrm.app/family-password?office=nashville'
const MESSAGE='If that email belongs to a TaxRes family account, a secure password reset link will be sent.'
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors})

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
  if(req.method!=='POST') return json({error:'POST only'},405)
  const generic=()=>json({success:true,message:MESSAGE})
  try{
    const body=await req.json().catch(()=>({}))
    const email=String(body?.email||'').trim().toLowerCase()
    if(!/^\S+@\S+\.\S+$/.test(email)) return generic()

    const url=Deno.env.get('SUPABASE_URL')||''
    const anon=Deno.env.get('SUPABASE_ANON_KEY')||''
    if(!url||!anon) return generic()

    const client=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}})
    await client.auth.resetPasswordForEmail(email,{redirectTo:REDIRECT})
    return generic()
  }catch(e){
    console.error('[taxres-family-password-reset]',e)
    return generic()
  }
})
