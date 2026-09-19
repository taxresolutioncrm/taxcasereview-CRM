import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
}

serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:corsHeaders})
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}})
  if(req.method!=='POST') return json({error:'POST only'},405)

  try{
    const url=Deno.env.get('SUPABASE_URL')||''
    const anon=Deno.env.get('SUPABASE_ANON_KEY')||''
    const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
    if(!url||!anon||!service) return json({error:'Server configuration missing'},500)

    const authHeader=req.headers.get('Authorization')||''
    if(!authHeader.startsWith('Bearer ')) return json({error:'Missing authorization'},401)
    const caller=createClient(url,anon,{global:{headers:{Authorization:authHeader}},auth:{persistSession:false}})
    const {data:{user},error:userErr}=await caller.auth.getUser()
    if(userErr||!user?.email) return json({error:'Invalid session'},401)

    const {data:tenantId,error:tenantErr}=await caller.rpc('current_tenant_id')
    if(tenantErr||!tenantId) return json({error:'No active office context'},403)

    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
    const {data:callerEmployee}=await admin.from('employees')
      .select('id,status,perm_hr,role,access')
      .eq('tenant_id',tenantId)
      .ilike('email',user.email)
      .limit(1).maybeSingle()

    const active=callerEmployee&&String(callerEmployee.status||'Active').toLowerCase()==='active'
    const superAdmin=String(callerEmployee?.access||callerEmployee?.role||'').toLowerCase()==='super admin'
    if(!active || (!superAdmin && Number(callerEmployee?.perm_hr||0)<2)) return json({error:'Employee invite permission denied'},403)

    const body=await req.json().catch(()=>({}))
    const email=String(body.email||'').trim().toLowerCase()
    const name=String(body.name||'').trim()
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({error:'Valid employee email is required'},400)

    const {data:employee}=await admin.from('employees')
      .select('id,email,name,status,tenant_id')
      .eq('tenant_id',tenantId)
      .ilike('email',email)
      .limit(1).maybeSingle()
    if(!employee) return json({error:'Employee must exist in this office before an invite can be sent'},409)
    if(String(employee.status||'Active').toLowerCase()!=='active') return json({error:'Employee is not active'},409)

    // current_tenant_id() relies on globally unique employee emails. Refuse to
    // invite if this email is attached to another office.
    const {data:otherEmployee}=await admin.from('employees')
      .select('tenant_id')
      .ilike('email',email)
      .neq('tenant_id',tenantId)
      .limit(1).maybeSingle()
    if(otherEmployee) return json({error:'This email already belongs to another office'},409)

    let existing:any=null
    for(let page=1;page<=10&&!existing;page++){
      const {data:list,error:listErr}=await admin.auth.admin.listUsers({page,perPage:200})
      if(listErr) return json({error:'Could not verify employee login: '+listErr.message},500)
      existing=(list?.users||[]).find((u:any)=>String(u.email||'').toLowerCase()===email)||null
      if((list?.users||[]).length<200) break
    }
    const redirectTo=String(body.redirect_to||'').trim()
    if(existing){
      const recoveryClient=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}})
      const resetOptions=redirectTo?{redirectTo}:{}
      const {error:resetErr}=await recoveryClient.auth.resetPasswordForEmail(email,resetOptions)
      if(resetErr) return json({error:'Employee access email failed: '+resetErr.message},400)
      return json({ok:true,already_exists:true,reset_sent:true,email,employee_id:employee.id})
    }

    const options:any={data:{name:name||employee.name||email.split('@')[0]}}
    if(redirectTo) options.redirectTo=redirectTo
    const {data:invite,error:inviteErr}=await admin.auth.admin.inviteUserByEmail(email,options)
    if(inviteErr) return json({error:'Employee invite failed: '+inviteErr.message},400)

    return json({ok:true,invited:true,email,employee_id:employee.id,auth_user_id:invite?.user?.id||null})
  }catch(e){
    return json({error:String((e as Error)?.message||e)},500)
  }
})
