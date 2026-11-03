// Centurion dedicated project ONLY. Staged; not deployed.
// Deploy after membership backfill + signed-in isolation tests.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0'
const allowedOrigin='https://centurionfirm.taxrescrm.app'
const cors={'Access-Control-Allow-Origin':allowedOrigin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'}
const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}})
serve(async req=>{
  if(req.method==='OPTIONS')return new Response('',{headers:cors})
  if(req.method!=='POST')return respond({error:'POST required'},405)
  if(req.headers.get('origin')!==allowedOrigin)return respond({error:'Origin denied'},403)
  try {
    const token=req.headers.get('authorization')?.replace(/^Bearer /i,'')||''
    if(!token)return respond({error:'Login required'},401)
    const url=Deno.env.get('SUPABASE_URL')!,pub=Deno.env.get('SUPABASE_ANON_KEY')!,secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    if(!url||!pub||!secret)return respond({error:'Server configuration incomplete'},500)
    const caller=createClient(url,pub,{global:{headers:{Authorization:'Bearer '+token}},auth:{persistSession:false}})
    const admin=createClient(url,secret,{auth:{persistSession:false}})
    const {data:{user},error:authError}=await caller.auth.getUser(token)
    if(authError||!user)return respond({error:'Invalid session'},401)
    const {data:office,error:officeError}=await caller.rpc('current_tenant_id')
    if(officeError||!office)return respond({error:'Select an authorized office'},403)
    const {data:membership,error:memberError}=await admin.from('centurion_office_memberships').select('role,active').eq('user_id',user.id).eq('tenant_id',office).maybeSingle()
    if(memberError||!membership?.active||membership.role!=='owner')return respond({error:'Platform owner access required'},403)
    const body=await req.json().catch(()=>({}))
    const action=String(body.action||'create')
    const adminEmail=String(body.admin_email||'').trim().toLowerCase()
    if(!(/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/).test(adminEmail))
      return respond({error:'Valid administrator email required'},400)
    // Lookup is server-side and bounded; never trust client-supplied identity IDs.
    let existingAdmin: {id:string,email_confirmed_at?:string|null} | null=null
    for(let page=1;page<=20 && !existingAdmin;page++){
      const {data:users,error:listError}=await admin.auth.admin.listUsers({page,perPage:100})
      if(listError)return respond({error:'Identity lookup unavailable'},500)
      existingAdmin=(users?.users||[]).find(x=>x.email?.toLowerCase()===adminEmail)||null
      if((users?.users||[]).length<100)break
    }
    if(action==='invite_admin'){
      if(existingAdmin?.email_confirmed_at)return respond({ok:true,status:'verified',admin_email:adminEmail})
      if(existingAdmin)return respond({ok:true,status:'pending_verification',admin_email:adminEmail})
      const {error:inviteError}=await admin.auth.admin.inviteUserByEmail(adminEmail,{
        redirectTo:allowedOrigin+'/login'
      })
      if(inviteError)return respond({error:'Invitation could not be sent: '+inviteError.message},409)
      return respond({ok:true,status:'invited',admin_email:adminEmail})
    }
    if(action!=='create')return respond({error:'Unsupported action'},400)
    const name=String(body.firm_name||'').trim().slice(0,150)
    const code=String(body.tenant_code||'').trim().toUpperCase()
    if(!name||!(/^[A-Z0-9_-]{3,24}$/).test(code))
      return respond({error:'Valid office name and code required'},400)
    if(!existingAdmin?.email_confirmed_at)
      return respond({error:'Administrator must first confirm the Centurion invitation email'},409)
    const verifiedAdminId=existingAdmin.id
    const {data:id,error:createError}=await admin.rpc('centurion_create_office',{p_code:code,p_name:name,p_admin_user:verifiedAdminId,p_owner_user:user.id})
    if(createError)return respond({error:createError.message},409)
    return respond({tenant_id:id,tenant_code:code,status:'created',note:'Office created in Centurion dedicated project'})
  }catch{return respond({error:'Office provisioning failed'},500)}
})
