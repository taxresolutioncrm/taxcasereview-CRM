import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const NASHVILLE_PROOF_URL='https://ydrvncdedgjtcprczwpu.supabase.co/functions/v1/taxres-family-admin-proof'
const PASSWORD_PAGE='https://taxrescrm.app/family-password'
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors})

async function findUser(admin:any,email:string){
  const {data,error}=await admin.rpc('taxres_auth_user_by_email',{target_email:email})
  if(error) throw error
  return Array.isArray(data)&&data.length ? data[0] : null
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
  if(req.method!=='POST') return json({error:'POST only'},405)
  try{
    const nashAuth=req.headers.get('authorization')||''
    const bridgeSecret=req.headers.get('x-nashville-family-secret')||''
    const body=await req.json().catch(()=>({}))
    const targetEmail=String(body?.email||'').trim().toLowerCase()
    const action=String(body?.action||'link').trim().toLowerCase()
    if(!/^\S+@\S+\.\S+$/.test(targetEmail)) return json({error:'Employee email required'},400)

    const url=Deno.env.get('SUPABASE_URL')||''
    const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})

    let proof:any=null
    if(bridgeSecret){
      const {data:secretRow,error:secretErr}=await admin.from('platform_internal_secrets')
        .select('secret').eq('key','nashville_family_bridge_v1').maybeSingle()
      if(secretErr||!secretRow?.secret||String(secretRow.secret)!==bridgeSecret) return json({error:'Invalid Nashville family bridge'},401)
      proof={success:true,target_email:targetEmail,target_name:String(body?.name||'')}
    }else{
      if(!nashAuth.toLowerCase().startsWith('bearer ')) return json({error:'Nashville Admin authentication required'},401)
      const proofPayload=action==='sync_email'
        ? {action:'email_change',target_id:String(body?.employee_id||''),expected_email:String(body?.old_email||'').trim().toLowerCase(),new_email:String(body?.new_email||'').trim().toLowerCase()}
        : {target_email:targetEmail}
      const proofRes=await fetch(NASHVILLE_PROOF_URL,{
        method:'POST',
        headers:{Authorization:nashAuth,'Content-Type':'application/json'},
        body:JSON.stringify(proofPayload)
      })
      proof=await proofRes.json().catch(()=>({}))
      if(!proofRes.ok||!proof?.success){
        return json({error:proof?.error||'Nashville Admin verification failed'},proofRes.status||403)
      }
      if(action!=='sync_email' && String(proof?.target_email||'').toLowerCase()!==targetEmail){
        return json({error:'Nashville employee verification mismatch'},403)
      }
    }

    if(action==='sync_email'){
      const oldEmail=String(body?.old_email||'').trim().toLowerCase()
      const newEmail=String(body?.new_email||'').trim().toLowerCase()
      if(!/^\S+@\S+\.\S+$/.test(oldEmail)||!/^\S+@\S+\.\S+$/.test(newEmail)) return json({error:'Valid current and new email are required'},400)
      if(String(proof?.target_email||'').toLowerCase()!==oldEmail||String(proof?.new_email||'').toLowerCase()!==newEmail){
        return json({error:'Employee email verification mismatch'},403)
      }
      const oldUser=await findUser(admin,oldEmail)
      const newUser=await findUser(admin,newEmail)
      if(oldUser&&newUser&&oldUser.id!==newUser.id){
        const oldUnused=!oldUser.email_confirmed_at&&!oldUser.last_sign_in_at
        if(!oldUnused) return json({error:'Both email addresses already belong to active TaxRes family identities. No automatic merge was performed.'},409)
        const {error:deleteErr}=await admin.auth.admin.deleteUser(oldUser.id)
        if(deleteErr) throw deleteErr
        return json({success:true,mode:'linked_existing',auth_user_id:newUser.id,email:newEmail,removed_unused_duplicate:true})
      }
      if(newUser) return json({success:true,mode:'linked_existing',auth_user_id:newUser.id,email:newEmail})
      if(oldUser){
        const {data:updated,error:updateErr}=await admin.auth.admin.updateUserById(oldUser.id,{email:newEmail,email_confirm:!!oldUser.email_confirmed_at})
        if(updateErr) throw updateErr
        return json({success:true,mode:'updated_existing',auth_user_id:updated?.user?.id||oldUser.id,email:newEmail})
      }
      return json({success:true,mode:'no_family_identity',auth_user_id:null,email:newEmail})
    }

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
