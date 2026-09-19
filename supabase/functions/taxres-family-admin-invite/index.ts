import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const NASHVILLE_PROOF_URL='https://ydrvncdedgjtcprczwpu.supabase.co/functions/v1/taxres-family-admin-proof'
const PASSWORD_PAGE='https://taxrescrm.app/family-password'
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors})

async function findUser(admin:any,email:string){
  for(let page=1;page<=20;page++){
    const {data,error}=await admin.auth.admin.listUsers({page,perPage:1000})
    if(error) throw error
    const hit=(data?.users||[]).find((u:any)=>String(u.email||'').toLowerCase()===email)
    if(hit) return hit
    if((data?.users||[]).length<1000) break
  }
  return null
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
  if(req.method!=='POST') return json({error:'POST only'},405)
  try{
    const nashAuth=req.headers.get('authorization')||''
    if(!nashAuth.toLowerCase().startsWith('bearer ')) return json({error:'Nashville Admin authentication required'},401)
    const body=await req.json().catch(()=>({}))
    const targetEmail=String(body?.email||'').trim().toLowerCase()
    const action=String(body?.action||'link').trim().toLowerCase()
    if(!/^\S+@\S+\.\S+$/.test(targetEmail)) return json({error:'Employee email required'},400)

    const proofRes=await fetch(NASHVILLE_PROOF_URL,{
      method:'POST',
      headers:{Authorization:nashAuth,'Content-Type':'application/json'},
      body:JSON.stringify({target_email:targetEmail})
    })
    const proof=await proofRes.json().catch(()=>({}))
    if(!proofRes.ok||!proof?.success||String(proof?.target_email||'').toLowerCase()!==targetEmail){
      return json({error:proof?.error||'Nashville Admin verification failed'},proofRes.status||403)
    }

    const url=Deno.env.get('SUPABASE_URL')||''
    const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
    const existing=await findUser(admin,targetEmail)

    if(action==='status'){
      return json({success:true,exists:!!existing,last_sign_in_at:existing?.last_sign_in_at||null,email_confirmed:!!existing?.email_confirmed_at})
    }

    const kind:'invite'|'recovery'=existing?'recovery':'invite'
    if(existing&&!existing.email_confirmed_at){
      const {error}=await admin.auth.admin.updateUserById(existing.id,{email_confirm:true})
      if(error) throw error
    }
    const {data,error}=await admin.auth.admin.generateLink({type:kind,email:targetEmail})
    if(error) throw error
    const tokenHash=data?.properties?.hashed_token||data?.properties?.hashedToken||''
    if(!tokenHash) throw new Error('Could not generate TaxRes family setup token')
    const link=`${PASSWORD_PAGE}?token_hash=${encodeURIComponent(tokenHash)}&type=${kind}&office=nashville`
    return json({success:true,mode:kind,access_link:link,name:proof?.target_name||'',email:targetEmail})
  }catch(e){
    console.error('[taxres-family-admin-invite]',e)
    return json({error:'Could not prepare TaxRes family access'},502)
  }
})
