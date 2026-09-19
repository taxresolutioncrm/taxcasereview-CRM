import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors})
const b64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
async function sha(v:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))).map(x=>x.toString(16).padStart(2,'0')).join('')}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
  if(req.method!=='POST') return json({error:'POST only'},405)
  try{
    const auth=req.headers.get('authorization')||''
    if(!auth.toLowerCase().startsWith('bearer ')) return json({error:'Authentication required'},401)
    const url=Deno.env.get('SUPABASE_URL')||''
    const anon=Deno.env.get('SUPABASE_ANON_KEY')||''
    const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
    const caller=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}})
    const {data:userData,error:userErr}=await caller.auth.getUser()
    const email=String(userData?.user?.email||'').trim().toLowerCase()
    if(userErr||!email) return json({error:'Invalid TaxRes family session'},401)

    const body=await req.json().catch(()=>({}))
    const target=String(body?.target||'').trim().toLowerCase()
    const challenge=String(body?.code_challenge||'').trim()
    if(target!=='nashville') return json({error:'Unsupported target'},400)
    if(!/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) return json({error:'Invalid PKCE challenge'},400)

    const raw=new Uint8Array(32);crypto.getRandomValues(raw)
    const code=b64(raw)
    const codeHash=await sha(code)
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
    await admin.from('taxres_family_sso_codes').delete().eq('employee_email',email).eq('target_app',target).lt('expires_at',new Date().toISOString())
    const {error}=await admin.from('taxres_family_sso_codes').insert({
      code_hash:codeHash,employee_email:email,target_app:target,code_challenge:challenge,
      expires_at:new Date(Date.now()+2*60*1000).toISOString()
    })
    if(error) throw error
    return json({success:true,code,expires_in:120})
  }catch(e){
    console.error('[taxres-family-sso-issue]',e)
    return json({error:'Could not issue TaxRes family sign-in code'},502)
  }
})
