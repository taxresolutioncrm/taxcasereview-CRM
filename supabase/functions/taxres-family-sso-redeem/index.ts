import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors})
async function shaHex(v:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))).map(x=>x.toString(16).padStart(2,'0')).join('')}
async function shaB64(v:string){const b=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)));return btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
  if(req.method!=='POST') return json({error:'POST only'},405)
  try{
    const body=await req.json().catch(()=>({}))
    const code=String(body?.code||'').trim()
    const verifier=String(body?.code_verifier||'').trim()
    const target=String(body?.target||'').trim().toLowerCase()
    if(target!=='nashville'||code.length<32||verifier.length<43) return json({error:'Invalid sign-in exchange'},400)

    const url=Deno.env.get('SUPABASE_URL')||''
    const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
    const codeHash=await shaHex(code)
    const {data:row,error:loadErr}=await admin.from('taxres_family_sso_codes')
      .select('id,employee_email,code_challenge,expires_at,consumed_at')
      .eq('code_hash',codeHash).eq('target_app',target).maybeSingle()
    if(loadErr||!row||row.consumed_at||new Date(row.expires_at).getTime()<=Date.now()) return json({error:'Sign-in code is invalid or expired'},401)
    if(await shaB64(verifier)!==row.code_challenge) return json({error:'Sign-in verifier mismatch'},401)

    const {data:used,error:useErr}=await admin.from('taxres_family_sso_codes')
      .update({consumed_at:new Date().toISOString()})
      .eq('id',row.id).is('consumed_at',null)
      .select('employee_email').maybeSingle()
    if(useErr||!used?.employee_email) return json({error:'Sign-in code was already used'},401)
    return json({success:true,email:String(used.employee_email).toLowerCase()})
  }catch(e){
    console.error('[taxres-family-sso-redeem]',e)
    return json({error:'Could not redeem TaxRes family sign-in code'},502)
  }
})
